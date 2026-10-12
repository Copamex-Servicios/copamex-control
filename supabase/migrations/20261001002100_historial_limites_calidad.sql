-- Fase 1: versiones de límites y límites aplicados a cada resultado.
-- Ejecutar completo como postgres, después de las migraciones anteriores.
-- No agrega permisos de escritura para las cuentas de la aplicación.
--
-- Para sustituir un límite se cierra la versión anterior y se inserta otra,
-- usando la misma fecha de cambio, dentro de una sola transacción.
-- El periodo incluye vigente_desde y excluye vigente_hasta: [desde, hasta).
-- activo indica una versión sin cierre; las versiones cerradas conservan
-- su periodo para evaluar capturas antiguas que se sincronizan después.
-- No filtrar por activo al buscar el límite histórico de una captura.
--
-- Referencias:
-- https://www.postgresql.org/docs/current/rangetypes.html
-- https://www.postgresql.org/docs/current/btree-gist.html

begin;

-- Extensión de PostgreSQL; no requiere descargar un programa.
create extension if not exists btree_gist with schema extensions;

-- La exclusión protege también frente a escrituras simultáneas.
-- Busca el esquema real de la extensión si ya estaba instalada.
do $$
declare
  esquema_extension text;
begin
  select n.nspname into strict esquema_extension
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'btree_gist';

  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.limites_calidad'::regclass
      and c.conname = 'limites_calidad_sin_solapamiento'
  ) then
    execute format(
      'alter table public.limites_calidad '
      'add constraint limites_calidad_sin_solapamiento '
      'exclude using gist ('
      'punto_id %I.gist_uuid_ops with =, '
      'parametro_id %I.gist_uuid_ops with =, '
      '(pg_catalog.tstzrange(vigente_desde, vigente_hasta, ''[)'')) with &&'
      ')',
      esquema_extension, esquema_extension
    );
  end if;
end;
$$;

create or replace function private.proteger_version_limite()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.creado_en := clock_timestamp();
    if auth.uid() is not null then
      new.creado_por := auth.uid();
    end if;

    -- Una baja cierra la vigencia; nunca borra el historial.
    if new.activo is false and new.vigente_hasta is null then
      new.vigente_hasta := clock_timestamp();
    end if;

    new.activo := new.vigente_hasta is null;
    return new;
  end if;

  if row(
    new.id, new.punto_id, new.parametro_id,
    new.limite_min, new.limite_max, new.vigente_desde,
    new.creado_por, new.creado_en
  ) is distinct from row(
    old.id, old.punto_id, old.parametro_id,
    old.limite_min, old.limite_max, old.vigente_desde,
    old.creado_por, old.creado_en
  ) then
    raise exception using
      errcode = '42501',
      message = 'Un límite se cambia creando otra versión; la versión original se conserva.';
  end if;

  if old.vigente_hasta is not null then
    if new.vigente_hasta is distinct from old.vigente_hasta
      or new.activo is true
    then
      raise exception using
        errcode = '42501',
        message = 'Una versión cerrada conserva su fecha de cierre y no se reactiva.';
    end if;
  elsif new.activo is false and new.vigente_hasta is null then
    new.vigente_hasta := clock_timestamp();
  end if;

  new.activo := new.vigente_hasta is null;
  return new;
end;
$$;

alter function private.proteger_version_limite() owner to postgres;
revoke all on function private.proteger_version_limite()
  from public, anon, authenticated;

drop trigger if exists proteger_version_limite on public.limites_calidad;
create trigger proteger_version_limite
  before insert or update on public.limites_calidad
  for each row execute function private.proteger_version_limite();

create or replace function private.impedir_borrado_limites()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '42501',
    message = 'El historial de límites no se borra; se cierra la vigencia de la versión.';
end;
$$;

alter function private.impedir_borrado_limites() owner to postgres;
revoke all on function private.impedir_borrado_limites()
  from public, anon, authenticated;

drop trigger if exists impedir_delete_limites on public.limites_calidad;
create trigger impedir_delete_limites
  before delete on public.limites_calidad
  for each row execute function private.impedir_borrado_limites();

drop trigger if exists impedir_truncate_limites on public.limites_calidad;
create trigger impedir_truncate_limites
  before truncate on public.limites_calidad
  for each statement execute function private.impedir_borrado_limites();

-- En INSERT el servidor asigna los límites: no acepta los que envíe el cliente.
-- En UPDATE la protección instalada en 020 conserva estos límites originales.
create or replace function private.aplicar_limites_resultado_calidad()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  fecha_captura timestamptz;
  fecha_borrado timestamptz;
begin
  select m.capturado_en, m.eliminado_en
  into fecha_captura, fecha_borrado
  from public.muestras_calidad m
  where m.id = new.muestra_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'La muestra debe existir y estar disponible antes de guardar sus resultados.';
  end if;

  if fecha_borrado is not null then
    raise exception using
      errcode = '42501',
      message = 'No se agregan resultados a una muestra eliminada.';
  end if;

  new.limite_min_aplicado := null;
  new.limite_max_aplicado := null;

  select l.limite_min, l.limite_max
  into new.limite_min_aplicado, new.limite_max_aplicado
  from public.limites_calidad l
  where l.punto_id = new.punto_id
    and l.parametro_id = new.parametro_id
    and pg_catalog.tstzrange(l.vigente_desde, l.vigente_hasta, '[)') @> fecha_captura;

  -- Sin límite vigente, ambas columnas quedan NULL y fuera_norma también.
  -- La columna generada evalúa el valor usando el límite guardado.
  return new;
end;
$$;

alter function private.aplicar_limites_resultado_calidad() owner to postgres;
revoke all on function private.aplicar_limites_resultado_calidad()
  from public, anon, authenticated;

drop trigger if exists aplicar_limites_resultado_calidad on public.resultados_calidad;
create trigger aplicar_limites_resultado_calidad
  before insert on public.resultados_calidad
  for each row execute function private.aplicar_limites_resultado_calidad();

comment on column public.limites_calidad.activo is
  'Versión sin cierre. Las versiones cerradas siguen siendo válidas dentro de su periodo histórico.';
comment on column public.resultados_calidad.limite_min_aplicado is
  'Límite mínimo vigente en capturado_en de la muestra, asignado al insertar y conservado al corregir.';
comment on column public.resultados_calidad.limite_max_aplicado is
  'Límite máximo vigente en capturado_en de la muestra, asignado al insertar y conservado al corregir.';

commit;
