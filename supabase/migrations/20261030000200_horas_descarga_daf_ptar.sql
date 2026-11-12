-- Conserva las horas de operación de cada destino del DAF Chino.
-- Los reportes existentes mantienen NULL: no se infieren horas históricas.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table public.bitacora_ptar
  add column if not exists horas_descarga_tanque_11 numeric,
  add column if not exists horas_descarga_tanques_5_6 numeric;

do $constraints$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid='public.bitacora_ptar'::regclass and conname='bitacora_ptar_horas_tanque_11_validas') then
    alter table public.bitacora_ptar add constraint bitacora_ptar_horas_tanque_11_validas
      check (horas_descarga_tanque_11 is null or (private.bt_finito_v1(horas_descarga_tanque_11) and horas_descarga_tanque_11 >= 0));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid='public.bitacora_ptar'::regclass and conname='bitacora_ptar_horas_tanques_5_6_validas') then
    alter table public.bitacora_ptar add constraint bitacora_ptar_horas_tanques_5_6_validas
      check (horas_descarga_tanques_5_6 is null or (private.bt_finito_v1(horas_descarga_tanques_5_6) and horas_descarga_tanques_5_6 >= 0));
  end if;
end;
$constraints$;

-- Conserva los normalizadores y escritores previos como base para los campos v1.
alter function private.btr_normalizar_ptar(jsonb) rename to btr_normalizar_ptar_base;
alter function private.btr_escribir_ptar(text,uuid,uuid,jsonb,boolean) rename to btr_escribir_ptar_base;
alter function private.btr_guardar_ptar(text,uuid,uuid,jsonb) rename to btr_guardar_ptar_base;

create function private.btr_normalizar_ptar(p_datos jsonb) returns jsonb
language plpgsql immutable set search_path='' as $f$
declare base jsonb; h jsonb; h11 numeric; h56 numeric;
begin
  h:=private.bt_objeto_v1(p_datos->'horasDescarga',array['tanque11','tanques56']);
  h11:=private.bt_numero_v1(h->'tanque11');
  h56:=private.bt_numero_v1(h->'tanques56');
  if (h11 is not null and h11<0) or (h56 is not null and h56<0) then
    raise exception using errcode='22023',message='Las horas de descarga deben ser números iguales o mayores a cero; usa 0 si el destino no se utilizó.';
  end if;
  base:=private.btr_normalizar_ptar_base(p_datos-'horasDescarga');
  return base||jsonb_build_object('horasDescarga',jsonb_build_object('tanque11',h11,'tanques56',h56));
end;
$f$;

create function private.btr_escribir_ptar(p_modulo text,p_id uuid,p_turno uuid,p_datos jsonb,p_crear boolean) returns void
language plpgsql set search_path='' as $f$
declare anterior text;
begin
  anterior:=current_setting('copamex.horas_descarga_daf',true);
  if p_modulo='bitacora_ptar' then
    perform set_config('copamex.horas_descarga_daf',(p_datos->'horasDescarga')::text,true);
  end if;
  perform private.btr_escribir_ptar_base(p_modulo,p_id,p_turno,p_datos-'horasDescarga',p_crear);
  if p_modulo='bitacora_ptar' then
    perform set_config('copamex.horas_descarga_daf',coalesce(anterior,''),true);
  end if;
end;
$f$;

create function private.btr_asignar_horas_descarga_daf() returns trigger
language plpgsql set search_path='' as $f$
declare h jsonb;
begin
  h:=nullif(current_setting('copamex.horas_descarga_daf',true),'')::jsonb;
  if h is null then return new; end if;
  new.horas_descarga_tanque_11:=(h->>'tanque11')::numeric;
  new.horas_descarga_tanques_5_6:=(h->>'tanques56')::numeric;
  return new;
end;
$f$;
alter function private.btr_asignar_horas_descarga_daf() owner to postgres;
revoke all on function private.btr_asignar_horas_descarga_daf() from public,anon,authenticated,service_role;
create trigger zzz_btr_asignar_horas_descarga_daf
  before insert or update on public.bitacora_ptar
  for each row execute function private.btr_asignar_horas_descarga_daf();

-- La RPC exige ambas horas al crear; los campos NULL se conservan para datos anteriores.
create function private.btr_guardar_ptar(p_modulo text,p_id uuid,p_turno_id uuid,p_datos jsonb) returns jsonb
language plpgsql set search_path='' as $f$
declare d jsonb;
begin
  d:=private.btr_normalizar_ptar(p_datos);
  if d->'horasDescarga'->>'tanque11' is null or d->'horasDescarga'->>'tanques56' is null then
    raise exception using errcode='22023',message='Registra las horas de tanque 11 y de tanques 5 y 6; escribe 0 si no se utilizaron.';
  end if;
  return private.btr_guardar_ptar_base(p_modulo,p_id,p_turno_id,p_datos);
end;
$f$;

alter function private.btr_normalizar_ptar(jsonb) owner to postgres;
alter function private.btr_escribir_ptar(text,uuid,uuid,jsonb,boolean) owner to postgres;
alter function private.btr_guardar_ptar(text,uuid,uuid,jsonb) owner to postgres;
revoke all on function private.btr_normalizar_ptar(jsonb) from public,anon,authenticated,service_role;
revoke all on function private.btr_escribir_ptar(text,uuid,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
revoke all on function private.btr_guardar_ptar(text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;

notify pgrst, 'reload schema';
commit;
