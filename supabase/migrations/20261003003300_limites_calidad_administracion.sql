-- Máximos confirmados por Erick a partir del diseño original.
-- Carga inicial solo para pares sin ninguna versión previa; no sustituye configuración existente.
-- Cambios futuros: RPC con versión esperada e identificador estable para reintentos.
begin;

create or replace function public.guardar_limite_calidad_versionado(
  p_id uuid, p_version_esperada uuid, p_punto_id uuid, p_parametro_id uuid,
  p_limite_min numeric, p_limite_max numeric
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  actual public.limites_calidad%rowtype;
  repetida public.limites_calidad%rowtype;
  cambio timestamptz;
begin
  if auth.uid() is null or not private.es_admin() then
    raise exception using errcode='42501', message='Solo un administrador activo puede cambiar límites.';
  end if;
  if p_id is null or p_punto_id is null or p_parametro_id is null
    or (p_limite_min is null and p_limite_max is null)
    or p_limite_min::text in ('NaN','Infinity','-Infinity')
    or p_limite_max::text in ('NaN','Infinity','-Infinity')
    or p_limite_min > p_limite_max then
    raise exception using errcode='22023', message='Define límites numéricos válidos; el mínimo no puede superar al máximo.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'copamex.limites_calidad:' || p_punto_id::text || ':' || p_parametro_id::text, 0));
  select * into repetida from public.limites_calidad where id=p_id;
  if found then
    if repetida.punto_id=p_punto_id and repetida.parametro_id=p_parametro_id
      and repetida.limite_min is not distinct from p_limite_min
      and repetida.limite_max is not distinct from p_limite_max
      and repetida.creado_por=auth.uid() then
      return p_id; -- Confirmar incluso si otro cambio ya cerró esta versión; nunca reactivarla.
    end if;
    raise exception using errcode='23505', message='El identificador de guardado corresponde a otra solicitud.';
  end if;
  if not exists(select 1 from public.puntos_muestreo where id=p_punto_id and activo)
    or not exists(select 1 from public.parametros_calidad where id=p_parametro_id and activo) then
    raise exception using errcode='22023', message='El punto y el parámetro deben estar activos.';
  end if;
  select * into actual from public.limites_calidad
    where punto_id=p_punto_id and parametro_id=p_parametro_id and vigente_hasta is null for update;
  if actual.id is distinct from p_version_esperada then
    raise exception using errcode='40001', message='Otro administrador cambió este límite. Actualiza y revisa la nueva versión.';
  end if;
  cambio := clock_timestamp();
  if actual.id is not null then
    if actual.vigente_desde >= cambio then
      raise exception using errcode='22023', message='La versión actual tiene una fecha futura; revisa su configuración.';
    end if;
    update public.limites_calidad set vigente_hasta=cambio where id=actual.id;
  end if;
  insert into public.limites_calidad(id,punto_id,parametro_id,limite_min,limite_max,vigente_desde,creado_por)
    values(p_id,p_punto_id,p_parametro_id,p_limite_min,p_limite_max,cambio,auth.uid());
  return p_id;
end;
$$;
alter function public.guardar_limite_calidad_versionado(uuid,uuid,uuid,uuid,numeric,numeric) owner to postgres;
revoke all on function public.guardar_limite_calidad_versionado(uuid,uuid,uuid,uuid,numeric,numeric) from public,anon,authenticated;
grant execute on function public.guardar_limite_calidad_versionado(uuid,uuid,uuid,uuid,numeric,numeric) to authenticated;

create or replace function public.cargar_limites_diseno_calidad()
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare r record; punto uuid; parametro uuid; fecha timestamptz := clock_timestamp(); cantidad integer := 0;
begin
  if auth.uid() is null or not private.es_admin() then
    raise exception using errcode='42501', message='Solo un administrador activo puede cargar los límites del diseño.';
  end if;
  for r in select * from (values
    (1,1,300),(1,2,25),(2,1,100),(3,1,250),(4,1,250),
    (5,1,70),(6,1,250),(7,1,500),(8,1,500)
  ) as d(p,q,maximo) loop
    punto := ('20000000-0000-4000-8000-' || lpad(r.p::text,12,'0'))::uuid;
    parametro := ('30000000-0000-4000-8000-' || lpad(r.q::text,12,'0'))::uuid;
    if not exists(select 1 from public.puntos_muestreo where id=punto)
      or not exists(select 1 from public.parametros_calidad where id=parametro) then
      raise exception 'No se encontraron los catálogos originales. La instalación se cancela sin cambios.';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'copamex.limites_calidad:' || punto::text || ':' || parametro::text,0));
    if not exists(select 1 from public.limites_calidad where punto_id=punto and parametro_id=parametro) then
      insert into public.limites_calidad(punto_id,parametro_id,limite_max,vigente_desde,creado_por)
        values(punto,parametro,r.maximo,fecha,auth.uid());
      cantidad := cantidad + 1;
    end if;
  end loop;
  return cantidad;
end;
$$;
alter function public.cargar_limites_diseno_calidad() owner to postgres;
revoke all on function public.cargar_limites_diseno_calidad() from public,anon,authenticated;
grant execute on function public.cargar_limites_diseno_calidad() to authenticated;

-- Comprobación integrada con filas temporales: todas se revierten en el sub-bloque.
-- Si falla, también se revierte la instalación. No cierra ni modifica turnos reales.
do $$
declare
  admin_id uuid; punto uuid := gen_random_uuid(); parametro uuid := gen_random_uuid();
  primero uuid := gen_random_uuid(); segundo uuid := gen_random_uuid(); respuesta uuid;
  completo boolean := false; previo jsonb; resultado jsonb;
  firma text := 'public.guardar_limite_calidad_versionado(uuid,uuid,uuid,uuid,numeric,numeric)';
begin
  if current_user <> 'postgres' then raise exception 'Ejecuta la instalación con postgres en SQL Editor.'; end if;
  if not has_function_privilege('authenticated',firma,'EXECUTE')
    or has_function_privilege('anon',firma,'EXECUTE')
    or not has_function_privilege('authenticated','public.cargar_limites_diseno_calidad()','EXECUTE')
    or has_function_privilege('anon','public.cargar_limites_diseno_calidad()','EXECUTE') then
    raise exception 'Permisos de funciones incorrectos.';
  end if;
  select id into admin_id from public.perfiles where rol='admin' and activo order by id limit 1;
  if admin_id is null then raise exception 'Configura primero una cuenta administradora activa.'; end if;
  begin
    perform set_config('request.jwt.claim.sub',admin_id::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
    insert into public.puntos_muestreo(id,nombre,activo) values(punto,'PRUEBA LÍMITES 033 '||punto::text,true);
    insert into public.parametros_calidad(id,nombre,activo) values(parametro,'PRUEBA LÍMITES 033 '||parametro::text,true);
    respuesta := public.guardar_limite_calidad_versionado(primero,null,punto,parametro,null,300);
    if respuesta <> primero then raise exception 'La primera versión no coincide.'; end if;
    respuesta := public.guardar_limite_calidad_versionado(primero,null,punto,parametro,null,300);
    if respuesta <> primero or (select count(*) from public.limites_calidad where punto_id=punto) <> 1 then
      raise exception 'Un reintento duplicó la versión.';
    end if;
    respuesta := public.guardar_limite_calidad_versionado(segundo,primero,punto,parametro,null,250);
    if respuesta <> segundo
      or (select limite_max from public.limites_calidad where id=primero) <> 300
      or (select vigente_hasta from public.limites_calidad where id=primero) is null
      or (select vigente_hasta from public.limites_calidad where id=primero) is distinct from (select vigente_desde from public.limites_calidad where id=segundo)
      or (select creado_por from public.limites_calidad where id=segundo) <> admin_id then
      raise exception 'No se conservó la versión anterior o su responsable.';
    end if;
    respuesta := public.guardar_limite_calidad_versionado(primero,null,punto,parametro,null,300);
    if respuesta <> primero or not exists(select 1 from public.limites_calidad where id=segundo and activo) then
      raise exception 'El reintento histórico reactivó un límite viejo.';
    end if;
    begin
      perform public.guardar_limite_calidad_versionado(gen_random_uuid(),primero,punto,parametro,null,100);
      raise exception 'No se detectó conflicto de versión.';
    exception when serialization_failure then null; end;
    begin
      perform public.guardar_limite_calidad_versionado(gen_random_uuid(),segundo,punto,parametro,400,300);
      raise exception 'Se aceptó un rango inválido.';
    exception when invalid_parameter_value then null; end;
    perform set_config('request.jwt.claim.sub','',true);
    perform set_config('request.jwt.claims','{}',true);
    begin
      perform public.guardar_limite_calidad_versionado(gen_random_uuid(),segundo,punto,parametro,null,100);
      raise exception 'Se aceptó una cuenta sin autorización.';
    exception when insufficient_privilege then null; end;
    perform set_config('request.jwt.claim.sub',admin_id::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
    select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]'::jsonb) into previo from public.limites_calidad l;
    perform public.cargar_limites_diseno_calidad();
    if public.cargar_limites_diseno_calidad() <> 0 then raise exception 'La carga inicial no es repetible.'; end if;
    select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]'::jsonb) into resultado
      from public.limites_calidad l where l.id in (select (v->>'id')::uuid from jsonb_array_elements(previo) v);
    if resultado is distinct from previo then raise exception 'La carga del diseño alteró una versión existente.'; end if;
    raise exception using errcode='P0001',message='ROLLBACK_PRUEBA_033_APROBADA';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'ROLLBACK_PRUEBA_033_APROBADA' then raise; end if;
    completo := true;
  end;
  if not completo or exists(select 1 from public.puntos_muestreo where id=punto)
    or exists(select 1 from public.limites_calidad where punto_id=punto)
    or exists(select 1 from public.parametros_calidad where id=parametro)
    or exists(select 1 from public.auditoria where registro_id in (punto::text,parametro::text,primero::text,segundo::text)) then
    raise exception 'No se completó el rollback de las pruebas.';
  end if;
end;
$$;
commit;
select 'Límites de Calidad' as comprobacion, 'APROBADA' as resultado,
  'Funciones instaladas; reintentos, conflicto de versión, permisos, historial y carga inicial comprobados. Carga los valores desde Administración.' as detalle;
