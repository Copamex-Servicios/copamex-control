-- LOCAL: preparar y revisar; no aplicada a Supabase por el agente.
-- Velocidades opcionales en m/min; históricos NULL y cero explícito conservados.
-- Requiere 20261030000200_horas_descarga_daf_ptar.sql. No cambia roles ni RLS.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

do $pre$
begin
  if to_regprocedure('private.btr_normalizar_ptar_base(jsonb)') is null
    or to_regprocedure('private.btr_escribir_ptar_base(text,uuid,uuid,jsonb,boolean)') is null then
    raise exception 'Falta la migración de horas de descarga del DAF.';
  end if;
end;
$pre$;

alter table public.bitacora_ptar
  add column velocidad_prensa_essity numeric
    constraint bp_velocidad_essity_valida check (velocidad_prensa_essity is null or (private.bt_finito_v1(velocidad_prensa_essity) and velocidad_prensa_essity >= 0)),
  add column velocidad_prensa_nalco numeric
    constraint bp_velocidad_nalco_valida check (velocidad_prensa_nalco is null or (private.bt_finito_v1(velocidad_prensa_nalco) and velocidad_prensa_nalco >= 0));
comment on column public.bitacora_ptar.velocidad_prensa_essity is 'm/min. NULL: no capturado. Cero: velocidad registrada explícitamente.';
comment on column public.bitacora_ptar.velocidad_prensa_nalco is 'm/min. NULL: no capturado. Cero: velocidad registrada explícitamente.';

create or replace function private.btr_normalizar_ptar(p_datos jsonb) returns jsonb
language plpgsql immutable set search_path='' as $f$
declare base jsonb; h jsonb; h11 numeric; h56 numeric; v jsonb; ve numeric; vn numeric;
begin
  h:=private.bt_objeto_v1(p_datos->'horasDescarga',array['tanque11','tanques56']);
  h11:=private.bt_numero_v1(h->'tanque11');
  h56:=private.bt_numero_v1(h->'tanques56');
  if (h11 is not null and h11<0) or (h56 is not null and h56<0) then
    raise exception using errcode='22023',message='Las horas de descarga deben ser números iguales o mayores a cero; usa 0 si el destino no se utilizó.';
  end if;
  base:=private.btr_normalizar_ptar_base(p_datos-'horasDescarga'-'velocidadesPrensas');
  base:=base||jsonb_build_object('horasDescarga',jsonb_build_object('tanque11',h11,'tanques56',h56));
  -- La clave ausente sigue ausente: no cambia los comprobantes de reintentos anteriores.
  if p_datos ? 'velocidadesPrensas' then
    v:=private.bt_objeto_v1(p_datos->'velocidadesPrensas',array['Essity','Nalco']);
    ve:=private.bt_numero_v1(v->'Essity');
    vn:=private.bt_numero_v1(v->'Nalco');
    if (ve is not null and ve<0) or (vn is not null and vn<0) then
      raise exception using errcode='22023',message='Las velocidades de las prensas deben ser iguales o mayores a cero.';
    end if;
    base:=base||jsonb_build_object('velocidadesPrensas',jsonb_build_object('Essity',ve,'Nalco',vn));
  end if;
  return base;
end;
$f$;

create or replace function private.btr_escribir_ptar(p_modulo text,p_id uuid,p_turno uuid,p_datos jsonb,p_crear boolean) returns void
language plpgsql set search_path='' as $f$
declare anterior text; velocidades_anteriores text;
begin
  anterior:=current_setting('copamex.horas_descarga_daf',true);
  velocidades_anteriores:=current_setting('copamex.velocidades_prensas',true);
  if p_modulo='bitacora_ptar' then
    perform set_config('copamex.horas_descarga_daf',(p_datos->'horasDescarga')::text,true);
    perform set_config('copamex.velocidades_prensas',coalesce((p_datos->'velocidadesPrensas')::text,''),true);
  end if;
  -- El trigger agrega las velocidades en la misma escritura; auditoría y revisión existentes.
  perform private.btr_escribir_ptar_base(p_modulo,p_id,p_turno,p_datos-'horasDescarga'-'velocidadesPrensas',p_crear);
  if p_modulo='bitacora_ptar' then
    perform set_config('copamex.horas_descarga_daf',coalesce(anterior,''),true);
    perform set_config('copamex.velocidades_prensas',coalesce(velocidades_anteriores,''),true);
  end if;
end;
$f$;

create function private.btr_asignar_velocidades_prensas() returns trigger
language plpgsql security invoker set search_path='' as $f$
declare v jsonb;
begin
  v:=nullif(current_setting('copamex.velocidades_prensas',true),'')::jsonb;
  -- Clientes anteriores sin el campo no borran velocidades guardadas.
  if v is null then return new; end if;
  new.velocidad_prensa_essity:=(v->>'Essity')::numeric;
  new.velocidad_prensa_nalco:=(v->>'Nalco')::numeric;
  return new;
end;
$f$;
alter function private.btr_asignar_velocidades_prensas() owner to postgres;
revoke all on function private.btr_asignar_velocidades_prensas() from public,anon,authenticated,service_role;
create trigger zzz_btr_asignar_velocidades_prensas
  before insert or update on public.bitacora_ptar
  for each row execute function private.btr_asignar_velocidades_prensas();
-- CREATE OR REPLACE conserva los propietarios y ACL de normalizador/escritor existentes.
notify pgrst,'reload schema';
commit;
