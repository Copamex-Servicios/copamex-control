-- LOCAL: revisar y aplicar con autorizacion en Supabase; no ejecutar remotamente desde este cambio.
-- Captura las horas de operacion de la bomba P6 en reportes tecnicos PTAR.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
begin
  if to_regprocedure('private.btr_normalizar_ptar(jsonb)') is null
    or to_regprocedure('private.btr_escribir_ptar(text,uuid,uuid,jsonb,boolean)') is null
    or to_regprocedure('private.bt_numero_v1(jsonb)') is null
    or to_regprocedure('private.bt_finito_v1(numeric)') is null then
    raise exception 'Falta una dependencia de reportes tecnicos PTAR.';
  end if;
  if to_regprocedure('private.btr_normalizar_ptar_sin_horas_bomba_p6(jsonb)') is not null
    or to_regprocedure('private.btr_escribir_ptar_sin_horas_bomba_p6(text,uuid,uuid,jsonb,boolean)') is not null
    or exists (select 1 from pg_catalog.pg_attribute
      where attrelid = 'public.bitacora_ptar'::regclass and attname = 'horas_bomba_p6' and not attisdropped) then
    raise exception 'La captura de horas de la bomba P6 ya existe; revisar antes de volver a aplicar.';
  end if;
end;
$pre$;

-- NULL mantiene legibles los reportes historicos, para los que no se infiere este dato.
alter table public.bitacora_ptar add column horas_bomba_p6 numeric
  constraint bitacora_ptar_horas_bomba_p6_validas
  check (horas_bomba_p6 is null or (private.bt_finito_v1(horas_bomba_p6) and horas_bomba_p6 >= 0));
comment on column public.bitacora_ptar.horas_bomba_p6 is
  'Horas de operacion de la bomba P6. NULL: reporte historico anterior al campo.';

-- Extiende la normalizacion actual sin perder validaciones ni campos ya soportados.
alter function private.btr_normalizar_ptar(jsonb) rename to btr_normalizar_ptar_sin_horas_bomba_p6;
create function private.btr_normalizar_ptar(p_datos jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $function$
declare
  base jsonb;
  horas_p6 numeric;
begin
  horas_p6 := private.bt_numero_v1(p_datos->'horasBombaP6');
  if horas_p6 is null or horas_p6 < 0 then
    raise exception using errcode = '22023', message = 'Registra las horas de operacion de la bomba P6; usa 0 si no se utilizo.';
  end if;
  base := private.btr_normalizar_ptar_sin_horas_bomba_p6(p_datos-'horasBombaP6');
  return base || jsonb_build_object('horasBombaP6', horas_p6);
end;
$function$;

-- El contexto temporal permite conservar el flujo existente de INSERT y UPDATE.
alter function private.btr_escribir_ptar(text,uuid,uuid,jsonb,boolean) rename to btr_escribir_ptar_sin_horas_bomba_p6;
create function private.btr_escribir_ptar(p_modulo text,p_id uuid,p_turno uuid,p_datos jsonb,p_crear boolean) returns void
language plpgsql set search_path = '' as $function$
declare
  contexto_anterior text;
begin
  contexto_anterior := current_setting('copamex.horas_bomba_p6', true);
  if p_modulo = 'bitacora_ptar' then
    perform set_config('copamex.horas_bomba_p6', (p_datos->'horasBombaP6')::text, true);
  end if;
  perform private.btr_escribir_ptar_sin_horas_bomba_p6(
    p_modulo, p_id, p_turno, p_datos-'horasBombaP6', p_crear
  );
  if p_modulo = 'bitacora_ptar' then
    perform set_config('copamex.horas_bomba_p6', coalesce(contexto_anterior, ''), true);
  end if;
end;
$function$;

create function private.btr_asignar_horas_bomba_p6() returns trigger
language plpgsql security invoker set search_path = '' as $function$
declare contexto jsonb;
begin
  contexto := nullif(current_setting('copamex.horas_bomba_p6', true), '')::jsonb;
  if contexto is null or not (contexto ? 'horasBombaP6') then return new; end if;
  new.horas_bomba_p6 := (contexto->>'horasBombaP6')::numeric;
  return new;
end;
$function$;

alter function private.btr_normalizar_ptar(jsonb) owner to postgres;
alter function private.btr_escribir_ptar(text,uuid,uuid,jsonb,boolean) owner to postgres;
alter function private.btr_asignar_horas_bomba_p6() owner to postgres;
revoke all on function private.btr_normalizar_ptar(jsonb) from public,anon,authenticated,service_role;
revoke all on function private.btr_escribir_ptar(text,uuid,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
revoke all on function private.btr_asignar_horas_bomba_p6() from public,anon,authenticated,service_role;

create trigger zzz_btr_asignar_horas_bomba_p6 before insert or update on public.bitacora_ptar
  for each row execute function private.btr_asignar_horas_bomba_p6();

notify pgrst, 'reload schema';
commit;
