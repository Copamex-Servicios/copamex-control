-- Fase 4: guardado online de Pozos y corrección de la lectura original.
-- Ejecutar COMPLETO como postgres después de las migraciones hasta 026.
-- No modifica filas existentes ni vuelve a crear la tabla.
-- Una captura de los dos pozos por turno, con consumos generados en la tabla.
-- p_original es NULL al crear; al corregir contiene las cuatro lecturas y
-- notas que mostraba el formulario antes de editarlas (claves de la tabla).
-- No recibe autor, fecha de captura, consumos ni datos de eliminación.
-- Los permisos generales/RLS/triggers existentes permanecen vigentes.
-- La cola offline se implementará en su fase posterior.
-- Referencias:
-- https://supabase.com/docs/guides/database/functions
-- https://www.postgresql.org/docs/current/functions-datetime.html
-- https://www.postgresql.org/docs/current/datatype-numeric.html
-- https://www.postgresql.org/docs/current/sql-createpolicy.html

begin;

create or replace function public.guardar_lectura_pozos(
  p_id uuid,
  p_turno_id uuid,
  p_pozo1_ini numeric,
  p_pozo1_fin numeric,
  p_pozo2_ini numeric,
  p_pozo2_fin numeric,
  p_notas text default null,
  p_original jsonb default null
)
returns setof public.lecturas_pozos
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  cuenta uuid := auth.uid();
  turno_captura public.turnos_operativos%rowtype;
  existente public.lecturas_pozos%rowtype;
  notas_limpias text := nullif(btrim(p_notas), '');
  valores_actuales jsonb;
  hora_captura timestamptz;
begin
  if cuenta is null or private.rol_actual() is distinct from 'calderas'::public.rol_usuario then
    raise exception using errcode = '42501',
      message = 'Solo una cuenta de Calderas activa puede guardar lecturas de Pozos.';
  end if;

  if p_id is null or p_turno_id is null
    or p_pozo1_ini is null or p_pozo1_fin is null
    or p_pozo2_ini is null or p_pozo2_fin is null
    or p_pozo1_ini::text in ('NaN', 'Infinity', '-Infinity')
    or p_pozo1_fin::text in ('NaN', 'Infinity', '-Infinity')
    or p_pozo2_ini::text in ('NaN', 'Infinity', '-Infinity')
    or p_pozo2_fin::text in ('NaN', 'Infinity', '-Infinity')
  then
    raise exception using errcode = '22023',
      message = 'Completa las cuatro lecturas de Pozos con números válidos.';
  end if;
  if p_pozo1_fin < p_pozo1_ini or p_pozo2_fin < p_pozo2_ini then
    raise exception using errcode = '22023',
      message = 'La lectura final de cada pozo debe ser mayor o igual a la inicial.';
  end if;
  if p_original is not null and jsonb_typeof(p_original) <> 'object' then
    raise exception using errcode = '22023',
      message = 'Actualiza la lectura guardada antes de corregirla.';
  end if;

  -- Serializa las llamadas RPC del turno, incluso con UUID nuevos.
  perform pg_advisory_xact_lock(hashtextextended('copamex:pozos:turno:' || p_turno_id::text, 0));

  -- Compartir el bloqueo con el cierre impide guardar mientras cambia el turno.
  select t.* into turno_captura from public.turnos_operativos t
  where t.id = p_turno_id for share;
  if not found or turno_captura.area <> 'calderas'
    or turno_captura.iniciado_por is distinct from cuenta
  then
    raise exception using errcode = '42501',
      message = 'La lectura debe corresponder a un turno de tu cuenta en Calderas.';
  end if;

  -- Leer sin FOR UPDATE permite confirmar un reintento aunque haya vencido
  -- el permiso de UPDATE. La escritura compara p_original de forma atómica.
  select l.* into existente from public.lecturas_pozos l
  where l.turno_id = p_turno_id;
  if found then
    if existente.id is distinct from p_id then
      raise exception using errcode = '23505',
        message = 'Ese turno ya tiene lecturas de Pozos. Actualiza la información para consultarlas.';
    end if;
    if existente.creado_por is distinct from cuenta
      or existente.eliminado_en is not null or existente.eliminado_por is not null
    then
      raise exception using errcode = '42501',
        message = 'Esta lectura no está disponible para corregirse desde tu cuenta.';
    end if;

    -- Reintento sin escrituras: confirma el resultado que ya está guardado,
    -- incluso si terminó la hora de corrección o el turno ya fue cerrado.
    if row(existente.pozo1_ini, existente.pozo1_fin,
           existente.pozo2_ini, existente.pozo2_fin, existente.notas)
      is not distinct from row(p_pozo1_ini, p_pozo1_fin, p_pozo2_ini, p_pozo2_fin, notas_limpias)
    then
      return next existente;
      return;
    end if;
    if p_original is null then
      raise exception using errcode = '23505',
        message = 'La captura ya fue recibida con otros valores. Usa Corregir lectura.';
    end if;

    valores_actuales := jsonb_build_object(
      'pozo1_ini', existente.pozo1_ini, 'pozo1_fin', existente.pozo1_fin,
      'pozo2_ini', existente.pozo2_ini, 'pozo2_fin', existente.pozo2_fin,
      'notas', existente.notas
    );
    if p_original is distinct from valores_actuales then
      raise exception using errcode = '40001',
        message = 'La lectura cambió desde que la abriste. Actualiza antes de corregirla.';
    end if;
    if not private.en_plazo_correccion(existente.capturado_en, existente.recibido_en)
      or not private.puede_capturar_en_turno(p_turno_id, 'pozos', existente.capturado_en)
    then
      raise exception using errcode = '42501',
        message = 'Terminó la hora para corregir esta lectura. Solicita la corrección al administrador.';
    end if;

    update public.lecturas_pozos
    set pozo1_ini = p_pozo1_ini, pozo1_fin = p_pozo1_fin,
        pozo2_ini = p_pozo2_ini, pozo2_fin = p_pozo2_fin, notas = notas_limpias
    where id = p_id
      and jsonb_build_object(
        'pozo1_ini', pozo1_ini, 'pozo1_fin', pozo1_fin,
        'pozo2_ini', pozo2_ini, 'pozo2_fin', pozo2_fin,
        'notas', notas
      ) = p_original
    returning * into existente;
    if not found then
      raise exception using errcode = '42501',
        message = 'No se pudo corregir la lectura. Revisa los permisos y el plazo de corrección.';
    end if;
    return next existente;
    return;
  end if;

  if p_original is not null then
    raise exception using errcode = '22023',
      message = 'No se encontró la lectura que intentas corregir. Actualiza la información.';
  end if;
  if turno_captura.finalizado_en is not null then
    raise exception using errcode = '42501',
      message = 'El turno ya está cerrado. Inicia tu turno para capturar lecturas de Pozos.';
  end if;
  if exists (select 1 from public.lecturas_pozos l where l.id = p_id) then
    raise exception using errcode = '23505',
      message = 'Ese identificador ya pertenece a otra lectura. Actualiza la información.';
  end if;

  -- Se toma después de adquirir el bloqueo, sin usar el reloj del navegador.
  hora_captura := clock_timestamp();
  if not private.puede_capturar_en_turno(p_turno_id, 'pozos', hora_captura) then
    raise exception using errcode = '42501',
      message = 'No se puede guardar esta lectura en el turno seleccionado.';
  end if;
  insert into public.lecturas_pozos (
    id, turno_id, pozo1_ini, pozo1_fin, pozo2_ini, pozo2_fin,
    notas, capturado_en, creado_por
  ) values (
    p_id, p_turno_id, p_pozo1_ini, p_pozo1_fin, p_pozo2_ini, p_pozo2_fin,
    notas_limpias, hora_captura, cuenta
  ) returning * into existente;
  return next existente;
end;
$$;

alter function public.guardar_lectura_pozos(uuid, uuid, numeric, numeric, numeric, numeric, text, jsonb)
  owner to postgres;
revoke all on function public.guardar_lectura_pozos(uuid, uuid, numeric, numeric, numeric, numeric, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.guardar_lectura_pozos(uuid, uuid, numeric, numeric, numeric, numeric, text, jsonb)
  to authenticated;

notify pgrst, 'reload schema';
commit;
