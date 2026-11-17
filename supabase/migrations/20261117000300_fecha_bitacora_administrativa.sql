-- LOCAL: pendiente de aplicar en Supabase. Admite capturar actividades de fechas anteriores.
-- La protección diaria existente sigue limitando a una actividad por área y fecha.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
begin
  if to_regclass('public.bitacora_administrativa') is null
    or to_regclass('private.bitacora_administrativa_dias') is null
    or not exists (
      select 1 from pg_catalog.pg_trigger
      where tgrelid = 'public.bitacora_administrativa'::regclass
        and tgname = 'proteger_bitacora_administrativa_diaria'
        and not tgisinternal
    ) then
    raise exception 'Aplicar primero 20261105000100 y 20261106000300.';
  end if;
  if to_regprocedure('public.guardar_bitacora_administrativa(uuid,uuid,text,text,integer)') is null then
    raise exception 'No existe la RPC esperada de Bitácora administrativa.';
  end if;
  if to_regprocedure('public.guardar_bitacora_administrativa(uuid,uuid,text,text,integer,date)') is not null then
    raise exception 'La RPC con fecha ya está instalada; revisar antes de repetir.';
  end if;
end;
$pre$;

drop function public.guardar_bitacora_administrativa(uuid,uuid,text,text,integer);

create function public.guardar_bitacora_administrativa(
  p_solicitud uuid,
  p_id uuid,
  p_area text,
  p_actividad text,
  p_revision integer default null,
  p_fecha date default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  cuenta uuid := auth.uid();
  hora timestamptz;
  fecha_guardar date;
  r public.bitacora_administrativa%rowtype;
  previa private.bitacora_administrativa_solicitudes%rowtype;
  datos jsonb;
  respuesta jsonb;
  texto text := btrim(p_actividad);
begin
  if cuenta is null or not private.es_admin() then
    raise exception using errcode = '42501', message = 'Solo Administración puede registrar o corregir actividades.';
  end if;
  if p_solicitud is null or p_id is null or p_area is null
    or p_area not in ('ptar','calderas','obra_civil') or texto is null
    or length(texto) not between 1 and 10000 or texto !~ '[^[:space:]]'
    or (p_revision is not null and p_revision < 0) then
    raise exception using errcode = '22023', message = 'Selecciona un área y escribe una actividad válida.';
  end if;

  hora := clock_timestamp();
  fecha_guardar := coalesce(p_fecha, (hora at time zone 'America/Mexico_City')::date);
  if fecha_guardar > (hora at time zone 'America/Mexico_City')::date then
    raise exception using errcode = '22023', message = 'La fecha de la actividad no puede ser futura.';
  end if;
  datos := jsonb_build_object('id',p_id,'area',p_area,'actividad',texto,'revision',p_revision,'fecha',fecha_guardar);

  perform pg_advisory_xact_lock(hashtextextended('copamex:ba:' || p_solicitud::text, 0));
  select * into previa from private.bitacora_administrativa_solicitudes where id = p_solicitud;
  if found then
    -- Acepta reintentos iniciados por la version anterior, que no guardaba fecha en el recibo.
    if previa.cuenta <> cuenta or (previa.datos <> datos and previa.datos <> (datos - 'fecha')) then
      raise exception using errcode = '22023', message = 'La solicitud ya corresponde a otros datos.';
    end if;
    return previa.respuesta;
  end if;

  if p_revision is null then
    insert into public.bitacora_administrativa
      (id,area,actividad,fecha,creado_en,creado_por,actualizado_en,actualizado_por)
    values (p_id,p_area,texto,fecha_guardar,hora,cuenta,hora,cuenta)
    returning * into r;
  else
    select * into r from public.bitacora_administrativa where id = p_id for update;
    if not found then
      raise exception using errcode = '40001', message = 'La actividad cambió. Actualiza el historial antes de corregirla.';
    end if;
    if p_fecha is not null and p_fecha <> r.fecha then
      raise exception using errcode = '22023', message = 'La fecha original no se puede cambiar al corregir una actividad.';
    end if;
    if r.revision <> p_revision then
      raise exception using errcode = '40001', message = 'La actividad cambió. Actualiza el historial antes de corregirla.';
    end if;
    update public.bitacora_administrativa set area=p_area, actividad=texto,
      actualizado_en=hora, actualizado_por=cuenta, revision=revision+1
    where id=p_id and revision=p_revision returning * into r;
    if not found then
      raise exception using errcode = '40001', message = 'La actividad cambió. Actualiza el historial antes de corregirla.';
    end if;
  end if;

  respuesta := jsonb_build_object('id',r.id,'area',r.area,'actividad',r.actividad,'fecha',r.fecha,
    'creado_en',r.creado_en,'actualizado_en',r.actualizado_en,'revision',r.revision);
  insert into private.bitacora_administrativa_solicitudes(id,cuenta,datos,respuesta)
    values(p_solicitud,cuenta,datos,respuesta);
  return respuesta;
end;
$function$;

alter function public.guardar_bitacora_administrativa(uuid,uuid,text,text,integer,date) owner to postgres;
revoke all on function public.guardar_bitacora_administrativa(uuid,uuid,text,text,integer,date) from public, anon, authenticated, service_role;
grant execute on function public.guardar_bitacora_administrativa(uuid,uuid,text,text,integer,date) to authenticated;
notify pgrst, 'reload schema';
commit;
