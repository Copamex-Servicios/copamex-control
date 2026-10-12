-- Fase 1: protecciones previas a los permisos de captura.
-- Ejecutar completo como postgres, después de las migraciones anteriores.
-- Decisión: operadores corrigen durante una hora desde capturado_en original.
-- Administradores activos pueden corregir después de ese plazo.
-- La sincronización tardía no reinicia la hora de corrección.
-- Las políticas de acceso y los límites automáticos de Calidad se agregan después.

begin;

create or replace function private.en_plazo_correccion(
  fecha_captura timestamptz,
  fecha_recepcion timestamptz
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  hora_servidor timestamptz := clock_timestamp();
begin
  return fecha_captura is not null
    and fecha_recepcion is not null
    and hora_servidor >= fecha_captura
    and hora_servidor <= fecha_captura + interval '1 hour'
    -- Impide extender el plazo con una fecha de captura futura o incoherente.
    and hora_servidor <= fecha_recepcion + interval '1 hour';
end;
$$;

alter function private.en_plazo_correccion(timestamptz, timestamptz)
  owner to postgres;
revoke all on function private.en_plazo_correccion(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function private.en_plazo_correccion(timestamptz, timestamptz)
  to authenticated;

-- Los cinco encabezados de captura comparten estos campos de identificación.
create or replace function private.proteger_metadata_captura()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  es_administrador boolean;
begin
  -- postgres y service_role son contextos privilegiados del servidor.
  -- La aplicación utiliza authenticated y no incluye una clave service_role.
  es_administrador := current_user in ('postgres', 'service_role');
  if not es_administrador then
    es_administrador := private.es_admin();
  end if;

  if tg_op = 'INSERT' then
    new.recibido_en := clock_timestamp();

    if auth.uid() is not null then
      new.creado_por := auth.uid();
    end if;

    new.eliminado_en := null;
    new.eliminado_por := null;
    return new;
  end if;

  if row(
    new.id, new.turno_id, new.creado_por,
    new.capturado_en, new.recibido_en
  ) is distinct from row(
    old.id, old.turno_id, old.creado_por,
    old.capturado_en, old.recibido_en
  ) then
    raise exception using
      errcode = '42501',
      message = 'La identidad, turno, autor y fechas originales de la captura se conservan.';
  end if;

  if not es_administrador then
    if not coalesce(
      private.rol_actual() in (
        'calderas'::public.rol_usuario,
        'ptar'::public.rol_usuario
      ), false
    )
      or old.creado_por is distinct from auth.uid()
      or old.eliminado_en is not null
      or not private.en_plazo_correccion(old.capturado_en, old.recibido_en)
    then
      raise exception using
        errcode = '42501',
        message = 'Solo se pueden corregir capturas propias durante la primera hora desde su captura.';
    end if;
  end if;

  if row(new.eliminado_en, new.eliminado_por)
    is distinct from row(old.eliminado_en, old.eliminado_por)
  then
    if not es_administrador then
      raise exception using
        errcode = '42501',
        message = 'Solo un administrador puede realizar o revertir un borrado lógico.';
    end if;

    if new.eliminado_en is null then
      new.eliminado_por := null;
    elsif old.eliminado_en is null then
      new.eliminado_en := clock_timestamp();
      new.eliminado_por := coalesce(auth.uid(), new.eliminado_por);
    else
      raise exception using
        errcode = '42501',
        message = 'Los datos originales de un borrado lógico se conservan.';
    end if;
  end if;

  return new;
end;
$$;

alter function private.proteger_metadata_captura() owner to postgres;
revoke all on function private.proteger_metadata_captura()
  from public, anon, authenticated;

do $$
declare
  tabla_captura text;
begin
  foreach tabla_captura in array array[
    'bitacora', 'lecturas_pozos', 'lecturas_uf',
    'muestras_calidad', 'lecturas_ptar'
  ]
  loop
    execute format(
      'drop trigger if exists proteger_metadata_captura on public.%I', tabla_captura
    );
    execute format(
      'create trigger proteger_metadata_captura '
      'before insert or update on public.%I '
      'for each row execute function private.proteger_metadata_captura()', tabla_captura
    );
  end loop;
end;
$$;

-- Los resultados utilizan las fechas y el autor de su muestra.
-- Corregir el valor conserva los límites aplicados a la captura original.
create or replace function private.proteger_resultado_calidad()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  muestra public.muestras_calidad%rowtype;
  es_administrador boolean;
begin
  if row(
    new.id, new.muestra_id, new.punto_id, new.parametro_id,
    new.limite_min_aplicado, new.limite_max_aplicado
  ) is distinct from row(
    old.id, old.muestra_id, old.punto_id, old.parametro_id,
    old.limite_min_aplicado, old.limite_max_aplicado
  ) then
    raise exception using
      errcode = '42501',
      message = 'La identidad y los límites originales del resultado se conservan.';
  end if;

  es_administrador := current_user in ('postgres', 'service_role');
  if not es_administrador then
    es_administrador := private.es_admin();
  end if;

  if not es_administrador then
    select m.* into muestra
    from public.muestras_calidad m
    where m.id = old.muestra_id
    for share;

    if not found then
      raise exception using
        errcode = '42501',
        message = 'La muestra no está disponible para corregirla.';
    end if;

    if not coalesce(
      private.rol_actual() in (
        'calderas'::public.rol_usuario,
        'ptar'::public.rol_usuario
      ), false
    )
      or muestra.creado_por is distinct from auth.uid()
      or muestra.eliminado_en is not null
      or not private.en_plazo_correccion(muestra.capturado_en, muestra.recibido_en)
    then
      raise exception using
        errcode = '42501',
        message = 'Solo se pueden corregir resultados propios durante la primera hora desde la captura.';
    end if;
  end if;

  return new;
end;
$$;

alter function private.proteger_resultado_calidad() owner to postgres;
revoke all on function private.proteger_resultado_calidad()
  from public, anon, authenticated;

drop trigger if exists proteger_resultado_calidad on public.resultados_calidad;
create trigger proteger_resultado_calidad
  before update on public.resultados_calidad
  for each row execute function private.proteger_resultado_calidad();

-- Conserva los registros operativos: bloquea DELETE y TRUNCATE.
create or replace function private.impedir_borrado_operativo()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '42501',
    message = 'Los registros operativos no permiten borrados físicos.';
end;
$$;

alter function private.impedir_borrado_operativo() owner to postgres;
revoke all on function private.impedir_borrado_operativo()
  from public, anon, authenticated;

do $$
declare
  tabla_operativa text;
begin
  foreach tabla_operativa in array array[
    'turnos_operativos', 'bitacora', 'lecturas_pozos', 'lecturas_uf',
    'muestras_calidad', 'resultados_calidad', 'lecturas_ptar'
  ]
  loop
    execute format(
      'drop trigger if exists impedir_delete_operativo on public.%I', tabla_operativa
    );
    execute format(
      'create trigger impedir_delete_operativo before delete on public.%I '
      'for each row execute function private.impedir_borrado_operativo()', tabla_operativa
    );
    execute format(
      'drop trigger if exists impedir_truncate_operativo on public.%I', tabla_operativa
    );
    execute format(
      'create trigger impedir_truncate_operativo before truncate on public.%I '
      'for each statement execute function private.impedir_borrado_operativo()', tabla_operativa
    );
  end loop;
end;
$$;

commit;
