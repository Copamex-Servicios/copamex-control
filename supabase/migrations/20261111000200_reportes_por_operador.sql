-- LOCAL: pendiente de revisión y aplicación autorizada en Supabase.
-- Dos comentarios individuales; históricos sin atribución conservan el texto original.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
do $pre$
begin
 if to_regprocedure('private.btr_normalizar_calderas(jsonb)') is null
  or to_regprocedure('private.btr_normalizar_ptar(jsonb)') is null
  or to_regprocedure('private.btr_escribir_calderas(uuid,uuid,jsonb,boolean)') is null
  or to_regprocedure('private.btr_escribir_ptar(text,uuid,uuid,jsonb,boolean)') is null
  or not exists(select 1 from pg_catalog.pg_attribute where attrelid='public.bitacora_calderas'::regclass and attname='comentarios_compresores' and not attisdropped) then
  raise exception 'Aplicar primero las migraciones previas, incluyendo 20261111000100_compresores_sulzer_calderas.';
 end if;
 if to_regprocedure('private.btr_normalizar_calderas_sin_individuales(jsonb)') is not null then
  raise exception 'La mejora de reportes por operador ya está instalada.';
 end if;
end;
$pre$;
alter table public.bitacora_calderas add column reportes_operadores jsonb
 check (reportes_operadores is null or case when jsonb_typeof(reportes_operadores)='array' then jsonb_array_length(reportes_operadores)=2 else false end);
alter table public.bitacora_ptar add column reportes_operadores jsonb
 check (reportes_operadores is null or case when jsonb_typeof(reportes_operadores)='array' then jsonb_array_length(reportes_operadores)=2 else false end);

create function private.btr_preparar_individuales(d jsonb) returns jsonb
language plpgsql immutable set search_path='' as $f$
declare r jsonb; a text; b text; resumen text;
begin
 -- Ausencia de la clave: compatibilidad con reportes y reintentos previos.
 if not d ? 'reportesOperadores' then return d; end if;
 r:=private.bt_objeto_v1(d->'reportesOperadores',array['principal','acompanante']);
 a:=upper(private.bt_texto_v1(r->'principal')); b:=upper(private.bt_texto_v1(r->'acompanante'));
 if a is null or b is null then
  raise exception using errcode='22023',message='Escribe el reporte relevante de cada uno de los dos operadores.';
 end if;
 resumen:='OPERADOR 1:'||chr(10)||a||chr(10)||chr(10)||'OPERADOR 2:'||chr(10)||b;
 if length(resumen)>4000 then raise exception using errcode='22023',message='Los dos reportes relevantes juntos admiten hasta 4000 caracteres.'; end if;
 return d||jsonb_build_object('reportesOperadores',jsonb_build_object('principal',a,'acompanante',b),'reporteRelevante',resumen);
end;
$f$;

alter function private.btr_normalizar_calderas(jsonb) rename to btr_normalizar_calderas_sin_individuales;
alter function private.btr_normalizar_ptar(jsonb) rename to btr_normalizar_ptar_sin_individuales;
create function private.btr_normalizar_calderas(p_datos jsonb) returns jsonb
language plpgsql immutable set search_path='' as $f$
declare d jsonb:=private.btr_preparar_individuales(p_datos); salida jsonb;
begin
 salida:=private.btr_normalizar_calderas_sin_individuales(d-'reportesOperadores');
 if d ? 'reportesOperadores' then salida:=salida||jsonb_build_object('reportesOperadores',d->'reportesOperadores'); end if;
 return salida;
end;
$f$;
create function private.btr_normalizar_ptar(p_datos jsonb) returns jsonb
language plpgsql immutable set search_path='' as $f$
declare d jsonb:=private.btr_preparar_individuales(p_datos); salida jsonb;
begin
 salida:=private.btr_normalizar_ptar_sin_individuales(d-'reportesOperadores');
 if d ? 'reportesOperadores' then salida:=salida||jsonb_build_object('reportesOperadores',d->'reportesOperadores'); end if;
 return salida;
end;
$f$;

alter function private.btr_escribir_calderas(uuid,uuid,jsonb,boolean) rename to btr_escribir_calderas_sin_individuales;
alter function private.btr_escribir_ptar(text,uuid,uuid,jsonb,boolean) rename to btr_escribir_ptar_sin_individuales;
create function private.btr_escribir_calderas(p_id uuid,p_turno uuid,p_datos jsonb,p_crear boolean) returns void
language plpgsql set search_path='' as $f$
declare anterior text:=current_setting('copamex.reportes_individuales',true);
begin
 perform set_config('copamex.reportes_individuales',case when p_datos ? 'reportesOperadores' then
  jsonb_build_object('reporte_id',p_id,'modulo','bitacora_calderas','reportes',p_datos->'reportesOperadores')::text else '' end,true);
 perform private.btr_escribir_calderas_sin_individuales(p_id,p_turno,p_datos-'reportesOperadores',p_crear);
 perform set_config('copamex.reportes_individuales',coalesce(anterior,''),true);
end;
$f$;
create function private.btr_escribir_ptar(p_modulo text,p_id uuid,p_turno uuid,p_datos jsonb,p_crear boolean) returns void
language plpgsql set search_path='' as $f$
declare anterior text:=current_setting('copamex.reportes_individuales',true);
begin
 perform set_config('copamex.reportes_individuales',case when p_modulo='bitacora_ptar' and p_datos ? 'reportesOperadores' then
  jsonb_build_object('reporte_id',p_id,'modulo',p_modulo,'reportes',p_datos->'reportesOperadores')::text else '' end,true);
 perform private.btr_escribir_ptar_sin_individuales(p_modulo,p_id,p_turno,p_datos-'reportesOperadores',p_crear);
 perform set_config('copamex.reportes_individuales',coalesce(anterior,''),true);
end;
$f$;

create function private.btr_asignar_individuales() returns trigger
language plpgsql security invoker set search_path='' as $f$
declare contexto jsonb; t record; r jsonb;
begin
 contexto:=nullif(current_setting('copamex.reportes_individuales',true),'')::jsonb;
 if contexto is null then
  if tg_op='UPDATE' and old.reportes_operadores is not null and new.reporte_relevante is distinct from old.reporte_relevante then
   raise exception using errcode='22023',message='Para corregir este reporte conserva los dos comentarios individuales.';
  end if;
  return new;
 end if;
 if current_user<>'postgres' or auth.uid() is null
  or contexto->>'modulo' is distinct from tg_table_name or contexto->>'reporte_id' is distinct from new.id::text
  or current_setting('copamex.bt_escritura',true) is distinct from tg_table_name||':'||new.id::text then
  raise exception using errcode='42501',message='Los reportes individuales requieren la escritura técnica controlada.';
 end if;
 select o.id principal_id,o.nombre principal,oa.id acompanante_id,oa.nombre acompanante into t
 from public.turnos_operativos turno join public.operadores o on o.id=turno.operador_id
 left join public.operadores oa on oa.id=turno.operador_acompanante_id where turno.id=new.turno_id;
 if not found or t.acompanante_id is null or t.principal_id=t.acompanante_id then
  raise exception using errcode='22023',message='El reporte individual requiere dos operadores distintos en el turno.';
 end if;
 -- IDs y nombres provienen del turno, nunca de los nombres enviados por el navegador.
 r:=contexto->'reportes';
 new.reportes_operadores:=jsonb_build_array(
  jsonb_build_object('operador_id',t.principal_id,'nombre',t.principal,'comentario',r->>'principal'),
  jsonb_build_object('operador_id',t.acompanante_id,'nombre',t.acompanante,'comentario',r->>'acompanante'));
 return new;
end;
$f$;
create trigger zzz_btr_asignar_individuales before insert or update on public.bitacora_calderas
 for each row execute function private.btr_asignar_individuales();
create trigger zzz_btr_asignar_individuales before insert or update on public.bitacora_ptar
 for each row execute function private.btr_asignar_individuales();

do $acl$
declare firma text;
begin
 foreach firma in array array[
 'private.btr_preparar_individuales(jsonb)','private.btr_normalizar_calderas(jsonb)','private.btr_normalizar_ptar(jsonb)',
 'private.btr_escribir_calderas(uuid,uuid,jsonb,boolean)','private.btr_escribir_ptar(text,uuid,uuid,jsonb,boolean)',
 'private.btr_asignar_individuales()'] loop
  execute 'alter function '||firma||' owner to postgres';
  execute 'revoke all on function '||firma||' from public,anon,authenticated,service_role';
 end loop;
end;
$acl$;
notify pgrst,'reload schema';
commit;
