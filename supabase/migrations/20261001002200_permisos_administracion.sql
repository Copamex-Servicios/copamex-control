-- Fase 1: altas y cambios administrativos protegidos por RLS.
-- Ejecutar completo como postgres, después de las migraciones anteriores.
-- Las cuentas Calderas y PTAR conservan SELECT sobre la configuración.
-- Solo los perfiles admin activos pueden realizar cambios administrativos.
-- No crea cuentas Auth, operadores reales ni límites numéricos de la planta.
-- Referencia: https://supabase.com/docs/guides/database/postgres/row-level-security

begin;

-- Los identificadores de los catálogos se conservan al editar sus datos.
create or replace function private.proteger_identidad_catalogo()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (to_jsonb(new) -> tg_argv[0])
    is distinct from (to_jsonb(old) -> tg_argv[0])
  then
    raise exception using
      errcode = '42501',
      message = 'El identificador original del registro se conserva.';
  end if;
  return new;
end;
$$;

alter function private.proteger_identidad_catalogo() owner to postgres;
revoke all on function private.proteger_identidad_catalogo()
  from public, anon, authenticated;

do $$
declare
  tabla_catalogo text;
  columna_identidad text;
begin
  foreach tabla_catalogo in array array[
    'perfiles', 'operadores', 'puntos_muestreo', 'parametros_calidad',
    'maquinas', 'catalogo_papeles', 'parametros',
    'avisos', 'eventos_calendario', 'programa_produccion'
  ]
  loop
    columna_identidad := case when tabla_catalogo = 'parametros'
      then 'clave' else 'id' end;

    execute format(
      'drop trigger if exists proteger_identidad_catalogo on public.%I',
      tabla_catalogo
    );
    execute format(
      'create trigger proteger_identidad_catalogo '
      'before update on public.%I '
      'for each row execute function private.proteger_identidad_catalogo(%L)',
      tabla_catalogo, columna_identidad
    );
  end loop;
end;
$$;

-- La fecha y el autor de creación los fija el servidor y luego se conservan.
-- El argumento del trigger distingue tablas que tienen creado_por.
create or replace function private.proteger_creacion_catalogo()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.creado_en := clock_timestamp();
    if tg_argv[0] = 'con_autor' then
      if auth.uid() is not null then
        new.creado_por := auth.uid();
      end if;
    end if;
    return new;
  end if;

  if new.creado_en is distinct from old.creado_en then
    raise exception using
      errcode = '42501',
      message = 'La fecha original de creación se conserva.';
  end if;

  if tg_argv[0] = 'con_autor' then
    if new.creado_por is distinct from old.creado_por then
      raise exception using
        errcode = '42501',
        message = 'El autor original del registro se conserva.';
    end if;
  end if;

  return new;
end;
$$;

alter function private.proteger_creacion_catalogo() owner to postgres;
revoke all on function private.proteger_creacion_catalogo()
  from public, anon, authenticated;

do $$
declare
  tabla_catalogo text;
  tipo_metadata text;
begin
  foreach tabla_catalogo in array array[
    'perfiles', 'operadores', 'avisos',
    'eventos_calendario', 'programa_produccion'
  ]
  loop
    tipo_metadata := case when tabla_catalogo in ('perfiles', 'operadores')
      then 'sin_autor' else 'con_autor' end;

    execute format(
      'drop trigger if exists proteger_creacion_catalogo on public.%I',
      tabla_catalogo
    );
    execute format(
      'create trigger proteger_creacion_catalogo '
      'before insert or update on public.%I '
      'for each row execute function private.proteger_creacion_catalogo(%L)',
      tabla_catalogo, tipo_metadata
    );
  end loop;
end;
$$;

create or replace function private.registrar_actualizacion_parametro()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.actualizado_en := clock_timestamp();
  new.actualizado_por := auth.uid();
  return new;
end;
$$;

alter function private.registrar_actualizacion_parametro() owner to postgres;
revoke all on function private.registrar_actualizacion_parametro()
  from public, anon, authenticated;

drop trigger if exists registrar_actualizacion_parametro on public.parametros;
create trigger registrar_actualizacion_parametro
  before insert or update on public.parametros
  for each row execute function private.registrar_actualizacion_parametro();

-- Los permisos de tabla y las políticas trabajan juntos.
-- Se mantienen las políticas SELECT de 018 y se agregan INSERT y UPDATE.
do $$
declare
  tabla_catalogo text;
begin
  foreach tabla_catalogo in array array[
    'perfiles', 'operadores', 'puntos_muestreo', 'parametros_calidad',
    'maquinas', 'catalogo_papeles', 'parametros',
    'avisos', 'eventos_calendario', 'programa_produccion'
  ]
  loop
    execute format('alter table public.%I enable row level security', tabla_catalogo);
    execute format(
      'revoke all on table public.%I from public, anon, authenticated', tabla_catalogo
    );
    execute format(
      'grant select, insert, update on table public.%I to authenticated', tabla_catalogo
    );

    execute format('drop policy if exists alta_admin on public.%I', tabla_catalogo);
    execute format(
      'create policy alta_admin on public.%I '
      'for insert to authenticated '
      'with check ((select private.es_admin()))', tabla_catalogo
    );

    execute format('drop policy if exists cambio_admin on public.%I', tabla_catalogo);
    execute format(
      'create policy cambio_admin on public.%I '
      'for update to authenticated '
      'using ((select private.es_admin())) '
      'with check ((select private.es_admin()))', tabla_catalogo
    );
  end loop;
end;
$$;

-- Los límites se gestionan mediante estas dos operaciones controladas.
-- No se otorgan INSERT ni UPDATE directos sobre limites_calidad al cliente.
alter table public.limites_calidad enable row level security;
revoke all on table public.limites_calidad from public, anon, authenticated;
grant select on table public.limites_calidad to authenticated;
drop policy if exists alta_admin on public.limites_calidad;
drop policy if exists cambio_admin on public.limites_calidad;

create or replace function public.guardar_limite_calidad(
  p_punto_id uuid,
  p_parametro_id uuid,
  p_limite_min numeric default null,
  p_limite_max numeric default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  version_abierta public.limites_calidad%rowtype;
  existe_version boolean;
  fecha_cambio timestamptz;
  version_nueva uuid;
begin
  -- SECURITY DEFINER siempre exige el perfil real de auth.uid().
  -- No usar current_user = postgres como autorización en esta función.
  if auth.uid() is null or not private.es_admin() then
    raise exception using errcode = '42501',
      message = 'Solo un administrador activo puede gestionar límites de calidad.';
  end if;

  if p_punto_id is null or p_parametro_id is null then
    raise exception using errcode = '22023',
      message = 'Selecciona un punto y un parámetro de calidad.';
  end if;
  if p_limite_min is null and p_limite_max is null then
    raise exception using errcode = '22023',
      message = 'Define al menos un límite mínimo o máximo.';
  end if;
  if p_limite_min::text in ('NaN', 'Infinity', '-Infinity')
    or p_limite_max::text in ('NaN', 'Infinity', '-Infinity')
    or p_limite_min > p_limite_max
  then
    raise exception using errcode = '22023',
      message = 'Los límites deben ser números finitos y el mínimo no puede superar al máximo.';
  end if;

  -- La misma llave se usa para guardar y cerrar. El bloqueo dura la transacción.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'copamex.limites_calidad:' || p_punto_id::text || ':' || p_parametro_id::text, 0
  ));

  if not exists (
    select 1 from public.puntos_muestreo where id = p_punto_id and activo
  ) or not exists (
    select 1 from public.parametros_calidad where id = p_parametro_id and activo
  ) then
    raise exception using errcode = '22023',
      message = 'El punto y el parámetro deben existir y estar activos.';
  end if;

  select l.* into version_abierta
  from public.limites_calidad l
  where l.punto_id = p_punto_id
    and l.parametro_id = p_parametro_id
    and l.vigente_hasta is null
  for update;
  existe_version := found;

  -- Repetir los mismos valores conserva la versión y evita cambios innecesarios.
  if existe_version
    and version_abierta.limite_min is not distinct from p_limite_min
    and version_abierta.limite_max is not distinct from p_limite_max
  then
    return version_abierta.id;
  end if;

  fecha_cambio := clock_timestamp();
  if existe_version then
    if version_abierta.vigente_desde >= fecha_cambio then
      raise exception using errcode = '22023',
        message = 'La versión abierta comienza en una fecha futura; revisa su configuración.';
    end if;
    update public.limites_calidad
    set vigente_hasta = fecha_cambio
    where id = version_abierta.id;
  end if;

  insert into public.limites_calidad (
    punto_id, parametro_id, limite_min, limite_max,
    vigente_desde, creado_por
  ) values (
    p_punto_id, p_parametro_id, p_limite_min, p_limite_max,
    fecha_cambio, auth.uid()
  ) returning id into version_nueva;

  return version_nueva;
end;
$$;

alter function public.guardar_limite_calidad(uuid, uuid, numeric, numeric)
  owner to postgres;
revoke all on function public.guardar_limite_calidad(uuid, uuid, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.guardar_limite_calidad(uuid, uuid, numeric, numeric)
  to authenticated;

create or replace function public.cerrar_limite_calidad(
  p_punto_id uuid,
  p_parametro_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  version_abierta public.limites_calidad%rowtype;
  fecha_cierre timestamptz;
begin
  if auth.uid() is null or not private.es_admin() then
    raise exception using errcode = '42501',
      message = 'Solo un administrador activo puede gestionar límites de calidad.';
  end if;
  if p_punto_id is null or p_parametro_id is null then
    raise exception using errcode = '22023',
      message = 'Selecciona un punto y un parámetro de calidad.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'copamex.limites_calidad:' || p_punto_id::text || ':' || p_parametro_id::text, 0
  ));

  select l.* into version_abierta
  from public.limites_calidad l
  where l.punto_id = p_punto_id
    and l.parametro_id = p_parametro_id
    and l.vigente_hasta is null
  for update;

  if not found then
    return false;
  end if;

  fecha_cierre := clock_timestamp();
  if version_abierta.vigente_desde >= fecha_cierre then
    raise exception using errcode = '22023',
      message = 'La versión abierta comienza en una fecha futura; revisa su configuración.';
  end if;

  update public.limites_calidad
  set vigente_hasta = fecha_cierre
  where id = version_abierta.id;

  return true;
end;
$$;

alter function public.cerrar_limite_calidad(uuid, uuid) owner to postgres;
revoke all on function public.cerrar_limite_calidad(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.cerrar_limite_calidad(uuid, uuid)
  to authenticated;

-- La auditoría de 019 registra automáticamente todos estos cambios.
-- Los permisos operativos de turnos y capturas se agregan en el siguiente bloque.
commit;
