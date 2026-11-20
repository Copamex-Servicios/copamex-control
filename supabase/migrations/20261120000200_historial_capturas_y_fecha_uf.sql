-- LOCAL: corregir paginación del historial y habilitar capturas administrativas de UF por fecha.
-- La fecha futura se rechaza también en el servidor; Pozos conserva su captura diaria actual.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if to_regprocedure('private.es_admin()') is null
    or to_regprocedure('private.inicio_medicion_admin(text,date,public.turno_tipo)') is null
    or to_regprocedure('public.consultar_referencia_medicion_admin(text,date,public.turno_tipo)') is null
    or to_regprocedure('public.crear_medicion_admin(text,uuid,date,public.turno_tipo,numeric,numeric,text)') is null
    or to_regprocedure('public.consultar_historial_mediciones_admin(text,integer,integer)') is null
    or to_regclass('public.lecturas_uf_admin') is null
    or to_regclass('public.lecturas_pozos_admin') is null then
    raise exception 'Falta aplicar la migración 20261119000300 de capturas administrativas sin turno.';
  end if;
  if to_regprocedure('public.consultar_referencia_uf_admin(date)') is not null
    or to_regprocedure('public.crear_medicion_uf_admin(uuid,date,numeric,numeric,text)') is not null then
    raise exception 'Las funciones de captura administrativa de UF ya existen; revisar antes de volver a aplicar.';
  end if;
end;
$pre$;

-- Alias distintos para la fila y el ordinal: evita convertir el ordinal escalar a JSON.
create or replace function public.consultar_historial_mediciones_admin(
  p_modulo text, p_limite integer default 7, p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare salida jsonb;
begin
  if auth.uid() is null or not coalesce(private.es_admin(), false) then
    raise exception using errcode = '42501', message = 'Solo Administración puede consultar estas lecturas.';
  end if;
  if p_modulo is null or p_modulo not in ('pozos', 'uf')
    or p_limite is null or p_limite not between 1 and 50
    or p_offset is null or p_offset < 0 then
    raise exception using errcode = '22023', message = 'Los filtros del historial no son válidos.';
  end if;

  if p_modulo = 'pozos' then
    with seleccion as (
      select l.id, l.fecha_operativa, l.turno, l.pozo1_ini inicial1, l.pozo1_fin final1,
        l.consumo_pozo1 consumo1, l.pozo2_ini inicial2, l.pozo2_fin final2,
        l.consumo_pozo2 consumo2, l.notas, l.capturado_en
      from public.lecturas_pozos_admin l
      order by l.fecha_operativa desc,
        case l.turno when 'noche' then 3 when 'tarde' then 2 else 1 end desc,
        l.capturado_en desc, l.id desc
      limit p_limite + 1 offset p_offset
    ), numeradas as (
      select seleccion.*,
        row_number() over (order by fecha_operativa desc,
          case turno when 'noche' then 3 when 'tarde' then 2 else 1 end desc,
          capturado_en desc, id desc) as numero_fila
      from seleccion
    )
    select pg_catalog.jsonb_build_object(
      'filas', coalesce(
        pg_catalog.jsonb_agg(pg_catalog.to_jsonb(numeradas) - 'numero_fila'
          order by numeradas.numero_fila) filter (where numeradas.numero_fila <= p_limite),
        '[]'::jsonb
      ),
      'mas', count(*) > p_limite
    ) into salida
    from numeradas;
  else
    with seleccion as (
      select l.id, l.fecha_operativa, l.turno, l.alim_ini inicial1, l.alim_fin final1,
        l.alimentado consumo1, l.acep_ini inicial2, l.acep_fin final2,
        l.aceptado consumo2, l.rechazo, l.rendimiento, l.notas, l.capturado_en
      from public.lecturas_uf_admin l
      order by l.fecha_operativa desc,
        case l.turno when 'noche' then 3 when 'tarde' then 2 else 1 end desc,
        l.capturado_en desc, l.id desc
      limit p_limite + 1 offset p_offset
    ), numeradas as (
      select seleccion.*,
        row_number() over (order by fecha_operativa desc,
          case turno when 'noche' then 3 when 'tarde' then 2 else 1 end desc,
          capturado_en desc, id desc) as numero_fila
      from seleccion
    )
    select pg_catalog.jsonb_build_object(
      'filas', coalesce(
        pg_catalog.jsonb_agg(pg_catalog.to_jsonb(numeradas) - 'numero_fila'
          order by numeradas.numero_fila) filter (where numeradas.numero_fila <= p_limite),
        '[]'::jsonb
      ),
      'mas', count(*) > p_limite
    ) into salida
    from numeradas;
  end if;
  return salida;
end;
$function$;

-- La captura de UF queda limitada en servidor al día elegido o cualquier fecha pasada.
-- El turno es fijo: Día. El RPC genérico para fechas continúa sin permiso directo de clientes.
create function public.consultar_referencia_uf_admin(p_fecha date)
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
  if p_fecha is null
    or p_fecha > (pg_catalog.statement_timestamp() at time zone 'America/Mexico_City')::date then
    raise exception using errcode = '22023', message = 'No se puede capturar UF en una fecha futura.';
  end if;

  resultado := public.consultar_referencia_medicion_admin('uf', p_fecha, 'dia');
  return resultado || pg_catalog.jsonb_build_object('fecha_operativa', p_fecha, 'turno', 'dia');
end;
$function$;

create function public.crear_medicion_uf_admin(
  p_id uuid, p_fecha date, p_final1 numeric, p_final2 numeric, p_notas text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not coalesce(private.es_admin(), false) then
    raise exception using errcode = '42501', message = 'Solo Administración puede guardar estas lecturas.';
  end if;
  if p_fecha is null
    or p_fecha > (pg_catalog.statement_timestamp() at time zone 'America/Mexico_City')::date then
    raise exception using errcode = '22023', message = 'No se puede capturar UF en una fecha futura.';
  end if;
  return public.crear_medicion_admin('uf', p_id, p_fecha, 'dia', p_final1, p_final2, p_notas);
end;
$function$;

alter function public.consultar_historial_mediciones_admin(text, integer, integer) owner to postgres;
alter function public.consultar_referencia_uf_admin(date) owner to postgres;
alter function public.crear_medicion_uf_admin(uuid, date, numeric, numeric, text) owner to postgres;

revoke all on function public.consultar_historial_mediciones_admin(text, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.consultar_historial_mediciones_admin(text, integer, integer) to authenticated;
revoke all on function public.consultar_referencia_uf_admin(date) from public, anon, authenticated, service_role;
grant execute on function public.consultar_referencia_uf_admin(date) to authenticated;
revoke all on function public.crear_medicion_uf_admin(uuid, date, numeric, numeric, text) from public, anon, authenticated, service_role;
grant execute on function public.crear_medicion_uf_admin(uuid, date, numeric, numeric, text) to authenticated;

notify pgrst, 'reload schema';
commit;
