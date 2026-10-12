-- Fase 3: nombre escrito, inicio, cambio y cierre de turno.
-- Ejecutar completo como postgres DESPUÉS de las migraciones 001 a 023.
-- El cambio cierra el anterior e inicia el nuevo en la misma operación.
-- Un error revierte ambos pasos y también cualquier operador nuevo.
-- No modifica las capturas ni agrega un campo estado_turno.
-- Referencias:
-- https://supabase.com/docs/guides/database/functions
-- https://www.postgresql.org/docs/current/indexes-partial.html
-- https://www.postgresql.org/docs/current/explicit-locking.html

begin;

-- Si hubiera datos incompatibles, detenerse sin cerrar turnos arbitrariamente.
do $$
begin
  if exists (
    select 1 from public.turnos_operativos
    where finalizado_en is null
    group by area having count(*) > 1
  ) then
    raise exception 'Hay varios turnos abiertos en una misma área. Revisa esos turnos antes de ejecutar esta migración.';
  end if;
end;
$$;

create unique index if not exists turnos_un_abierto_por_area
  on public.turnos_operativos(area) where finalizado_en is null;

create or replace function private.nombre_operador_normalizado(p_nombre text)
returns text
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select btrim(regexp_replace(p_nombre, '[[:space:]]+', ' ', 'g'));
$$;

alter function private.nombre_operador_normalizado(text) owner to postgres;
revoke all on function private.nombre_operador_normalizado(text)
  from public, anon, authenticated;
grant execute on function private.nombre_operador_normalizado(text) to authenticated;

-- Solo esta función puede registrar un nombre desde una cuenta de área.
-- No otorga INSERT/UPDATE generales sobre operadores a esas cuentas.
create or replace function private.obtener_operador_por_nombre(p_nombre text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  nombre_limpio text := private.nombre_operador_normalizado(p_nombre);
  coincidencias integer := 0;
  candidato public.operadores%rowtype;
  encontrado public.operadores%rowtype;
  resultado uuid;
begin
  if auth.uid() is null
    or not coalesce(private.rol_actual() in ('calderas', 'ptar'), false)
  then
    raise exception using errcode = '42501',
      message = 'Solo una cuenta de área activa puede registrar un operador al iniciar turno.';
  end if;

  if nombre_limpio is null or nombre_limpio = '' then
    raise exception using errcode = '22023', message = 'Escribe el nombre completo del operador.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('copamex:operador:' || lower(nombre_limpio), 0));

  for candidato in
    select o.* from public.operadores o
    where lower(private.nombre_operador_normalizado(o.nombre)) = lower(nombre_limpio)
    order by o.id for update
  loop
    coincidencias := coincidencias + 1;
    encontrado := candidato;
  end loop;

  if coincidencias > 1 then
    raise exception using errcode = '22023',
      message = 'Hay varios operadores con ese nombre. Pide al administrador que distinga sus nombres antes de iniciar.';
  elsif coincidencias = 1 then
    if not encontrado.activo then
      raise exception using errcode = '22023',
        message = 'Ese operador está inactivo. Consulta al administrador.';
    end if;
    return encontrado.id;
  end if;

  insert into public.operadores(nombre) values (nombre_limpio)
  returning id into resultado;
  return resultado;
end;
$$;

alter function private.obtener_operador_por_nombre(text) owner to postgres;
revoke all on function private.obtener_operador_por_nombre(text)
  from public, anon, authenticated;
grant execute on function private.obtener_operador_por_nombre(text) to authenticated;

-- Sin p_turno_anterior: inicio normal; con él: cambio de turno explícito.
-- p_id se genera una sola vez en el cliente y se conserva al reintentar.
-- Se devuelve una fila, incluida la fila original en un reintento idéntico.
create or replace function public.iniciar_turno(
  p_id uuid,
  p_fecha_operativa date,
  p_turno public.turno_tipo,
  p_nombre_operador text,
  p_turno_anterior uuid default null
)
returns setof public.turnos_operativos
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  cuenta uuid := auth.uid();
  rol public.rol_usuario := private.rol_actual();
  area_cuenta public.area_planta;
  nombre_limpio text := private.nombre_operador_normalizado(p_nombre_operador);
  existente public.turnos_operativos%rowtype;
  anterior public.turnos_operativos%rowtype;
  hay_anterior boolean;
  operador_nuevo uuid;
  hora_cambio timestamptz;
begin
  if cuenta is null or not coalesce(rol in ('calderas', 'ptar'), false) then
    raise exception using errcode = '42501',
      message = 'Solo una cuenta de área activa puede iniciar o cambiar de turno.';
  end if;
  if p_id is null or p_fecha_operativa is null or p_turno is null
    or nombre_limpio is null or nombre_limpio = ''
  then
    raise exception using errcode = '22023',
      message = 'Selecciona fecha y tipo de turno, y escribe el nombre completo del operador.';
  end if;
  area_cuenta := rol::text::public.area_planta;

  perform pg_advisory_xact_lock(hashtextextended('copamex:turno:' || area_cuenta::text, 0));

  select t.* into existente from public.turnos_operativos t where t.id = p_id;
  if found then
    if existente.iniciado_por is distinct from cuenta
      or existente.area is distinct from area_cuenta
      or existente.fecha_operativa is distinct from p_fecha_operativa
      or existente.turno is distinct from p_turno
      or not exists (
        select 1 from public.operadores o where o.id = existente.operador_id
          and lower(private.nombre_operador_normalizado(o.nombre)) = lower(nombre_limpio)
      )
    then
      raise exception using errcode = '22023',
        message = 'Ese identificador ya corresponde a otro turno o a otros datos. Recarga la información.';
    end if;
    return query select t.* from public.turnos_operativos t where t.id = p_id;
    return;
  end if;

  if exists (
    select 1 from public.turnos_operativos t
    where t.area = area_cuenta and t.fecha_operativa = p_fecha_operativa and t.turno = p_turno
  ) then
    raise exception using errcode = '23505',
      message = 'Ya existe ese tipo de turno para esa fecha y área. Selecciona el turno y la fecha correctos.';
  end if;

  select t.* into anterior from public.turnos_operativos t
  where t.area = area_cuenta and t.finalizado_en is null for update;
  hay_anterior := found;

  if hay_anterior then
    if p_turno_anterior is distinct from anterior.id then
      raise exception using errcode = '22023',
        message = 'Hay un turno abierto. Recarga y utiliza Cambiar de turno para cerrarlo e iniciar el siguiente.';
    end if;
    if anterior.iniciado_por is distinct from cuenta then
      raise exception using errcode = '42501',
        message = 'Ese turno pertenece a otra cuenta del área. Pide al administrador que lo cierre.';
    end if;
  elsif p_turno_anterior is not null then
    raise exception using errcode = '22023',
      message = 'El turno anterior ya cambió o fue cerrado. Recarga antes de continuar.';
  end if;

  operador_nuevo := private.obtener_operador_por_nombre(nombre_limpio);
  hora_cambio := clock_timestamp();

  if hay_anterior then
    update public.turnos_operativos set finalizado_en = hora_cambio
    where id = anterior.id and iniciado_por = cuenta and finalizado_en is null;
    if not found then
      raise exception using errcode = '42501', message = 'No se pudo cerrar el turno anterior.';
    end if;
  end if;

  insert into public.turnos_operativos (
    id, fecha_operativa, area, turno, operador_id, iniciado_por, iniciado_en
  ) values (
    p_id, p_fecha_operativa, area_cuenta, p_turno, operador_nuevo, cuenta, hora_cambio
  );
  return query select t.* from public.turnos_operativos t where t.id = p_id;
end;
$$;

alter function public.iniciar_turno(uuid, date, public.turno_tipo, text, uuid) owner to postgres;
revoke all on function public.iniciar_turno(uuid, date, public.turno_tipo, text, uuid)
  from public, anon, authenticated;
grant execute on function public.iniciar_turno(uuid, date, public.turno_tipo, text, uuid)
  to authenticated;

create or replace function public.cerrar_turno(p_id uuid, p_notas text default null)
returns setof public.turnos_operativos
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  cuenta uuid := auth.uid();
  rol public.rol_usuario := private.rol_actual();
  actual public.turnos_operativos%rowtype;
  notas text := nullif(btrim(p_notas), '');
begin
  if cuenta is null or not coalesce(rol in ('calderas', 'ptar'), false) then
    raise exception using errcode = '42501',
      message = 'Solo una cuenta de área activa puede cerrar su turno desde esta pantalla.';
  end if;
  if p_id is null then
    raise exception using errcode = '22023', message = 'Indica el turno que quieres cerrar.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('copamex:turno:' || rol::text, 0));

  select t.* into actual from public.turnos_operativos t where t.id = p_id for update;
  if not found then
    raise exception using errcode = '22023', message = 'No se encontró el turno. Recarga la información.';
  end if;
  if actual.iniciado_por is distinct from cuenta or actual.area::text is distinct from rol::text then
    raise exception using errcode = '42501', message = 'Esta cuenta no puede cerrar ese turno.';
  end if;
  if actual.finalizado_en is not null then
    if actual.notas_cierre is distinct from notas then
      raise exception using errcode = '22023',
        message = 'El turno ya fue cerrado con otras notas. Recarga para consultar el cierre.';
    end if;
    return query select t.* from public.turnos_operativos t where t.id = p_id;
    return;
  end if;

  update public.turnos_operativos
  set finalizado_en = clock_timestamp(), notas_cierre = notas where id = p_id;
  if not found then
    raise exception using errcode = '42501', message = 'No se pudo cerrar el turno.';
  end if;
  return query select t.* from public.turnos_operativos t where t.id = p_id;
end;
$$;

alter function public.cerrar_turno(uuid, text) owner to postgres;
revoke all on function public.cerrar_turno(uuid, text) from public, anon, authenticated;
grant execute on function public.cerrar_turno(uuid, text) to authenticated;

notify pgrst, 'reload schema';
commit;
