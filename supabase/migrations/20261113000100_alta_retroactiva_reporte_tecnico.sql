-- LOCAL: revisar y aplicar en Supabase antes de publicar la interfaz.
-- Permite capturar desde papel un reporte técnico de un turno pasado sin duplicar turnos.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
begin
  if to_regprocedure('private.bt_intervalo(date,public.turno_tipo)') is null
    or to_regprocedure('public.guardar_reporte_operativo(uuid,text,uuid,jsonb,uuid,bigint)') is null
    or to_regprocedure('private.btr_normalizar_calderas(jsonb)') is null
    or to_regprocedure('private.btr_normalizar_ptar(jsonb)') is null
    or to_regprocedure('private.bt_completo(text,jsonb)') is null
    or to_regprocedure('private.bt_snapshot_v1(text,uuid)') is null
    or to_regprocedure('private.bt_fecha_turno(timestamptz)') is null
    or to_regprocedure('private.asignar_inicio_turno()') is null
    or to_regprocedure('private.proteger_turno_operativo()') is null
    or to_regprocedure('private.registrar_auditoria()') is null then
    raise exception 'Aplicar primero las migraciones de turnos, auditoría y correcciones de horario técnico.';
  end if;
  if to_regprocedure('public.crear_reporte_tecnico_historico(uuid,date,text,public.turno_tipo,text,text,jsonb)') is not null then
    raise exception 'La captura histórica ya está instalada. Revisar antes de volver a aplicar.';
  end if;
  if not exists(select 1 from pg_attribute where attrelid='public.operadores'::regclass and attname='numero_empleado' and not attisdropped)
    or not exists(select 1 from pg_attribute where attrelid='public.turnos_operativos'::regclass and attname='operador_acompanante_id' and not attisdropped)
    or to_regclass('private.solicitudes_bitacora_tecnica') is null then
    raise exception 'Faltan las columnas de empleado, pareja de operadores o comprobantes técnicos.';
  end if;
end;
$pre$;

-- El inicio histórico solo se acepta dentro de la RPC administrativa que establece
-- un contexto transaccional vinculado al UUID del turno que se está insertando.
create or replace function private.asignar_inicio_turno()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  contexto jsonb;
  intervalo record;
begin
  if auth.uid() is not null and coalesce(private.es_admin(), false) then
    contexto := nullif(current_setting('copamex.turno_historico', true), '')::jsonb;
    if contexto ->> 'turno_id' = new.id::text then
      if contexto ->> 'fecha' is null
        or contexto ->> 'turno' is distinct from new.turno::text then
        raise exception using errcode = '42501', message = 'El contexto de captura histórica no corresponde al turno.';
      end if;
      new.fecha_operativa := (contexto ->> 'fecha')::date;
      new.iniciado_en := (contexto ->> 'inicio')::timestamptz;
      select * into intervalo from private.bt_intervalo(new.fecha_operativa, new.turno);
      if new.iniciado_en is distinct from intervalo.inicio
        or new.finalizado_en is distinct from intervalo.fin
        or intervalo.fin > statement_timestamp() then
        raise exception using errcode = '22023', message = 'Solo se puede capturar un turno histórico ya terminado.';
      end if;
      return new;
    end if;
  end if;

  new.iniciado_en := statement_timestamp();
  new.fecha_operativa := private.bt_fecha_turno(new.iniciado_en);
  if not coalesce(private.es_admin(), false)
    and not exists (
      select 1 from private.bt_intervalo(new.fecha_operativa, new.turno) v
      where new.iniciado_en >= v.inicio and new.iniciado_en < v.fin
    ) then
    raise exception using errcode = '22023', message = 'Selecciona el turno que corresponde al horario actual del servidor.';
  end if;
  return new;
end;
$function$;
alter function private.asignar_inicio_turno() owner to postgres;
revoke all on function private.asignar_inicio_turno() from public, anon, authenticated, service_role;
grant execute on function private.asignar_inicio_turno() to authenticated;

create function public.crear_reporte_tecnico_historico(
  p_id uuid,
  p_fecha date,
  p_area text,
  p_turno public.turno_tipo,
  p_numero_empleado text,
  p_numero_empleado_acompanante text,
  p_datos jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  cuenta uuid := auth.uid();
  modulo text;
  datos jsonb;
  datos_reintento jsonb;
  operador uuid;
  operador_acompanante uuid;
  coincidencias integer;
  existente private.solicitudes_bitacora_tecnica%rowtype;
  turno_existente public.turnos_operativos%rowtype;
  nuevo_turno uuid := pg_catalog.gen_random_uuid();
  intervalo record;
  respuesta jsonb;
begin
  if cuenta is null or not coalesce(private.es_admin(), false) then
    raise exception using errcode = '42501', message = 'Solo Administración puede capturar reportes técnicos históricos.';
  end if;
  if p_id is null or p_fecha is null or p_area is null or p_area not in ('calderas', 'ptar') or p_turno is null
    or nullif(pg_catalog.btrim(p_numero_empleado), '') is null
    or nullif(pg_catalog.btrim(p_numero_empleado_acompanante), '') is null
    or pg_catalog.upper(pg_catalog.btrim(p_numero_empleado)) = pg_catalog.upper(pg_catalog.btrim(p_numero_empleado_acompanante)) then
    raise exception using errcode = '22023', message = 'Indica el área, turno y dos números de empleado distintos.';
  end if;
  if p_fecha > (statement_timestamp() at time zone 'America/Mexico_City')::date then
    raise exception using errcode = '22023', message = 'No se pueden capturar reportes con fecha futura.';
  end if;

  modulo := 'bitacora_' || p_area;
  if p_area = 'calderas' then datos := private.btr_normalizar_calderas(p_datos);
  else datos := private.btr_normalizar_ptar(p_datos); end if;
  if not private.bt_completo(p_area, datos) then
    raise exception using errcode = '22023', message = 'Completa todos los campos obligatorios antes de guardar.';
  end if;

  -- Serializa reintentos con el mismo identificador antes de consultar el recibo.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('copamex.bt.operacion:' || p_id::text, 0)
  );

  select count(*) into coincidencias from public.operadores o
    where pg_catalog.upper(pg_catalog.btrim(o.numero_empleado)) = pg_catalog.upper(pg_catalog.btrim(p_numero_empleado));
  if coincidencias <> 1 then
    raise exception using errcode = '22023', message = 'No se encontró un operador único con el primer número de empleado.';
  end if;
  select o.id into strict operador from public.operadores o
    where pg_catalog.upper(pg_catalog.btrim(o.numero_empleado)) = pg_catalog.upper(pg_catalog.btrim(p_numero_empleado));

  select count(*) into coincidencias from public.operadores o
    where pg_catalog.upper(pg_catalog.btrim(o.numero_empleado)) = pg_catalog.upper(pg_catalog.btrim(p_numero_empleado_acompanante));
  if coincidencias <> 1 then
    raise exception using errcode = '22023', message = 'No se encontró un operador único con el segundo número de empleado.';
  end if;
  select o.id into strict operador_acompanante from public.operadores o
    where pg_catalog.upper(pg_catalog.btrim(o.numero_empleado)) = pg_catalog.upper(pg_catalog.btrim(p_numero_empleado_acompanante));
  if operador = operador_acompanante then
    raise exception using errcode = '22023', message = 'Selecciona dos operadores distintos.';
  end if;

  -- Un reintento confirmado devuelve el reporte original sin crear otro turno.
  datos_reintento := case when p_area = 'calderas'
    then private.btr_normalizar_calderas(datos)
    else private.btr_normalizar_ptar(datos) end;
  select * into existente from private.solicitudes_bitacora_tecnica where id = p_id;
  if found then
    select * into turno_existente from public.turnos_operativos where id = existente.turno_id;
    if existente.modulo <> modulo or existente.creado_por <> cuenta or existente.contenido_inicial is distinct from datos_reintento
      or not found or turno_existente.fecha_operativa <> p_fecha or turno_existente.area::text <> p_area
      or turno_existente.turno <> p_turno or turno_existente.operador_id <> operador
      or turno_existente.operador_acompanante_id <> operador_acompanante then
      raise exception using errcode = '23505', message = 'El identificador ya corresponde a otra captura histórica.';
    end if;
    return pg_catalog.jsonb_build_object('id', p_id, 'turno_id', existente.turno_id,
      'confirmado', true, 'reintento', true,
      'snapshot', private.bt_snapshot_v1(modulo, p_id));
  end if;

  -- Usa el mismo candado de inicio de turno y rechaza tanto reportes como turnos
  -- cerrados con pendientes. La restricción única vuelve a proteger carreras.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('copamex:turno:' || p_area, 0));
  if exists (select 1 from public.turnos_operativos t
    where t.fecha_operativa = p_fecha and t.area::text = p_area and t.turno = p_turno) then
    raise exception using errcode = '23505',
      message = 'Ese turno ya existe; no se puede agregar otro reporte. Revisa los reportes pendientes.';
  end if;
  select * into intervalo from private.bt_intervalo(p_fecha, p_turno);
  if intervalo.fin > statement_timestamp() then
    raise exception using errcode = '22023', message = 'Solo se puede capturar un turno cuyo horario ya terminó.';
  end if;

  perform pg_catalog.set_config('copamex.turno_historico', pg_catalog.jsonb_build_object(
    'turno_id', nuevo_turno, 'fecha', p_fecha, 'turno', p_turno, 'inicio', intervalo.inicio
  )::text, true);
  insert into public.turnos_operativos (
    id, fecha_operativa, area, turno, operador_id, operador_acompanante_id,
    iniciado_por, iniciado_en, finalizado_en
  ) values (
    nuevo_turno, p_fecha, p_area::public.area_planta, p_turno, operador, operador_acompanante,
    cuenta, intervalo.inicio, intervalo.fin
  );
  perform pg_catalog.set_config('copamex.turno_historico', '', true);

  respuesta := public.guardar_reporte_operativo(p_id, p_area, nuevo_turno, datos, null, null);
  return respuesta || pg_catalog.jsonb_build_object('turno_id', nuevo_turno, 'captura_historica', true);
end;
$function$;
alter function public.crear_reporte_tecnico_historico(uuid, date, text, public.turno_tipo, text, text, jsonb) owner to postgres;
revoke all on function public.crear_reporte_tecnico_historico(uuid, date, text, public.turno_tipo, text, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.crear_reporte_tecnico_historico(uuid, date, text, public.turno_tipo, text, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
