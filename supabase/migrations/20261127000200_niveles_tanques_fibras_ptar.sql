-- Niveles de los tanques de fibras en la bitácora técnica de PTAR.
begin;
set local lock_timeout = '5s';

alter table public.bitacora_ptar
  add column nivel_tanque_5 numeric check (nivel_tanque_5 between 0 and 100),
  add column nivel_tanque_6 numeric check (nivel_tanque_6 between 0 and 100);

-- Conserva las reglas actuales y añade únicamente los niveles incluidos en el envío.
alter function private.btr_normalizar_ptar(jsonb) rename to btr_normalizar_ptar_sin_niveles_fibras;

create function private.btr_normalizar_ptar(p_datos jsonb)
returns jsonb
language plpgsql immutable set search_path = '' as $function$
declare
  mediciones jsonb := p_datos->'mediciones';
  niveles jsonb := '{}'::jsonb;
  normalizado jsonb;
  campo text;
  nivel numeric;
begin
  if jsonb_typeof(mediciones) is distinct from 'object' then
    return private.btr_normalizar_ptar_sin_niveles_fibras(p_datos);
  end if;

  foreach campo in array array['nivel_tanque_5', 'nivel_tanque_6'] loop
    if mediciones ? campo then
      nivel := private.bt_numero_v1(mediciones->campo);
      if nivel is null or nivel not between 0 and 100 then
        raise exception using errcode = '22023',
          message = 'Registra un nivel entre 0 y 100 % para los tanques de fibras.';
      end if;
      niveles := niveles || jsonb_build_object(campo, nivel);
    end if;
  end loop;

  normalizado := private.btr_normalizar_ptar_sin_niveles_fibras(
    jsonb_set(p_datos, '{mediciones}', mediciones - array['nivel_tanque_5', 'nivel_tanque_6'])
  );
  return jsonb_set(normalizado, '{mediciones}', (normalizado->'mediciones') || niveles);
end;
$function$;

alter function private.btr_escribir_ptar(text, uuid, uuid, jsonb, boolean)
  rename to btr_escribir_ptar_sin_niveles_fibras;

create function private.btr_escribir_ptar(
  p_modulo text, p_id uuid, p_turno uuid, p_datos jsonb, p_crear boolean
) returns void
language plpgsql set search_path = '' as $function$
declare
  mediciones jsonb := p_datos->'mediciones';
  niveles jsonb := '{}'::jsonb;
  campo text;
  contexto_anterior text := current_setting('copamex.niveles_fibras_ptar', true);
begin
  if p_modulo is distinct from 'bitacora_ptar' or jsonb_typeof(mediciones) is distinct from 'object' then
    perform private.btr_escribir_ptar_sin_niveles_fibras(p_modulo, p_id, p_turno, p_datos, p_crear);
    return;
  end if;

  foreach campo in array array['nivel_tanque_5', 'nivel_tanque_6'] loop
    if mediciones ? campo then
      niveles := niveles || jsonb_build_object(campo, mediciones->campo);
    end if;
  end loop;

  perform set_config('copamex.niveles_fibras_ptar', niveles::text, true);
  perform private.btr_escribir_ptar_sin_niveles_fibras(
    p_modulo, p_id, p_turno,
    jsonb_set(p_datos, '{mediciones}', mediciones - array['nivel_tanque_5', 'nivel_tanque_6']),
    p_crear
  );
  perform set_config('copamex.niveles_fibras_ptar', coalesce(contexto_anterior, ''), true);
end;
$function$;

-- Guarda los niveles en la escritura original y conserva los ya registrados si un cliente anterior los omite.
create function private.btr_asignar_niveles_fibras_ptar()
returns trigger
language plpgsql set search_path = '' as $function$
declare
  niveles jsonb := nullif(current_setting('copamex.niveles_fibras_ptar', true), '')::jsonb;
begin
  if niveles ? 'nivel_tanque_5' then
    new.nivel_tanque_5 := (niveles->>'nivel_tanque_5')::numeric;
  elsif tg_op = 'UPDATE' then
    new.nivel_tanque_5 := old.nivel_tanque_5;
  end if;

  if niveles ? 'nivel_tanque_6' then
    new.nivel_tanque_6 := (niveles->>'nivel_tanque_6')::numeric;
  elsif tg_op = 'UPDATE' then
    new.nivel_tanque_6 := old.nivel_tanque_6;
  end if;

  return new;
end;
$function$;

alter function private.btr_normalizar_ptar(jsonb) owner to postgres;
alter function private.btr_escribir_ptar(text, uuid, uuid, jsonb, boolean) owner to postgres;
alter function private.btr_asignar_niveles_fibras_ptar() owner to postgres;
revoke all on function private.btr_normalizar_ptar(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.btr_escribir_ptar(text, uuid, uuid, jsonb, boolean) from public, anon, authenticated, service_role;
revoke all on function private.btr_asignar_niveles_fibras_ptar() from public, anon, authenticated, service_role;

create trigger aaa_btr_asignar_niveles_fibras_ptar
  before insert or update on public.bitacora_ptar
  for each row execute function private.btr_asignar_niveles_fibras_ptar();

notify pgrst, 'reload schema';
commit;
