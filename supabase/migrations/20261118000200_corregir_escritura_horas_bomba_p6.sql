-- LOCAL: correccion para instalaciones que ya aplicaron 20261118000100.
-- El escritor enviaba el numero de P6 como JSON escalar, pero el trigger lo lee como objeto.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $pre$
begin
  if not exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'public.bitacora_ptar'::regclass
      and attname = 'horas_bomba_p6' and not attisdropped
  ) then
    raise exception 'Falta la columna horas_bomba_p6; aplicar primero 20261118000100.';
  end if;
  if to_regprocedure('private.btr_escribir_ptar_sin_horas_bomba_p6(text,uuid,uuid,jsonb,boolean)') is null
    or to_regprocedure('private.btr_asignar_horas_bomba_p6()') is null then
    raise exception 'Faltan las funciones de la migracion 20261118000100.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.bitacora_ptar'::regclass
      and tgname = 'zzz_btr_asignar_horas_bomba_p6' and not tgisinternal
  ) then
    raise exception 'Falta el trigger de horas de bomba P6.';
  end if;
end;
$pre$;

create or replace function private.btr_escribir_ptar(
  p_modulo text, p_id uuid, p_turno uuid, p_datos jsonb, p_crear boolean
) returns void
language plpgsql
set search_path = ''
as $function$
declare
  contexto_anterior text;
begin
  contexto_anterior := current_setting('copamex.horas_bomba_p6', true);
  if p_modulo = 'bitacora_ptar' then
    -- El trigger espera un objeto JSON con la clave horasBombaP6.
    perform set_config(
      'copamex.horas_bomba_p6',
      pg_catalog.jsonb_build_object('horasBombaP6', p_datos->'horasBombaP6')::text,
      true
    );
  end if;

  perform private.btr_escribir_ptar_sin_horas_bomba_p6(
    p_modulo, p_id, p_turno, p_datos-'horasBombaP6', p_crear
  );

  if p_modulo = 'bitacora_ptar' then
    perform set_config('copamex.horas_bomba_p6', coalesce(contexto_anterior, ''), true);
  end if;
end;
$function$;

alter function private.btr_escribir_ptar(text,uuid,uuid,jsonb,boolean) owner to postgres;
revoke all on function private.btr_escribir_ptar(text,uuid,uuid,jsonb,boolean)
  from public, anon, authenticated, service_role;
notify pgrst, 'reload schema';
commit;
