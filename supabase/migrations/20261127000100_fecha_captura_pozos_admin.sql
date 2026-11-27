-- Habilita la selección de fecha en la captura administrativa de Pozos.
-- Los huecos anteriores a una lectura posterior quedan bloqueados para no duplicar consumo.
begin;
set local lock_timeout = '5s';

create function private.motivo_bloqueo_fecha_pozos_admin(p_fecha date)
returns text
language sql
stable
set search_path = ''
as $function$
  select case
    when exists (
      select 1 from private.base_historica_pozos b
      where b.anio = extract(year from p_fecha)::integer and b.fecha_corte > p_fecha
    ) then 'La fecha es anterior al corte de la base histórica de Pozos.'
    when exists (
      select 1 from public.lecturas_pozos_admin l
      where l.fecha_operativa > p_fecha
        or (l.fecha_operativa = p_fecha and l.turno <> 'dia')
    ) or exists (
      select 1
      from public.lecturas_pozos l
      join public.turnos_operativos t on t.id = l.turno_id
      where t.area::text = 'calderas' and l.eliminado_en is null
        and (t.fecha_operativa > p_fecha
          or (t.fecha_operativa = p_fecha and t.turno <> 'dia'))
    ) then 'Ya hay una lectura posterior. No se puede capturar esta fecha sin duplicar consumo.'
  end;
$function$;

create function public.consultar_referencia_pozos_admin(p_fecha date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare resultado jsonb;
begin
  if auth.uid() is null or not coalesce(private.es_admin(), false) then
    raise exception using errcode = '42501', message = 'Solo Administración puede consultar estas lecturas.';
  end if;
  if p_fecha is null or not pg_catalog.isfinite(p_fecha)
    or p_fecha > (pg_catalog.statement_timestamp() at time zone 'America/Mexico_City')::date then
    raise exception using errcode = '22023', message = 'Selecciona hoy o una fecha anterior para Pozos.';
  end if;

  resultado := public.consultar_referencia_medicion_admin('pozos', p_fecha, 'dia');
  return resultado || pg_catalog.jsonb_build_object(
    'fecha_operativa', p_fecha, 'turno', 'dia',
    'motivo_bloqueo', private.motivo_bloqueo_fecha_pozos_admin(p_fecha)
  );
end;
$function$;

create function public.crear_medicion_pozos_admin(
  p_id uuid, p_fecha date, p_final1 numeric, p_final2 numeric, p_notas text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare motivo text;
begin
  if auth.uid() is null or not coalesce(private.es_admin(), false) then
    raise exception using errcode = '42501', message = 'Solo Administración puede guardar estas lecturas.';
  end if;
  if p_fecha is null or not pg_catalog.isfinite(p_fecha)
    or p_fecha > (pg_catalog.statement_timestamp() at time zone 'America/Mexico_City')::date then
    raise exception using errcode = '22023', message = 'Selecciona hoy o una fecha anterior para Pozos.';
  end if;

  -- Usa el mismo orden de bloqueo que la captura diaria y la función de guardado existente.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('copamex:lectura-admin:pozos:' || p_fecha::text || ':dia', 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('copamex:lectura-admin:secuencia:pozos', 0)
  );

  -- Reintentos del mismo identificador se comprueban incluso si ya avanzó la secuencia.
  if not exists (select 1 from public.lecturas_pozos_admin l where l.id = p_id) then
    motivo := private.motivo_bloqueo_fecha_pozos_admin(p_fecha);
    if motivo is not null then
      raise exception using errcode = '22023', message = motivo;
    end if;
  end if;

  return public.crear_medicion_admin('pozos', p_id, p_fecha, 'dia', p_final1, p_final2, p_notas);
end;
$function$;

alter function private.motivo_bloqueo_fecha_pozos_admin(date) owner to postgres;
revoke all on function private.motivo_bloqueo_fecha_pozos_admin(date) from public, anon, authenticated, service_role;
alter function public.consultar_referencia_pozos_admin(date) owner to postgres;
revoke all on function public.consultar_referencia_pozos_admin(date) from public, anon, authenticated, service_role;
grant execute on function public.consultar_referencia_pozos_admin(date) to authenticated;
alter function public.crear_medicion_pozos_admin(uuid, date, numeric, numeric, text) owner to postgres;
revoke all on function public.crear_medicion_pozos_admin(uuid, date, numeric, numeric, text) from public, anon, authenticated, service_role;
grant execute on function public.crear_medicion_pozos_admin(uuid, date, numeric, numeric, text) to authenticated;

notify pgrst, 'reload schema';
commit;
