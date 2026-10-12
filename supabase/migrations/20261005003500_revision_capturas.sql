-- Revisión administrativa de capturas. Ejecutar COMPLETO como postgres.
-- Requiere migraciones anteriores, incluida 034. No modifica capturas existentes.
begin;
create table if not exists public.revisiones_captura (
 id uuid primary key, modulo text not null check(modulo in ('bitacora','pozos','uf','calidad','ptar')),
 registro_id uuid not null, accion text not null check(accion in ('corregir','anular')),
 motivo text not null check(length(trim(motivo)) between 1 and 4000),
 creado_por uuid not null references auth.users(id), responsable_nombre text not null,
 creado_en timestamptz not null default clock_timestamp(),
 antes jsonb not null, despues jsonb not null, datos_solicitados jsonb not null
);
create index if not exists revisiones_captura_origen on public.revisiones_captura(modulo,registro_id,creado_en);
alter table public.revisiones_captura enable row level security;
revoke all on public.revisiones_captura from public,anon,authenticated;
grant select on public.revisiones_captura to authenticated;
drop policy if exists lectura_revision_admin on public.revisiones_captura;
create policy lectura_revision_admin on public.revisiones_captura for select to authenticated using((select private.es_admin()));
drop trigger if exists conservar_revision on public.revisiones_captura;
create trigger conservar_revision before update or delete on public.revisiones_captura for each row execute function private.impedir_borrado_operativo();
drop trigger if exists conservar_revision_truncate on public.revisiones_captura;
create trigger conservar_revision_truncate before truncate on public.revisiones_captura for each statement execute function private.impedir_borrado_operativo();
drop trigger if exists auditar_revision on public.revisiones_captura;
create trigger auditar_revision after insert on public.revisiones_captura for each row execute function private.registrar_auditoria();
create or replace function private.incrementar_revision_captura() returns trigger language plpgsql set search_path='' as $revision$
begin new.revision_admin:=old.revision_admin+1; return new; end;
$revision$;
alter function private.incrementar_revision_captura() owner to postgres;
revoke all on function private.incrementar_revision_captura() from public,anon,authenticated;
alter table public.bitacora add column if not exists revision_admin bigint not null default 0;
drop trigger if exists incrementar_revision_captura on public.bitacora;
create trigger incrementar_revision_captura before update on public.bitacora for each row execute function private.incrementar_revision_captura();
drop policy if exists admin_revision_por_rpc on public.bitacora;
create policy admin_revision_por_rpc on public.bitacora as restrictive for update to authenticated
 using ((select private.rol_actual()) is distinct from 'admin'::public.rol_usuario)
 with check ((select private.rol_actual()) is distinct from 'admin'::public.rol_usuario);
alter table public.lecturas_pozos add column if not exists revision_admin bigint not null default 0;
drop trigger if exists incrementar_revision_captura on public.lecturas_pozos;
create trigger incrementar_revision_captura before update on public.lecturas_pozos for each row execute function private.incrementar_revision_captura();
drop policy if exists admin_revision_por_rpc on public.lecturas_pozos;
create policy admin_revision_por_rpc on public.lecturas_pozos as restrictive for update to authenticated
 using ((select private.rol_actual()) is distinct from 'admin'::public.rol_usuario)
 with check ((select private.rol_actual()) is distinct from 'admin'::public.rol_usuario);
alter table public.lecturas_uf add column if not exists revision_admin bigint not null default 0;
drop trigger if exists incrementar_revision_captura on public.lecturas_uf;
create trigger incrementar_revision_captura before update on public.lecturas_uf for each row execute function private.incrementar_revision_captura();
drop policy if exists admin_revision_por_rpc on public.lecturas_uf;
create policy admin_revision_por_rpc on public.lecturas_uf as restrictive for update to authenticated
 using ((select private.rol_actual()) is distinct from 'admin'::public.rol_usuario)
 with check ((select private.rol_actual()) is distinct from 'admin'::public.rol_usuario);
alter table public.muestras_calidad add column if not exists revision_admin bigint not null default 0;
drop trigger if exists incrementar_revision_captura on public.muestras_calidad;
create trigger incrementar_revision_captura before update on public.muestras_calidad for each row execute function private.incrementar_revision_captura();
drop policy if exists admin_revision_por_rpc on public.muestras_calidad;
create policy admin_revision_por_rpc on public.muestras_calidad as restrictive for update to authenticated
 using ((select private.rol_actual()) is distinct from 'admin'::public.rol_usuario)
 with check ((select private.rol_actual()) is distinct from 'admin'::public.rol_usuario);
alter table public.lecturas_ptar add column if not exists revision_admin bigint not null default 0;
drop trigger if exists incrementar_revision_captura on public.lecturas_ptar;
create trigger incrementar_revision_captura before update on public.lecturas_ptar for each row execute function private.incrementar_revision_captura();
drop policy if exists admin_revision_por_rpc on public.lecturas_ptar;
create policy admin_revision_por_rpc on public.lecturas_ptar as restrictive for update to authenticated
 using ((select private.rol_actual()) is distinct from 'admin'::public.rol_usuario)
 with check ((select private.rol_actual()) is distinct from 'admin'::public.rol_usuario);
-- Los resultados se bloquean antes que la muestra, igual que el guardado de Calidad.
create or replace function private.revision_resultado_captura() returns trigger language plpgsql security definer set search_path='' as $resultado$
begin
 if new.valor is distinct from old.valor then
  update public.muestras_calidad set revision_admin=revision_admin where id=new.muestra_id;
 end if; return new;
end;
$resultado$;
alter function private.revision_resultado_captura() owner to postgres;
revoke all on function private.revision_resultado_captura() from public,anon,authenticated;
drop trigger if exists revision_resultado_captura on public.resultados_calidad;
create trigger revision_resultado_captura after update of valor on public.resultados_calidad for each row execute function private.revision_resultado_captura();
drop policy if exists admin_revision_por_rpc on public.resultados_calidad;
create policy admin_revision_por_rpc on public.resultados_calidad as restrictive for update to authenticated
 using ((select private.rol_actual()) is distinct from 'admin'::public.rol_usuario)
 with check ((select private.rol_actual()) is distinct from 'admin'::public.rol_usuario);

create or replace function private.tabla_revision_captura(p_modulo text) returns text language sql immutable set search_path='' as $tabla$
 select case p_modulo when 'bitacora' then 'bitacora' when 'pozos' then 'lecturas_pozos' when 'uf' then 'lecturas_uf' when 'calidad' then 'muestras_calidad' when 'ptar' then 'lecturas_ptar' end;
$tabla$;
alter function private.tabla_revision_captura(text) owner to postgres;
revoke all on function private.tabla_revision_captura(text) from public,anon,authenticated;
create or replace function private.snapshot_revision_captura(p_modulo text,p_registro uuid) returns jsonb
language plpgsql security definer set search_path='' as $snapshot$
declare v_tabla text:=private.tabla_revision_captura(p_modulo); v_fila jsonb; v_resultados jsonb:='[]'::jsonb;
begin
 if v_tabla is null then raise exception using errcode='22023',message='Módulo inválido.'; end if;
 execute format('select to_jsonb(c) from public.%I c where c.id=$1',v_tabla) into v_fila using p_registro;
 if v_fila is null then return null; end if;
 if p_modulo='calidad' then
  select coalesce(jsonb_agg(to_jsonb(rc) order by rc.id),'[]'::jsonb) into v_resultados from public.resultados_calidad rc where rc.muestra_id=p_registro;
 end if;
 return jsonb_build_object('registro',v_fila,'resultados',v_resultados);
end;
$snapshot$;
alter function private.snapshot_revision_captura(text,uuid) owner to postgres;
revoke all on function private.snapshot_revision_captura(text,uuid) from public,anon,authenticated;

create or replace function public.consultar_capturas_admin(p_desde date,p_hasta date,p_area text,p_turno text,p_modulo text,p_estado text,p_operador text,p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $consulta$
declare v_salida jsonb;
begin
 if auth.uid() is null or not private.es_admin() then raise exception using errcode='42501',message='Solo un administrador activo puede revisar capturas.'; end if;
 if p_desde is null or p_hasta is null or p_hasta<p_desde or p_hasta-p_desde>30
  or p_area is null or p_area not in('todas','calderas','ptar') or p_turno is null or p_turno not in('todos','dia','tarde','noche')
  or p_modulo is null or p_modulo not in('todos','bitacora','pozos','uf','calidad','ptar')
  or p_estado is null or p_estado not in('vigentes','anuladas','todos') or p_offset is null or p_offset<0 or p_offset>100000
  or p_operador is null or length(p_operador)>200 then raise exception using errcode='22023',message='Revisa los filtros. Consulta hasta 31 días por período.'; end if;
 with capturas as (
 select 'bitacora'::text as modulo, c.id,c.turno_id,c.capturado_en,c.eliminado_en from public.bitacora c
 union all
 select 'pozos'::text as modulo, c.id,c.turno_id,c.capturado_en,c.eliminado_en from public.lecturas_pozos c
 union all
 select 'uf'::text as modulo, c.id,c.turno_id,c.capturado_en,c.eliminado_en from public.lecturas_uf c
 union all
 select 'calidad'::text as modulo, c.id,c.turno_id,c.capturado_en,c.eliminado_en from public.muestras_calidad c
 union all
 select 'ptar'::text as modulo, c.id,c.turno_id,c.capturado_en,c.eliminado_en from public.lecturas_ptar c
 ), elegidas as (
 select cp.*,to_jsonb(t) as turno,o.nombre as operador from capturas cp
 join public.turnos_operativos t on t.id=cp.turno_id join public.operadores o on o.id=t.operador_id
 where t.fecha_operativa between p_desde and p_hasta and (p_area='todas' or t.area::text=p_area)
  and (p_turno='todos' or t.turno::text=p_turno) and (p_modulo='todos' or cp.modulo=p_modulo)
  and (p_estado='todos' or (p_estado='vigentes' and cp.eliminado_en is null) or (p_estado='anuladas' and cp.eliminado_en is not null))
  and strpos(lower(o.nombre),lower(trim(p_operador)))>0
 order by cp.capturado_en desc,cp.modulo,cp.id limit 26 offset p_offset
 ), filas as (
 select jsonb_build_object('id',el.id,'modulo',el.modulo,'turno',el.turno,'operador',el.operador,
  'snapshot',private.snapshot_revision_captura(el.modulo,el.id),
  'nombres_resultados',case when el.modulo='calidad' then (select coalesce(jsonb_agg(jsonb_build_object('id',res.id,'punto',pu.nombre,'parametro',pa.nombre,'unidad',pa.unidad) order by res.id),'[]'::jsonb)
    from public.resultados_calidad res join public.puntos_muestreo pu on pu.id=res.punto_id join public.parametros_calidad pa on pa.id=res.parametro_id where res.muestra_id=el.id) else '[]'::jsonb end) as fila,
  row_number() over(order by el.capturado_en desc,el.modulo,el.id) as numero from elegidas el
 ) select jsonb_build_object('filas',coalesce(jsonb_agg(fila order by numero) filter(where numero<=25),'[]'::jsonb),'mas',count(*)>25) into v_salida from filas;
 return v_salida;
end;
$consulta$;
alter function public.consultar_capturas_admin(date,date,text,text,text,text,text,integer) owner to postgres;
revoke all on function public.consultar_capturas_admin(date,date,text,text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.consultar_capturas_admin(date,date,text,text,text,text,text,integer) to authenticated;

create or replace function public.revisar_captura_admin(p_id uuid,p_modulo text,p_registro uuid,p_original jsonb,p_accion text,p_datos jsonb,p_motivo text)
returns uuid language plpgsql security definer set search_path='' as $guardar$
declare v_tabla text:=private.tabla_revision_captura(p_modulo); v_antes jsonb; v_despues jsonb;
 v_evento public.revisiones_captura%rowtype; v_campos text[]; v_campo text; v_numero numeric;
 v_nombre text; v_cuenta uuid:=auth.uid(); v_resultado record; v_id_resultado uuid; v_esperados jsonb; v_enviados jsonb;
begin
 if v_cuenta is null or not private.es_admin() then raise exception using errcode='42501',message='Solo un administrador activo puede revisar capturas.'; end if;
 if p_id is null or p_registro is null or v_tabla is null or p_original is null or jsonb_typeof(p_original)<>'object'
  or p_accion is null or p_accion not in('corregir','anular') or p_datos is null or jsonb_typeof(p_datos)<>'object'
  or p_motivo is null or p_motivo !~ '[^[:space:]]' or length(trim(p_motivo)) not between 1 and 4000 then raise exception using errcode='22023',message='Selecciona una captura y escribe el motivo obligatorio.'; end if;
 if p_modulo='calidad' then perform 1 from public.resultados_calidad cr where cr.muestra_id=p_registro order by cr.id for update; end if;
 execute format('select to_jsonb(c) from public.%I c where c.id=$1 for update',v_tabla) into v_antes using p_registro;
 if v_antes is null then raise exception using errcode='22023',message='No se encontró la captura.'; end if;
 select rev.* into v_evento from public.revisiones_captura rev where rev.id=p_id;
 if found then
  if v_evento.creado_por=v_cuenta and v_evento.modulo=p_modulo and v_evento.registro_id=p_registro and v_evento.accion=p_accion
   and v_evento.antes=p_original and v_evento.datos_solicitados=p_datos and v_evento.motivo=trim(p_motivo) then return p_id; end if;
  raise exception using errcode='23505',message='El identificador pertenece a otra solicitud.';
 end if;
 v_antes:=private.snapshot_revision_captura(p_modulo,p_registro);
 if v_antes is distinct from p_original then raise exception using errcode='40001',message='La captura cambió. Actualiza y revisa antes de guardar.'; end if;
 if v_antes->'registro'->>'eliminado_en' is not null then raise exception using errcode='22023',message='La captura ya está anulada. Su historial se conserva.'; end if;
 if p_accion='anular' then
  if p_datos<>'{}'::jsonb then raise exception using errcode='22023',message='La anulación no modifica mediciones.'; end if;
  execute format('update public.%I set eliminado_en=clock_timestamp(),eliminado_por=$1 where id=$2',v_tabla) using v_cuenta,p_registro;
 else
  v_campos:=case p_modulo when 'bitacora' then array['texto']
 when 'pozos' then array['pozo1_ini','pozo1_fin','pozo2_ini','pozo2_fin','notas']
 when 'uf' then array['alim_ini','alim_fin','acep_ini','acep_fin','notas']
 when 'calidad' then array['notas','resultados']
 when 'ptar' then array['dqo_sand_float','dqo_t03_04','dqo_colector','dqo_pila','sst_sand_float','sst_t03_04','sst_colector','sst_pila','notas'] end;
  if not(p_datos ?& v_campos) or exists(select 1 from jsonb_object_keys(p_datos) as claves(llave) where not(claves.llave=any(v_campos))) then raise exception using errcode='22023',message='Solo pueden cambiarse los campos de captura permitidos.'; end if;
  foreach v_campo in array v_campos loop
   if v_campo in('texto','notas') then
    if (v_campo='texto' and (jsonb_typeof(p_datos->v_campo) is distinct from 'string' or length(trim(p_datos->>v_campo))=0))
      or jsonb_typeof(p_datos->v_campo) not in('string','null') or length(p_datos->>v_campo)>20000 then raise exception using errcode='22023',message='Revisa el texto o las notas.'; end if;
   elsif v_campo<>'resultados' then
    if jsonb_typeof(p_datos->v_campo)='null' and p_modulo='ptar' then continue; end if;
    if jsonb_typeof(p_datos->v_campo) is distinct from 'number' then raise exception using errcode='22023',message='Revisa las mediciones numéricas.'; end if;
    v_numero:=(p_datos->>v_campo)::numeric;
    if v_numero<0 or v_numero>9007199254740991 then raise exception using errcode='22023',message='Las mediciones deben ser números no negativos dentro del rango permitido.'; end if;
   end if;
  end loop;
  if p_modulo='pozos' and ((p_datos->>'pozo1_fin')::numeric<(p_datos->>'pozo1_ini')::numeric or (p_datos->>'pozo2_fin')::numeric<(p_datos->>'pozo2_ini')::numeric)
    then raise exception using errcode='22023',message='La lectura final no puede ser menor que la inicial.'; end if;
  if p_modulo='uf' and ((p_datos->>'alim_fin')::numeric<(p_datos->>'alim_ini')::numeric or (p_datos->>'acep_fin')::numeric<(p_datos->>'acep_ini')::numeric)
    then raise exception using errcode='22023',message='La lectura final no puede ser menor que la inicial.'; end if;
  if p_modulo='ptar' and not exists(select 1 from jsonb_each(p_datos-'notas') medicion where medicion.value<>'null'::jsonb)
    then raise exception using errcode='22023',message='Completa al menos una medición PTAR.'; end if;
  if p_modulo='calidad' then
   if jsonb_typeof(p_datos->'resultados') is distinct from 'array' then raise exception using errcode='22023',message='Resultados de Calidad inválidos.'; end if;
   for v_resultado in select value as contenido from jsonb_array_elements(p_datos->'resultados') loop
    if jsonb_typeof(v_resultado.contenido)<>'object' or not(v_resultado.contenido ?& array['id','valor'])
      or (select count(*) from jsonb_object_keys(v_resultado.contenido))<>2
      or jsonb_typeof(v_resultado.contenido->'valor') is distinct from 'number'
      or jsonb_typeof(v_resultado.contenido->'id') is distinct from 'string'
      then raise exception using errcode='22023',message='Resultados de Calidad inválidos.'; end if;
    v_id_resultado:=(v_resultado.contenido->>'id')::uuid;
    v_numero:=(v_resultado.contenido->>'valor')::numeric;
    if v_numero<0 or v_numero>9007199254740991 then raise exception using errcode='22023',message='Valor de Calidad fuera del rango permitido.'; end if;
   end loop;
   select coalesce(jsonb_agg(ids.id order by ids.id),'[]'::jsonb) into v_enviados from jsonb_to_recordset(p_datos->'resultados') as ids(id uuid,valor numeric);
   select coalesce(jsonb_agg(rc.id order by rc.id),'[]'::jsonb) into v_esperados from public.resultados_calidad rc where rc.muestra_id=p_registro;
   if v_enviados<>v_esperados then raise exception using errcode='22023',message='Se conservan todos los resultados, puntos y parámetros originales.'; end if;
   update public.resultados_calidad rc set valor=entrada.valor from jsonb_to_recordset(p_datos->'resultados') as entrada(id uuid,valor numeric)
     where rc.muestra_id=p_registro and rc.id=entrada.id and rc.valor is distinct from entrada.valor;
   update public.muestras_calidad set notas=nullif(trim(p_datos->>'notas'),'') where id=p_registro;
  else
   if p_modulo='bitacora' then
 update public.bitacora set texto=trim(p_datos->>'texto') where id=p_registro;
end if;
if p_modulo='pozos' then
 update public.lecturas_pozos set pozo1_ini=(p_datos->>'pozo1_ini')::numeric,pozo1_fin=(p_datos->>'pozo1_fin')::numeric,pozo2_ini=(p_datos->>'pozo2_ini')::numeric,pozo2_fin=(p_datos->>'pozo2_fin')::numeric,notas=nullif(trim(p_datos->>'notas'),'') where id=p_registro;
end if;
if p_modulo='uf' then
 update public.lecturas_uf set alim_ini=(p_datos->>'alim_ini')::numeric,alim_fin=(p_datos->>'alim_fin')::numeric,acep_ini=(p_datos->>'acep_ini')::numeric,acep_fin=(p_datos->>'acep_fin')::numeric,notas=nullif(trim(p_datos->>'notas'),'') where id=p_registro;
end if;
if p_modulo='ptar' then
 update public.lecturas_ptar set dqo_sand_float=(p_datos->>'dqo_sand_float')::numeric,dqo_t03_04=(p_datos->>'dqo_t03_04')::numeric,dqo_colector=(p_datos->>'dqo_colector')::numeric,dqo_pila=(p_datos->>'dqo_pila')::numeric,sst_sand_float=(p_datos->>'sst_sand_float')::numeric,sst_t03_04=(p_datos->>'sst_t03_04')::numeric,sst_colector=(p_datos->>'sst_colector')::numeric,sst_pila=(p_datos->>'sst_pila')::numeric,notas=nullif(trim(p_datos->>'notas'),'') where id=p_registro;
end if;
  end if;
 end if;
 v_despues:=private.snapshot_revision_captura(p_modulo,p_registro);
 if ((v_despues->'registro')-'revision_admin')=((v_antes->'registro')-'revision_admin') and v_despues->'resultados'=v_antes->'resultados'
   then raise exception using errcode='22023',message='No hay cambios para guardar.'; end if;
 select pf.nombre into strict v_nombre from public.perfiles pf where pf.id=v_cuenta and pf.activo;
 insert into public.revisiones_captura(id,modulo,registro_id,accion,motivo,creado_por,responsable_nombre,antes,despues,datos_solicitados)
 values(p_id,p_modulo,p_registro,p_accion,trim(p_motivo),v_cuenta,v_nombre,v_antes,v_despues,p_datos);
 return p_id;
end;
$guardar$;
alter function public.revisar_captura_admin(uuid,text,uuid,jsonb,text,jsonb,text) owner to postgres;
revoke all on function public.revisar_captura_admin(uuid,text,uuid,jsonb,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.revisar_captura_admin(uuid,text,uuid,jsonb,text,jsonb,text) to authenticated;
-- Autocomprobación con fixtures; TODOS los cambios de prueba se revierten.
-- Los turnos ficticios son cerrados e históricos: no cierra ni toca turnos reales.
do $prueba_revision$
declare
 v_admin uuid:=gen_random_uuid(); v_operador_cuenta uuid:=gen_random_uuid(); v_op uuid:=gen_random_uuid();
 v_tc uuid:=gen_random_uuid(); v_tp uuid:=gen_random_uuid(); v_libre date; v_hora timestamptz:=clock_timestamp();
 v_bit uuid:=gen_random_uuid(); v_pozo uuid:=gen_random_uuid(); v_uf uuid:=gen_random_uuid(); v_cal uuid:=gen_random_uuid(); v_ptar uuid:=gen_random_uuid();
 v_punto uuid:=gen_random_uuid(); v_parametro uuid:=gen_random_uuid(); v_limite uuid:=gen_random_uuid(); v_resultado uuid:=gen_random_uuid();
 v_revision uuid:=gen_random_uuid(); v_anulacion uuid:=gen_random_uuid(); v_segunda uuid:=gen_random_uuid(); v_snapshot jsonb; v_actual jsonb; v_salida jsonb;
 v_datos jsonb; v_rechazado boolean; v_terminada boolean:=false; v_afectadas bigint;
 v_jwt_sub text:=current_setting('request.jwt.claim.sub',true); v_jwt_claims text:=current_setting('request.jwt.claims',true);
begin
 if current_user<>'postgres' then raise exception 'Ejecuta el archivo completo como postgres.'; end if;
 if not has_function_privilege('authenticated','public.revisar_captura_admin(uuid,text,uuid,jsonb,text,jsonb,text)','EXECUTE')
  or has_function_privilege('anon','public.revisar_captura_admin(uuid,text,uuid,jsonb,text,jsonb,text)','EXECUTE')
  or has_table_privilege('authenticated','public.revisiones_captura','INSERT') then raise exception 'Permisos de revisión inesperados.'; end if;
 begin
  perform set_config('request.jwt.claim.sub','',true); perform set_config('request.jwt.claims','{}',true);
  insert into auth.users(id,aud,role,email,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
   select fixture_id,'authenticated','authenticated','prueba-revision-'||fixture_id::text||'@example.invalid',v_hora,v_hora,'{}','{}' from unnest(array[v_admin,v_operador_cuenta]) as fixtures(fixture_id);
  insert into public.perfiles(id,nombre,rol,activo) values(v_admin,'PRUEBA ADMIN REVISION','admin',true),(v_operador_cuenta,'PRUEBA OPERADOR REVISION','calderas',true);
  insert into public.operadores(id,nombre,activo) values(v_op,'PRUEBA REVISION '||v_op::text,true);
  -- La fecha automática se omite solo para insertar fixtures históricos dentro del rollback.
  alter table public.turnos_operativos disable trigger asignar_inicio_turno;
  select (v_hora at time zone 'America/Mexico_City')::date-dias.numero into v_libre from generate_series(1,10000) as dias(numero)
    where not exists(select 1 from public.turnos_operativos ot where ot.fecha_operativa=(v_hora at time zone 'America/Mexico_City')::date-dias.numero)
    order by dias.numero limit 1;
  if v_libre is null then raise exception 'No hay fecha libre para fixtures.'; end if;
  insert into public.turnos_operativos(id,fecha_operativa,area,turno,operador_id,iniciado_por,iniciado_en,finalizado_en)
   values(v_tc,v_libre,'calderas','dia',v_op,v_operador_cuenta,v_hora-interval '3 hours',v_hora-interval '1 hour'),
    (v_tp,v_libre,'ptar','dia',v_op,v_operador_cuenta,v_hora-interval '3 hours',v_hora-interval '1 hour');
  alter table public.turnos_operativos enable trigger asignar_inicio_turno;
  insert into public.bitacora(id,turno_id,texto,capturado_en,creado_por) values(v_bit,v_tc,'Texto original',v_hora-interval '2 hours',v_operador_cuenta);
  insert into public.lecturas_pozos(id,turno_id,pozo1_ini,pozo1_fin,pozo2_ini,pozo2_fin,capturado_en,creado_por) values(v_pozo,v_tc,10,20,30,40,v_hora-interval '2 hours',v_operador_cuenta);
  insert into public.lecturas_uf(id,turno_id,alim_ini,alim_fin,acep_ini,acep_fin,capturado_en,creado_por) values(v_uf,v_tc,100,200,100,180,v_hora-interval '2 hours',v_operador_cuenta);
  insert into public.lecturas_ptar(id,turno_id,dqo_pila,capturado_en,creado_por) values(v_ptar,v_tp,50,v_hora-interval '2 hours',v_operador_cuenta);
  insert into public.puntos_muestreo(id,nombre,area,activo) values(v_punto,'PRUEBA REVISION '||v_punto::text,null,true);
  insert into public.parametros_calidad(id,nombre,unidad,activo) values(v_parametro,'PRUEBA REVISION '||v_parametro::text,null,true);
  insert into public.limites_calidad(id,punto_id,parametro_id,limite_min,limite_max,vigente_desde,creado_por) values(v_limite,v_punto,v_parametro,0,30,v_hora-interval '1 day',v_admin);
  insert into public.muestras_calidad(id,turno_id,hora_muestra,capturado_en,creado_por) values(v_cal,v_tc,'10:00',v_hora-interval '2 hours',v_operador_cuenta);
  insert into public.resultados_calidad(id,muestra_id,punto_id,parametro_id,valor) values(v_resultado,v_cal,v_punto,v_parametro,35);
  v_snapshot:=private.snapshot_revision_captura('bitacora',v_bit);
  perform set_config('request.jwt.claim.sub',v_operador_cuenta::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',v_operador_cuenta,'role','authenticated')::text,true);
  v_rechazado:=false;
  begin perform public.revisar_captura_admin(v_revision,'bitacora',v_bit,v_snapshot,'corregir','{"texto":"Cambio indebido"}','Prueba');exception when insufficient_privilege then v_rechazado:=true;end;
  if not v_rechazado then raise exception 'Operador pudo corregir mediante el RPC administrativo.';end if;
  v_rechazado:=false;
  begin perform public.consultar_capturas_admin(v_libre,v_libre,'todas','todos','todos','todos','',0);exception when insufficient_privilege then v_rechazado:=true;end;
  if not v_rechazado then raise exception 'Operador pudo consultar la bandeja administrativa.';end if;
  perform set_config('request.jwt.claim.sub',v_admin::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  -- La cuenta admin no puede omitir el motivo con UPDATE directo.
  execute 'set local role authenticated';
  update public.bitacora set texto='Cambio sin motivo' where id=v_bit;
  get diagnostics v_afectadas=row_count;
  execute 'reset role';
  if v_afectadas<>0 then raise exception 'Admin pudo cambiar directamente sin motivo.';end if;
  v_salida:=public.consultar_capturas_admin(v_libre,v_libre,'todas','todos','todos','todos',v_op::text,0);
  if jsonb_array_length(v_salida->'filas')<>5 then raise exception 'La consulta no incluye los cinco módulos.';end if;
  v_rechazado:=false;
  begin perform public.revisar_captura_admin(v_revision,'bitacora',v_bit,v_snapshot,'corregir','{"texto":"Corregido"}',' ');exception when invalid_parameter_value then v_rechazado:=true;end;
  if not v_rechazado then raise exception 'Se permitió motivo vacío.';end if;
  perform public.revisar_captura_admin(v_revision,'bitacora',v_bit,v_snapshot,'corregir','{"texto":"Corregido"}','Motivo comprobado');
  perform public.revisar_captura_admin(v_revision,'bitacora',v_bit,v_snapshot,'corregir','{"texto":"Corregido"}','Motivo comprobado');
  if (select count(*) from public.revisiones_captura rev where rev.id=v_revision)<>1 then raise exception 'Reintento duplicado.';end if;
  v_actual:=private.snapshot_revision_captura('bitacora',v_bit);
  if v_actual->'registro'->>'capturado_en' is distinct from v_snapshot->'registro'->>'capturado_en'
    or v_actual->'registro'->>'creado_por' is distinct from v_snapshot->'registro'->>'creado_por' then raise exception 'Se cambió autor o fecha original.';end if;
  v_rechazado:=false;
  begin perform public.revisar_captura_admin(gen_random_uuid(),'bitacora',v_bit,v_snapshot,'corregir','{"texto":"Otra corrección"}','Versión anterior');exception when serialization_failure then v_rechazado:=true;end;
  if not v_rechazado then raise exception 'Se aceptó versión anterior.';end if;
  perform public.revisar_captura_admin(v_anulacion,'bitacora',v_bit,v_actual,'anular','{}','Registro equivocado');
  perform public.revisar_captura_admin(v_anulacion,'bitacora',v_bit,v_actual,'anular','{}','Registro equivocado');
  if not exists(select 1 from public.bitacora b where b.id=v_bit and b.eliminado_en is not null and b.eliminado_por=v_admin and b.texto='Corregido') then raise exception 'Anulación incorrecta.';end if;
  v_salida:=public.consultar_capturas_admin(v_libre,v_libre,'todas','todos','todos','anuladas',v_op::text,0);
  if jsonb_array_length(v_salida->'filas')<>1 then raise exception 'La consulta no conserva anuladas.';end if;
  v_snapshot:=private.snapshot_revision_captura('pozos',v_pozo);
  perform public.revisar_captura_admin(gen_random_uuid(),'pozos',v_pozo,v_snapshot,'corregir','{"pozo1_ini":10,"pozo1_fin":25,"pozo2_ini":30,"pozo2_fin":45,"notas":null}','Medidores verificados');
  if not exists(select 1 from public.lecturas_pozos lp where lp.id=v_pozo and lp.consumo_pozo1=15 and lp.consumo_pozo2=15) then raise exception 'Consumos incorrectos.';end if;
  v_snapshot:=private.snapshot_revision_captura('uf',v_uf);
  perform public.revisar_captura_admin(gen_random_uuid(),'uf',v_uf,v_snapshot,'corregir','{"alim_ini":100,"alim_fin":200,"acep_ini":100,"acep_fin":185,"notas":null}','Medidores verificados');
  if not exists(select 1 from public.lecturas_uf lu where lu.id=v_uf and lu.rendimiento=85 and lu.rechazo=15) then raise exception 'Rendimiento incorrecto.';end if;
  v_snapshot:=private.snapshot_revision_captura('ptar',v_ptar);
  v_datos:='{"dqo_sand_float":null,"dqo_t03_04":null,"dqo_colector":null,"dqo_pila":55,"sst_sand_float":null,"sst_t03_04":null,"sst_colector":null,"sst_pila":null,"notas":null}'::jsonb;
  perform public.revisar_captura_admin(gen_random_uuid(),'ptar',v_ptar,v_snapshot,'corregir',v_datos,'Medición verificada');
  if not exists(select 1 from public.lecturas_ptar lp where lp.id=v_ptar and lp.dqo_pila=55 and lp.sst_pila is null) then raise exception 'Medición PTAR incorrecta.';end if;
  v_snapshot:=private.snapshot_revision_captura('calidad',v_cal);
  perform public.revisar_captura_admin(gen_random_uuid(),'calidad',v_cal,v_snapshot,'corregir',jsonb_build_object('notas',null,'resultados',jsonb_build_array(jsonb_build_object('id',v_resultado,'valor',25))),'Medición verificada');
  if not exists(select 1 from public.resultados_calidad rc where rc.id=v_resultado and rc.valor=25 and rc.limite_max_aplicado=30 and not rc.fuera_norma)
   or not exists(select 1 from public.alertas_operativas al where al.registro_id=v_resultado and al.origen_estado='corregido' and al.valor=35) then raise exception 'Calidad o alertas no conservaron el episodio original.';end if;
  v_actual:=private.snapshot_revision_captura('calidad',v_cal);
  if (v_actual->'registro'->>'revision_admin')::bigint<=(v_snapshot->'registro'->>'revision_admin')::bigint then raise exception 'La versión de Calidad no avanzó.';end if;
  perform public.revisar_captura_admin(v_segunda,'calidad',v_cal,v_actual,'corregir',jsonb_build_object('notas',null,'resultados',jsonb_build_array(jsonb_build_object('id',v_resultado,'valor',40))),'Nueva medición verificada');
  if (select count(*) from public.alertas_operativas al where al.registro_id=v_resultado)<>2 then raise exception 'Falta episodio nuevo de alerta.';end if;
  v_actual:=private.snapshot_revision_captura('calidad',v_cal);
  perform public.revisar_captura_admin(gen_random_uuid(),'calidad',v_cal,v_actual,'anular','{}','Muestra equivocada');
  if exists(select 1 from public.alertas_operativas al where al.registro_id=v_resultado and al.origen_estado<>'anulado') then raise exception 'Anulación sin marca de origen en alertas.';end if;
  v_rechazado:=false;
  begin update public.revisiones_captura set motivo='Alterado' where id=v_revision;exception when insufficient_privilege then v_rechazado:=true;end;
  if not v_rechazado then raise exception 'Historial editable.';end if;
  if not exists(select 1 from public.auditoria au where au.tabla='public.revisiones_captura' and au.registro_id=v_revision::text and au.usuario=v_admin) then raise exception 'Falta auditoría de revisión.';end if;
  v_terminada:=true;
  raise exception using errcode='ZX035',message='Rollback intencional de fixtures';
 exception when sqlstate 'ZX035' then null;
 end;
 if not v_terminada or exists(select 1 from public.revisiones_captura rev where rev.creado_por=v_admin)
   or exists(select 1 from auth.users u where u.id in(v_admin,v_operador_cuenta))
   or exists(select 1 from public.turnos_operativos t where t.id in(v_tc,v_tp))
   or exists(select 1 from public.alertas_operativas a where a.registro_id=v_resultado)
   or exists(select 1 from public.auditoria au where au.usuario in(v_admin,v_operador_cuenta) or au.registro_id in(v_bit::text,v_pozo::text,v_uf::text,v_cal::text,v_ptar::text,v_op::text,v_resultado::text))
   then raise exception 'Los fixtures no se revirtieron por completo.';end if;
 perform set_config('request.jwt.claim.sub',coalesce(v_jwt_sub,''),true);perform set_config('request.jwt.claims',coalesce(v_jwt_claims,'{}'),true);
end;
$prueba_revision$;

commit;
select 'Revisión administrativa' as comprobacion,'APROBADA' as resultado;
