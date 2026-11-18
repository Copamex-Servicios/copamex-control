-- LOCAL: pendiente de revisar y ejecutar en Supabase.
-- Agrega lecturas adicionales de Color M2 y AIMSU al mismo turno y hoja de Calidad.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
declare definicion_check text;
begin
  if to_regclass('private.tipos_seguimiento_calidad') is null
    or to_regprocedure('private.bt_operador_en_turno(public.turnos_operativos,timestamptz)') is null
    or to_regprocedure('public.guardar_lectura_seguimiento_calidad(uuid,uuid,uuid,numeric)') is null then
    raise exception 'Aplicar primero las migraciones de seguimiento M4 y horario de turnos.';
  end if;
  if (select count(*) from public.puntos_muestreo where
      (id = '20000000-0000-4000-8000-000000000001' and nombre = 'AIMSU') or
      (id = '20000000-0000-4000-8000-000000000003' and nombre = 'Pila M-2') or
      (id = '20000000-0000-4000-8000-000000000004' and nombre = 'Pila M-4')) <> 3
    or not exists(select 1 from public.parametros_calidad
      where id = '30000000-0000-4000-8000-000000000001' and lower(btrim(nombre)) = 'color') then
    raise exception 'No coincide el catálogo de puntos o el parámetro Color.';
  end if;
  if not exists(select 1 from pg_attribute where attrelid = 'public.muestras_calidad'::regclass
      and attname = 'seguimiento_valor_inicial' and not attisdropped) then
    raise exception 'Falta la columna para identificar lecturas adicionales de Calidad.';
  end if;
  select pg_catalog.pg_get_constraintdef(c.oid) into definicion_check
  from pg_catalog.pg_constraint c
  where c.conrelid = 'public.muestras_calidad'::regclass and c.conname = 'muestra_seguimiento_consistente';
  if definicion_check is null or upper(definicion_check) like '%SEGUIMIENTO_ID IS NOT NULL%' then
    raise exception 'Aplicar primero 20261117000200 para permitir lecturas adicionales sin aviso.';
  end if;
  if exists(select 1 from private.tipos_seguimiento_calidad c where c.tipo = 'color_m2'
      and (c.area::text <> 'calderas' or c.punto_id <> '20000000-0000-4000-8000-000000000003'
        or c.parametro_id <> '30000000-0000-4000-8000-000000000001'))
    or exists(select 1 from private.tipos_seguimiento_calidad c where c.tipo = 'color_aimsu'
      and (c.area::text <> 'calderas' or c.punto_id <> '20000000-0000-4000-8000-000000000001'
        or c.parametro_id <> '30000000-0000-4000-8000-000000000001')) then
    raise exception 'Ya existe una configuración de lectura adicional distinta; revisarla antes de continuar.';
  end if;
end;
$pre$;

-- El catálogo interno permite añadir otros puntos después sin ramificar la RPC.
insert into private.tipos_seguimiento_calidad(tipo, nombre, area, punto_id, parametro_id)
values
  ('color_m2', 'Lectura adicional de Color M2', 'calderas',
    '20000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001'),
  ('color_aimsu', 'Lectura adicional de Color AIMSU', 'calderas',
    '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001')
on conflict (tipo) do nothing;

-- Inserta una lectura independiente; el historial la compone en la hoja del turno,
-- conservando intacta la muestra habitual y sus resultados originales.
create function public.guardar_lectura_adicional_calidad(
  p_id uuid, p_turno uuid, p_tipo text, p_valor numeric, p_seguimiento uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  seguimiento public.seguimientos_calidad%rowtype;
  config private.tipos_seguimiento_calidad%rowtype;
  turno public.turnos_operativos%rowtype;
  muestra public.muestras_calidad%rowtype;
  instante timestamptz;
  previo text;
begin
  if auth.uid() is null or private.rol_actual()::text is distinct from 'calderas' then
    raise exception using errcode = '42501', message = 'Se requiere la cuenta activa de Calderas.';
  end if;
  if p_id is null or p_turno is null or nullif(btrim(p_tipo), '') is null or p_valor is null
    or p_valor::text in ('NaN', 'Infinity', '-Infinity')
    or abs(p_valor) > 9007199254740991 then
    raise exception using errcode = '22023', message = 'Escribe un valor numérico válido.';
  end if;

  select * into config from private.tipos_seguimiento_calidad where tipo = p_tipo;
  if not found or config.area::text <> 'calderas' then
    raise exception using errcode = '22023', message = 'El tipo de lectura adicional no está habilitado.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('copamex.muestras_calidad:' || p_id::text, 0));
  select * into muestra from public.muestras_calidad where id = p_id;
  if found then
    if muestra.turno_id <> p_turno or muestra.seguimiento_id is distinct from p_seguimiento
      or muestra.creado_por <> auth.uid() or muestra.seguimiento_valor_inicial is distinct from p_valor
      or not exists(select 1 from public.resultados_calidad r where r.muestra_id = p_id
        and r.punto_id = config.punto_id and r.parametro_id = config.parametro_id and r.valor = p_valor) then
      raise exception using errcode = '23505', message = 'El identificador corresponde a otra lectura.';
    end if;
    return p_id;
  end if;

  if p_seguimiento is not null then
    select * into seguimiento from public.seguimientos_calidad where id = p_seguimiento;
    if not found or seguimiento.tipo <> p_tipo or seguimiento.finalizado_en is not null then
      raise exception using errcode = '42501', message = 'El aviso asociado a la lectura ya no está activo.';
    end if;
    perform 1 from public.avisos a where a.id = seguimiento.aviso_id
      and (a.inicio is null or a.inicio <= pg_catalog.clock_timestamp())
      and (a.permanente or a.fin is null or a.fin > pg_catalog.clock_timestamp()) for share;
    if not found then
      raise exception using errcode = '42501', message = 'El aviso asociado a la lectura ya no está activo.';
    end if;
    select * into seguimiento from public.seguimientos_calidad where id = p_seguimiento for share;
    if not found or seguimiento.finalizado_en is not null then
      raise exception using errcode = '42501', message = 'El aviso asociado a la lectura ya no está activo.';
    end if;
  end if;

  select * into turno from public.turnos_operativos where id = p_turno for share;
  instante := pg_catalog.clock_timestamp();
  if not found or turno.finalizado_en is not null or turno.area::text <> config.area::text
    or turno.iniciado_por <> auth.uid() or not private.bt_operador_en_turno(turno, instante) then
    raise exception using errcode = '42501', message = 'La lectura requiere tu turno abierto dentro de su horario.';
  end if;
  if not exists(select 1 from public.muestras_calidad where turno_id = turno.id
      and seguimiento_valor_inicial is null and eliminado_en is null) then
    raise exception using errcode = '22023', message = 'Registra primero la muestra habitual de Calidad del turno.';
  end if;
  if not exists(select 1 from public.puntos_muestreo where id = config.punto_id and activo
      and (area is null or area = turno.area))
    or not exists(select 1 from public.parametros_calidad where id = config.parametro_id and activo) then
    raise exception using errcode = '22023', message = 'El punto o parámetro de Color ya no está habilitado.';
  end if;

  previo := current_setting('copamex.seguimiento_calidad', true);
  perform pg_catalog.set_config('copamex.seguimiento_calidad', p_id::text, true);
  insert into public.muestras_calidad(
    id, turno_id, hora_muestra, capturado_en, creado_por, seguimiento_id, seguimiento_valor_inicial
  ) values (
    p_id, turno.id, (instante at time zone 'America/Mexico_City')::time,
    instante, auth.uid(), p_seguimiento, p_valor
  );
  perform pg_catalog.set_config('copamex.seguimiento_calidad', coalesce(previo, ''), true);
  insert into public.resultados_calidad(id, muestra_id, punto_id, parametro_id, valor)
  values (pg_catalog.gen_random_uuid(), p_id, config.punto_id, config.parametro_id, p_valor);
  return p_id;
end;
$function$;

alter function public.guardar_lectura_adicional_calidad(uuid, uuid, text, numeric, uuid) owner to postgres;
revoke all on function public.guardar_lectura_adicional_calidad(uuid, uuid, text, numeric, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.guardar_lectura_adicional_calidad(uuid, uuid, text, numeric, uuid)
  to authenticated;

notify pgrst, 'reload schema';
commit;
