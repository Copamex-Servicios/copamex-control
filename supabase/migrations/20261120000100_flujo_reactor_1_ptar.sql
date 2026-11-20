-- LOCAL: agrega Flujo al Reactor 1 (L/s) a reportes técnicos PTAR.
-- Los reportes históricos conservan NULL; no se reinterpretan ni se reescriben.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
begin
  if to_regclass('public.bitacora_ptar') is null
    or to_regprocedure('private.bt_numero_v1(jsonb)') is null
    or to_regprocedure('private.bt_finito_v1(numeric)') is null
    or to_regprocedure('private.btr_normalizar_ptar(jsonb)') is null
    or to_regprocedure('private.btr_escribir_ptar(text,uuid,uuid,jsonb,boolean)') is null then
    raise exception 'Faltan dependencias de la bitácora PTAR; revisar antes de aplicar.';
  end if;
  if exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'public.bitacora_ptar'::regclass
      and attname = 'flujo_reactor_1' and not attisdropped
  ) then
    raise exception 'La columna flujo_reactor_1 ya existe; revisar antes de volver a aplicar.';
  end if;
  if to_regprocedure('private.btr_normalizar_ptar_sin_flujo_reactor_1(jsonb)') is not null
    or to_regprocedure('private.btr_escribir_ptar_sin_flujo_reactor_1(text,uuid,uuid,jsonb,boolean)') is not null
    or exists (
      select 1 from pg_catalog.pg_trigger
      where tgrelid = 'public.bitacora_ptar'::regclass
        and tgname = 'aaa_btr_asignar_flujo_reactor_1' and not tgisinternal
    ) then
    raise exception 'La mejora de Flujo al Reactor 1 ya existe; revisar antes de volver a aplicar.';
  end if;
end;
$pre$;

alter table public.bitacora_ptar
  add column flujo_reactor_1 numeric
    constraint bitacora_ptar_flujo_reactor_1_finito
    check (flujo_reactor_1 is null or private.bt_finito_v1(flujo_reactor_1));
comment on column public.bitacora_ptar.flujo_reactor_1 is
  'L/s. NULL se conserva en reportes creados antes de agregar este campo.';

-- Envolver el normalizador vigente y delegar todos los campos ya existentes.
-- El normalizador anterior no conoce flujo_reactor_1, por eso se reincorpora
-- después de validarlo como número.
alter function private.btr_normalizar_ptar(jsonb)
  rename to btr_normalizar_ptar_sin_flujo_reactor_1;

create function private.btr_normalizar_ptar(p_datos jsonb)
returns jsonb
language plpgsql immutable set search_path = '' as $function$
declare
  datos_base jsonb;
  mediciones jsonb;
  normalizado jsonb;
  flujo_reactor_1 numeric;
begin
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    return private.btr_normalizar_ptar_sin_flujo_reactor_1(p_datos);
  end if;

  datos_base := p_datos;
  if jsonb_typeof(p_datos->'mediciones') = 'object' then
    mediciones := p_datos->'mediciones';
    flujo_reactor_1 := private.bt_numero_v1(mediciones->'flujo_reactor_1');
    datos_base := jsonb_set(
      p_datos,
      '{mediciones}',
      mediciones - 'flujo_reactor_1',
      true
    );
  end if;

  normalizado := private.btr_normalizar_ptar_sin_flujo_reactor_1(datos_base);
  return jsonb_set(
    normalizado,
    '{mediciones}',
    (normalizado->'mediciones') || jsonb_build_object(
      'flujo_reactor_1', coalesce(pg_catalog.to_jsonb(flujo_reactor_1), 'null'::jsonb)
    ),
    true
  );
end;
$function$;

-- Envolver el escritor PTAR vigente. El escritor anterior conserva sus
-- contextos y triggers de horas de descarga, prensas, operadores y bomba P6.
alter function private.btr_escribir_ptar(text,uuid,uuid,jsonb,boolean)
  rename to btr_escribir_ptar_sin_flujo_reactor_1;

create function private.btr_escribir_ptar(
  p_modulo text, p_id uuid, p_turno uuid, p_datos jsonb, p_crear boolean
) returns void
language plpgsql set search_path = '' as $function$
declare
  contexto_anterior text;
  mediciones jsonb;
  datos_base jsonb;
begin
  if p_modulo is distinct from 'bitacora_ptar' then
    perform private.btr_escribir_ptar_sin_flujo_reactor_1(
      p_modulo, p_id, p_turno, p_datos, p_crear
    );
    return;
  end if;

  mediciones := p_datos->'mediciones';
  if jsonb_typeof(mediciones) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Las mediciones del reporte PTAR no son válidas.';
  end if;

  contexto_anterior := current_setting('copamex.flujo_reactor_1', true);
  perform set_config(
    'copamex.flujo_reactor_1',
    jsonb_build_object('flujo_reactor_1', mediciones->'flujo_reactor_1')::text,
    true
  );
  datos_base := jsonb_set(p_datos, '{mediciones}', mediciones - 'flujo_reactor_1', true);

  begin
    perform private.btr_escribir_ptar_sin_flujo_reactor_1(
      p_modulo, p_id, p_turno, datos_base, p_crear
    );
  exception when others then
    perform set_config('copamex.flujo_reactor_1', coalesce(contexto_anterior, ''), true);
    raise;
  end;

  perform set_config('copamex.flujo_reactor_1', coalesce(contexto_anterior, ''), true);
end;
$function$;

-- El trigger asigna el valor en la misma escritura del reporte.
-- En altas antiguas sin el contexto controlado no permite crear un registro sin el campo;
-- en correcciones sin ese contexto conserva el valor histórico existente.
create function private.btr_asignar_flujo_reactor_1()
returns trigger
language plpgsql set search_path = '' as $function$
declare
  contexto jsonb;
  flujo numeric;
begin
  contexto := nullif(current_setting('copamex.flujo_reactor_1', true), '')::jsonb;
  if contexto is not null and contexto ? 'flujo_reactor_1' then
    flujo := private.bt_numero_v1(contexto->'flujo_reactor_1');
    if flujo is null and (tg_op = 'INSERT' or old.flujo_reactor_1 is not null) then
      raise exception using errcode = '22023', message = 'Registra el flujo al Reactor 1 en L/s.';
    end if;
    new.flujo_reactor_1 := flujo;
  elsif tg_op = 'UPDATE' then
    new.flujo_reactor_1 := old.flujo_reactor_1;
  else
    raise exception using errcode = '22023', message = 'Registra el flujo al Reactor 1 en L/s.';
  end if;
  return new;
end;
$function$;

alter function private.btr_normalizar_ptar(jsonb) owner to postgres;
alter function private.btr_escribir_ptar(text,uuid,uuid,jsonb,boolean) owner to postgres;
alter function private.btr_asignar_flujo_reactor_1() owner to postgres;
revoke all on function private.btr_normalizar_ptar(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.btr_escribir_ptar(text,uuid,uuid,jsonb,boolean) from public, anon, authenticated, service_role;
revoke all on function private.btr_asignar_flujo_reactor_1() from public, anon, authenticated, service_role;

-- 'aaa' hace que el valor se asigne antes de las validaciones y demás triggers.
create trigger aaa_btr_asignar_flujo_reactor_1
  before insert or update on public.bitacora_ptar
  for each row execute function private.btr_asignar_flujo_reactor_1();

notify pgrst, 'reload schema';
commit;
