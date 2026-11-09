-- LOCAL: revisar y aplicar solo con autorización. No ejecutada remotamente.
-- Cierre lógico de reportes técnicos por horario; no cierra otras capturas del turno.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
do $pre$
declare firma text;
begin
 foreach firma in array array[
 'private.btr_normalizar_calderas(jsonb)','private.btr_normalizar_ptar(jsonb)',
 'private.btr_escribir_calderas(uuid,uuid,jsonb,boolean)','private.btr_escribir_ptar(text,uuid,uuid,jsonb,boolean)',
 'private.bt_snapshot_v1(text,uuid)','private.bt_proteger_v1()','private.bc_proteger_v2()',
 'private.asignar_inicio_turno()','private.registrar_auditoria()',
 'private.operador_activo_por_empleado(text,uuid,text)',
 'public.iniciar_turno_pareja_empleado(uuid,public.turno_tipo,text,uuid,text,text,uuid,text,uuid)'
 ] loop if to_regprocedure(firma) is null then raise exception 'Falta dependencia: %',firma;end if;end loop;
 if to_regprocedure('public.guardar_reporte_operativo(uuid,text,uuid,jsonb,uuid,bigint)') is not null then
  raise exception 'La mejora ya está instalada. Revisar antes de volver a aplicar.';end if;
 if not exists(select 1 from pg_attribute where attrelid='public.bitacora_calderas'::regclass and attname='comentarios_pilas' and not attisdropped)
  or not exists(select 1 from pg_attribute where attrelid='public.bitacora_ptar'::regclass and attname='velocidad_prensa_essity' and not attisdropped) then
  raise exception 'Aplicar previamente las migraciones autorizadas de comentarios de Pilas y velocidades de prensas.';end if;
end;
$pre$;


create function private.bt_intervalo(p_fecha date,p_turno public.turno_tipo)
returns table(inicio timestamptz,fin timestamptz)
language sql stable set search_path='' as $f$
 select (p_fecha+case p_turno when 'dia' then time '07:01' when 'tarde' then time '15:01' else time '21:01' end) at time zone 'America/Mexico_City',
 ((p_fecha+case when p_turno='noche' then 1 else 0 end)+case p_turno when 'dia' then time '15:01' when 'tarde' then time '21:01' else time '07:01' end) at time zone 'America/Mexico_City'
$f$;

create function private.bt_operador_en_turno(t public.turnos_operativos,p_ahora timestamptz)
returns boolean language sql stable security definer set search_path='' as $f$
 select coalesce(auth.uid()=t.iniciado_por and private.rol_actual()::text=t.area::text
   and t.area::text in ('calderas','ptar')
   and t.iniciado_en>=v.inicio and t.iniciado_en<v.fin
   and p_ahora>=t.iniciado_en and p_ahora>=v.inicio and p_ahora<v.fin,false)
 from private.bt_intervalo(t.fecha_operativa,t.turno) v
$f$;

create function private.bt_operador_reporte(p_modulo text,p_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $f$
declare tid uuid; t public.turnos_operativos%rowtype;
begin
 if current_setting('copamex.bt_operador',true) is distinct from p_modulo||':'||p_id::text then return false; end if;
 if p_modulo='bitacora_calderas' then select turno_id into tid from public.bitacora_calderas where id=p_id;
 elsif p_modulo='bitacora_ptar' then select turno_id into tid from public.bitacora_ptar where id=p_id;
 else return false; end if;
 select * into t from public.turnos_operativos where id=tid;
 return found and private.bt_operador_en_turno(t,clock_timestamp());
end;
$f$;

-- Misma exigencia de campos del envío manual actual. Los opcionales siguen siendo opcionales.
create function private.bt_completo(p_area text,d jsonb) returns boolean
language plpgsql immutable set search_path='' as $f$
declare e jsonb;
begin
 if nullif(btrim(d->>'reporteRelevante'),'') is null then return false; end if;
 if exists(select 1 from jsonb_each(d->'mediciones') where value='null'::jsonb) then return false; end if;
 if p_area='calderas' then
   if d->>'estadoUF' is null then return false; end if;
   for e in select value from jsonb_each(d->'pilas') loop
     if e->>'nivel' is null or e->>'bomba' is null or e->>'presion' is null then return false; end if;
   end loop;
   if exists(select 1 from jsonb_each(d->'compresores') where value='null'::jsonb) then return false; end if;
   if exists(select 1 from jsonb_each(d->'equipos') where value->>'estado' is null or (key like 'sulzer_%' and value->>'presion' is null)) then return false; end if;
 else
   if d->>'estadoAgitador' is null or d->>'destinoDescarga' is null
     or d->'horasDescarga'->>'tanque11' is null or d->'horasDescarga'->>'tanques56' is null then return false; end if;
   if exists(select 1 from jsonb_each(d->'bombas') where value='null'::jsonb)
     or exists(select 1 from jsonb_each(d->'prensas') where value='null'::jsonb) then return false; end if;
 end if;
 return true;
end;
$f$;

-- Evaluación sobre el snapshot realmente persistido, sin escribir ni rellenar campos históricos.
create function private.bt_snapshot_completo(p_area text,s jsonb) returns boolean
language plpgsql immutable set search_path='' as $f$
declare r jsonb:=s->'registro'; k text;
begin
 if s is null or nullif(btrim(r->>'reporte_relevante'),'') is null then return false; end if;
 if p_area='calderas' then
  foreach k in array array['nivel_condensado','presion_432','presion_433','presion_422','presion_424','flujo_osmosis','flujo_uf','nivel_rotoplas','presion_aire','nivel_agua_potable','estado_uf'] loop
    if r->>k is null then return false; end if;
  end loop;
  if jsonb_array_length(s->'equipos')<>12 or jsonb_array_length(s->'pilas')<>4 then return false; end if;
  if exists(select 1 from jsonb_array_elements(s->'equipos') e where e->>'estado' is null or (e->>'equipo' like 'sulzer_%' and e->>'presion' is null))
   or exists(select 1 from jsonb_array_elements(s->'pilas') e where e->>'nivel' is null or e->>'bomba' is null or e->>'presion' is null) then return false; end if;
 else
  foreach k in array array['flujo_clarificador','nivel_tanque_11','nivel_tanque_300','torque_clarificador','setpoint_b13','flujo_entrada_ptar','flujo_daf_chino','nivel_daf_chino','flujo_daf_huber','flujo_reactor_2','flujo_aimsu','presion_linea','nivel_almacen','estado_agitador_9300','destino_descarga_daf','modo_bomba_9','modo_bomba_13','modo_bomba_9310','estado_prensa_essity','estado_prensa_nalco','horas_descarga_tanque_11','horas_descarga_tanques_5_6'] loop
   if r->>k is null then return false; end if;
  end loop;
 end if;
 return true;
end;
$f$;

create function public.consultar_contexto_reporte_operativo(p_area text,p_turno_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare t public.turnos_operativos%rowtype; v record; rid uuid; ahora timestamptz:=statement_timestamp(); s jsonb; permiso boolean;
begin
 if auth.uid() is null or private.rol_actual()::text is distinct from p_area or p_area not in ('calderas','ptar') then
  raise exception using errcode='42501',message='Se requiere la cuenta activa del área.'; end if;
 select * into t from public.turnos_operativos where area::text=p_area and iniciado_por=auth.uid()
   and (p_turno_id is null or id=p_turno_id) order by iniciado_en desc,id desc limit 1;
 if not found then return jsonb_build_object('turno_id',null,'ahora',ahora,'puede_editar',false,'estado','Sin turno'); end if;
 select * into v from private.bt_intervalo(t.fecha_operativa,t.turno);
 if p_area='calderas' then select id into rid from public.bitacora_calderas where turno_id=t.id;
 else select id into rid from public.bitacora_ptar where turno_id=t.id; end if;
 s:=private.bt_snapshot_v1('bitacora_'||p_area,rid);
 permiso:=private.bt_operador_en_turno(t,ahora) and (rid is null or p_area<>'calderas' or (s->'registro'->>'version_formato')::int=2);
 return jsonb_build_object('turno_id',t.id,'reporte_id',rid,'ahora',ahora,'inicio',v.inicio,'fin',v.fin,
  'fecha_operativa',t.fecha_operativa,'turno',t.turno,'puede_editar',permiso,
  'estado',case when ahora>=v.fin then case when private.bt_snapshot_completo(p_area,s) then 'Cerrado completo' else 'Cerrado con pendientes' end
    when rid is not null then 'Enviado' else 'Sin enviar' end);
end;
$f$;

create function public.guardar_reporte_operativo(
 p_id uuid,p_area text,p_turno_id uuid,p_datos jsonb,p_reporte_id uuid default null,p_revision_esperada bigint default null
) returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare cuenta uuid:=auth.uid(); administrador boolean:=coalesce(private.es_admin(),false);
 modulo text:='bitacora_'||p_area; d jsonb; t public.turnos_operativos%rowtype; rid uuid:=coalesce(p_reporte_id,p_id);
 revision_actual bigint; version_actual int; autor uuid; antes jsonb; despues jsonb; nombre text;
 previa public.revisiones_captura%rowtype; recibo private.solicitudes_bitacora_tecnica%rowtype;
 ctx text; fmt text; op text; motivo text:='Corrección del operador durante su turno';
begin
 if cuenta is null or p_area is null or p_area not in ('calderas','ptar')
   or (not administrador and private.rol_actual()::text is distinct from p_area) then
  raise exception using errcode='42501',message='Cuenta no autorizada para el reporte.'; end if;
 if p_id is null or p_turno_id is null or (p_reporte_id is null)<>(p_revision_esperada is null)
  or p_revision_esperada<0 then raise exception using errcode='22023',message='Solicitud de reporte inválida.'; end if;
 if p_area='calderas' then d:=private.btr_normalizar_calderas(p_datos);
 else d:=private.btr_normalizar_ptar(p_datos); end if;
 if not private.bt_completo(p_area,d) then raise exception using errcode='22023',message='Completa todos los campos obligatorios antes de enviar.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('copamex.bt.operacion:'||p_id::text,0));
 -- Confirmar operaciones ya realizadas no autoriza otra escritura fuera del horario.
 if p_reporte_id is null then
  select * into recibo from private.solicitudes_bitacora_tecnica where id=p_id;
  if found then
   if recibo.modulo<>modulo or recibo.turno_id<>p_turno_id or recibo.creado_por<>cuenta or recibo.contenido_inicial<>d then
    raise exception using errcode='23505',message='El identificador corresponde a otra solicitud.'; end if;
   return jsonb_build_object('id',p_id,'confirmado',true,'reintento',true,'snapshot',private.bt_snapshot_v1(modulo,rid));
  end if;
 else
  select * into previa from public.revisiones_captura where id=p_id;
  if found then
   if previa.modulo<>modulo or previa.registro_id<>rid or previa.creado_por<>cuenta or previa.datos_solicitados<>d
     or (previa.antes->'registro'->>'revision')::bigint<>p_revision_esperada
     or (previa.antes->'registro'->>'turno_id')::uuid<>p_turno_id then
    raise exception using errcode='23505',message='El identificador corresponde a otra revisión.'; end if;
   return jsonb_build_object('id',p_id,'confirmado',true,'reintento',true,'snapshot',private.bt_snapshot_v1(modulo,rid));
  end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('copamex.bt.turno:'||modulo||':'||p_turno_id::text,0));
 select * into t from public.turnos_operativos where id=p_turno_id for share;
 if not found or t.area::text<>p_area or (not administrador and not private.bt_operador_en_turno(t,clock_timestamp())) then
  raise exception using errcode='42501',message='El horario de corrección terminó o el turno no corresponde a tu cuenta.'; end if;
 if administrador and (p_reporte_id is not null or clock_timestamp()<(select fin from private.bt_intervalo(t.fecha_operativa,t.turno))) then
  raise exception using errcode='42501',message='Para corregir un reporte existente utiliza la revisión administrativa actual.'; end if;
 if p_reporte_id is null then
  if p_area='calderas' then select revision into revision_actual from public.bitacora_calderas where turno_id=t.id or id=rid;
  else select revision into revision_actual from public.bitacora_ptar where turno_id=t.id or id=rid; end if;
  if found then raise exception using errcode='23505',message='Ya existe un reporte para el turno. Actualiza y utiliza Editar reporte.'; end if;
 else
  if p_area='calderas' then select revision,creado_por,version_formato into revision_actual,autor,version_actual from public.bitacora_calderas where id=rid and turno_id=t.id for update;
  else select revision,creado_por into revision_actual,autor from public.bitacora_ptar where id=rid and turno_id=t.id for update; end if;
  if not found or autor<>cuenta or (p_area='calderas' and version_actual<>2) then raise exception using errcode='42501',message='El reporte no pertenece a este turno y cuenta.'; end if;
  if revision_actual<>p_revision_esperada then raise exception using errcode='40001',message='El reporte cambió. Actualiza antes de corregir.'; end if;
  antes:=private.bt_snapshot_v1(modulo,rid);
 end if;
 ctx:=current_setting('copamex.bt_escritura',true); fmt:=current_setting('copamex.bc_formato',true); op:=current_setting('copamex.bt_operador',true);
 perform set_config('copamex.bt_escritura',modulo||':'||rid::text,true);
 perform set_config('copamex.bc_formato','2',true);
 perform set_config('copamex.bt_operador',modulo||':'||rid::text,true);
 if p_area='calderas' then perform private.btr_escribir_calderas(rid,t.id,d,p_reporte_id is null);
 else perform private.btr_escribir_ptar(modulo,rid,t.id,d,p_reporte_id is null); end if;
 if p_reporte_id is null then
  insert into private.solicitudes_bitacora_tecnica(id,modulo,calderas_id,ptar_id,turno_id,creado_por,recibido_en,contenido_inicial)
   values(rid,modulo,case when p_area='calderas' then rid end,case when p_area='ptar' then rid end,t.id,cuenta,clock_timestamp(),d);
 else
  despues:=private.bt_snapshot_v1(modulo,rid);
  if ((antes->'registro')-'revision')=((despues->'registro')-'revision') and (antes->'equipos') is not distinct from (despues->'equipos') and (antes->'pilas') is not distinct from (despues->'pilas') then
   raise exception using errcode='22023',message='No hay cambios para registrar.'; end if;
  select p.nombre into strict nombre from public.perfiles p where p.id=cuenta and p.activo;
  insert into public.revisiones_captura(id,modulo,registro_id,accion,motivo,creado_por,responsable_nombre,creado_en,antes,despues,datos_solicitados)
   values(p_id,modulo,rid,'corregir',motivo,cuenta,nombre,clock_timestamp(),antes,despues,d);
 end if;
 perform set_config('copamex.bt_escritura',coalesce(ctx,''),true);perform set_config('copamex.bc_formato',coalesce(fmt,''),true);perform set_config('copamex.bt_operador',coalesce(op,''),true);
 return jsonb_build_object('id',p_id,'confirmado',true,'reintento',false,'snapshot',private.bt_snapshot_v1(modulo,rid));
end;
$f$;

-- También protege las RPC anteriores; no se conceden escrituras directas.
create function private.bt_bloquear_fuera_horario() returns trigger
language plpgsql security invoker set search_path='' as $f$
declare t public.turnos_operativos%rowtype;
begin
 if coalesce(private.es_admin(),false) then return new; end if;
 select * into t from public.turnos_operativos where id=new.turno_id;
 if not found or not private.bt_operador_en_turno(t,clock_timestamp()) then
  raise exception using errcode='42501',message='El horario del reporte terminó. Solo supervisión puede corregirlo.'; end if;
 return new;
end;
$f$;
create trigger horario_reporte before insert or update on public.bitacora_calderas for each row execute function private.bt_bloquear_fuera_horario();
create trigger horario_reporte before insert or update on public.bitacora_ptar for each row execute function private.bt_bloquear_fuera_horario();


-- Conserva identidades, formato y revisión de la protección original.
create or replace function private.bt_proteger_v1() returns trigger
language plpgsql set search_path='' as $f$
declare modulo text:=tg_argv[0]; reporte uuid; t public.turnos_operativos%rowtype;
begin
  if tg_op in('DELETE','TRUNCATE') then raise exception using errcode='42501',message='Los reportes técnicos no se borran físicamente.'; end if;
  if tg_argv[1]='cabecera' then reporte:=new.id; else reporte:=new.reporte_id; end if;
  if current_user<>'postgres' or auth.uid() is null
    or current_setting('copamex.bt_escritura',true) is distinct from modulo||':'||reporte::text then
    raise exception using errcode='42501',message='La escritura técnica requiere la operación controlada.';
  end if;
  if tg_op='UPDATE' then
    if not coalesce(private.es_admin(),false) and not private.bt_operador_reporte(modulo,reporte) then raise exception using errcode='42501',message='Solo Administración puede corregir reportes técnicos.'; end if;
    if tg_argv[1]='cabecera' then
      if row(new.id,new.turno_id,new.creado_por,new.creado_en,new.version_formato)
        is distinct from row(old.id,old.turno_id,old.creado_por,old.creado_en,old.version_formato) then
        raise exception using errcode='42501',message='La identidad y los datos originales del turno se conservan.';
      end if;
      new.revision:=old.revision+1;
    else
      if new.id is distinct from old.id or new.reporte_id is distinct from old.reporte_id
        or (to_jsonb(new)->tg_argv[1]) is distinct from (to_jsonb(old)->tg_argv[1]) then
        raise exception using errcode='42501',message='La identidad del equipo o pila se conserva.';
      end if;
    end if;
  elsif tg_argv[1]='cabecera' then
    select * into t from public.turnos_operativos where id=new.turno_id for share;
    if not found or t.area::text is distinct from (case modulo when 'bitacora_calderas' then 'calderas' else 'ptar' end)
      or (not coalesce(private.es_admin(),false) and not private.bt_operador_en_turno(t,clock_timestamp())) then
      raise exception using errcode='42501',message='El reporte requiere tu turno activo en el área correspondiente.';
    end if;
    new.creado_por:=auth.uid(); new.creado_en:=clock_timestamp(); new.version_formato:=1; new.revision:=0;
  else
    if private.rol_actual()::text is distinct from 'calderas' and not coalesce(private.es_admin(),false) then raise exception using errcode='42501',message='La creación de equipos requiere Calderas.'; end if;
  end if;
  return new;
end;
$f$;

-- Conserva identidades, formato y revisión de la protección original.
create or replace function private.bc_proteger_v2() returns trigger
language plpgsql set search_path='' as $f$
declare formato integer; modulo text:=tg_argv[0]; reporte uuid; t public.turnos_operativos%rowtype;
begin
  if tg_op in('DELETE','TRUNCATE') then raise exception using errcode='42501',message='Los reportes técnicos no se borran físicamente.'; end if;
  if tg_argv[1]='cabecera' then reporte:=new.id; else reporte:=new.reporte_id; end if;
  if current_user<>'postgres' or auth.uid() is null
    or current_setting('copamex.bt_escritura',true) is distinct from modulo||':'||reporte::text then
    raise exception using errcode='42501',message='La escritura técnica requiere la operación controlada.';
  end if;
  if tg_argv[1]='cabecera' then
    if tg_op='UPDATE' and new.presion_condensado_unidad is distinct from old.presion_condensado_unidad then raise exception using errcode='42501',message='La unidad original del reporte se conserva.';end if;
    if tg_op='UPDATE' then formato:=old.version_formato;else formato:=case when current_setting('copamex.bc_formato',true)='2' then 2 else 1 end;end if;
  else
    select version_formato into formato from public.bitacora_calderas where id=new.reporte_id for share;
    if not found then raise exception using errcode='22023',message='Reporte padre inexistente';end if;
    if tg_argv[1]='equipo' then if new.equipo like 'sulzer_%' and new.presion_unidad is distinct from (case when formato=2 then 'kg/cm²' else 'PSI' end) then
      raise exception using errcode='22023',message='La unidad Sulzer debe corresponder a la version del reporte.';end if;end if;
  end if;
  if formato=2 and current_setting('copamex.bc_formato',true) is distinct from '2' then raise exception using errcode='42501',message='El formato 2 requiere la RPC versionada; no usar la correccion anterior.';end if;
  if tg_op='UPDATE' then
    if not coalesce(private.es_admin(),false) and not private.bt_operador_reporte(modulo,reporte) then raise exception using errcode='42501',message='Solo Administración puede corregir reportes técnicos.'; end if;
    if tg_argv[1]='cabecera' then
      if row(new.id,new.turno_id,new.creado_por,new.creado_en,new.version_formato)
        is distinct from row(old.id,old.turno_id,old.creado_por,old.creado_en,old.version_formato) then
        raise exception using errcode='42501',message='La identidad y los datos originales del turno se conservan.';
      end if;
      new.revision:=old.revision+1;
    else
      if new.id is distinct from old.id or new.reporte_id is distinct from old.reporte_id
        or (to_jsonb(new)->tg_argv[1]) is distinct from (to_jsonb(old)->tg_argv[1]) then
        raise exception using errcode='42501',message='La identidad del equipo o pila se conserva.';
      end if;
    end if;
  elsif tg_argv[1]='cabecera' then
    select * into t from public.turnos_operativos where id=new.turno_id for share;
    if not found or t.area::text is distinct from (case modulo when 'bitacora_calderas' then 'calderas' else 'ptar' end)
      or (not coalesce(private.es_admin(),false) and not private.bt_operador_en_turno(t,clock_timestamp())) then
      raise exception using errcode='42501',message='El reporte requiere tu turno activo en el área correspondiente.';
    end if;
    new.creado_por:=auth.uid(); new.creado_en:=clock_timestamp(); new.version_formato:=formato; new.revision:=0;
  else
    if private.rol_actual()::text is distinct from 'calderas' and not coalesce(private.es_admin(),false) then raise exception using errcode='42501',message='La creación de equipos requiere Calderas.'; end if;
  end if;
  return new;
end;
$f$;

create or replace function public.iniciar_turno_pareja_empleado(
  p_id uuid,
  p_turno public.turno_tipo,
  p_numero_empleado text,
  p_operador uuid,
  p_nombre_operador text,
  p_numero_empleado_acompanante text,
  p_operador_acompanante uuid,
  p_nombre_operador_acompanante text,
  p_turno_anterior uuid default null
)
returns setof public.turnos_operativos
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  cuenta uuid := auth.uid();
  rol public.rol_usuario := private.rol_actual();
  area_cuenta public.area_planta;
  nombre_limpio text := private.nombre_operador_normalizado(p_nombre_operador);
  nombre_acompanante_limpio text := private.nombre_operador_normalizado(p_nombre_operador_acompanante);
  existente public.turnos_operativos%rowtype;
  anterior public.turnos_operativos%rowtype;
  hay_anterior boolean;
  operador_nuevo uuid;
  operador_acompanante_nuevo uuid;
  hora_cambio timestamptz := statement_timestamp();
  fecha_nueva date := (hora_cambio at time zone 'America/Mexico_City')::date;
begin
  if cuenta is null or not coalesce(rol in ('calderas', 'ptar'), false) then
    raise exception using errcode = '42501', message = 'Solo una cuenta de área activa puede iniciar o cambiar de turno.';
  end if;
  if p_id is null or p_turno is null or p_operador is null or p_operador_acompanante is null
    or nullif(btrim(p_numero_empleado), '') is null
    or nullif(btrim(p_numero_empleado_acompanante), '') is null
    or nombre_limpio is null or nombre_limpio = ''
    or nombre_acompanante_limpio is null or nombre_acompanante_limpio = ''
    or upper(btrim(p_numero_empleado)) = upper(btrim(p_numero_empleado_acompanante))
    or p_operador = p_operador_acompanante
  then
    raise exception using errcode = '22023', message = 'Identifica dos operadores activos distintos con sus números de empleado.';
  end if;
  area_cuenta := rol::text::public.area_planta;
  perform pg_advisory_xact_lock(hashtextextended('copamex:turno:' || area_cuenta::text, 0));

  select t.* into existente from public.turnos_operativos t where t.id = p_id;
  if found then
    if existente.iniciado_por is distinct from cuenta
      or existente.area is distinct from area_cuenta
      or existente.turno is distinct from p_turno
      or existente.operador_id is distinct from p_operador
      or existente.operador_acompanante_id is distinct from p_operador_acompanante
    then
      raise exception using errcode = '22023', message = 'Ese identificador ya corresponde a otro turno o a otros datos. Recarga la información.';
    end if;
    return query select t.* from public.turnos_operativos t where t.id = p_id;
    return;
  end if;

  -- Solo nuevas altas: no se reclasifican turnos históricos ni reintentos confirmados.
  fecha_nueva := (hora_cambio at time zone 'America/Mexico_City')::date
    - case when (hora_cambio at time zone 'America/Mexico_City')::time < time '07:01' then 1 else 0 end;
  if p_turno is distinct from (case
    when (hora_cambio at time zone 'America/Mexico_City')::time >= time '07:01'
      and (hora_cambio at time zone 'America/Mexico_City')::time < time '15:01' then 'dia'::public.turno_tipo
    when (hora_cambio at time zone 'America/Mexico_City')::time >= time '15:01'
      and (hora_cambio at time zone 'America/Mexico_City')::time < time '21:01' then 'tarde'::public.turno_tipo
    else 'noche'::public.turno_tipo end) then
    raise exception using errcode='22023',message='Selecciona el turno que corresponde al horario actual del servidor.';
  end if;
  operador_nuevo := private.operador_activo_por_empleado(p_numero_empleado, p_operador, nombre_limpio);
  operador_acompanante_nuevo := private.operador_activo_por_empleado(
    p_numero_empleado_acompanante, p_operador_acompanante, nombre_acompanante_limpio
  );
  if operador_nuevo = operador_acompanante_nuevo then
    raise exception using errcode = '22023', message = 'Selecciona dos operadores distintos.';
  end if;

  if exists (
    select 1 from public.turnos_operativos t
    where t.area = area_cuenta and t.fecha_operativa = fecha_nueva and t.turno = p_turno
  ) then
    raise exception using errcode = '23505', message = 'Ya existe ese tipo de turno para la fecha de hoy y esta área. Revisa el tipo de turno seleccionado.';
  end if;

  select t.* into anterior from public.turnos_operativos t
  where t.area = area_cuenta and t.finalizado_en is null for update;
  hay_anterior := found;
  if hay_anterior then
    if p_turno_anterior is distinct from anterior.id then
      raise exception using errcode = '22023', message = 'Hay un turno abierto. Recarga y utiliza Cambiar de turno para cerrarlo e iniciar el siguiente.';
    end if;
    if anterior.iniciado_por is distinct from cuenta then
      raise exception using errcode = '42501', message = 'Ese turno pertenece a otra cuenta del área. Pide al administrador que lo cierre.';
    end if;
  elsif p_turno_anterior is not null then
    raise exception using errcode = '22023', message = 'El turno anterior ya cambió o fue cerrado. Recarga antes de continuar.';
  end if;

  if hay_anterior then
    update public.turnos_operativos set finalizado_en = hora_cambio
    where id = anterior.id and iniciado_por = cuenta and finalizado_en is null;
    if not found then raise exception using errcode = '42501', message = 'No se pudo cerrar el turno anterior.'; end if;
  end if;

  insert into public.turnos_operativos (
    id, fecha_operativa, area, turno, operador_id, operador_acompanante_id, iniciado_por, iniciado_en
  ) values (
    p_id, fecha_nueva, area_cuenta, p_turno, operador_nuevo, operador_acompanante_nuevo, cuenta, hora_cambio
  );
  return query select t.* from public.turnos_operativos t where t.id = p_id;
end;
$function$;

create function public.consultar_pendientes_tecnicos(p_desde date,p_hasta date,p_area text default 'todas',p_limite int default 25,p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare salida jsonb;
begin
 if auth.uid() is null or not coalesce(private.es_admin(),false) then raise exception using errcode='42501',message='Solo supervisión puede consultar pendientes técnicos.'; end if;
 if p_desde is null or p_hasta is null or p_hasta<p_desde or p_hasta-p_desde>366 or p_area is null or p_area not in ('todas','calderas','ptar') or p_limite is null or p_limite not between 1 and 100 or p_offset is null or p_offset<0 then raise exception using errcode='22023',message='Filtros de pendientes inválidos.'; end if;
 with pendientes as (
  select t.id turno_id,t.area,t.turno,t.fecha_operativa,coalesce(c.id,p.id) reporte_id,coalesce(c.revision,p.revision) revision,
   coalesce(c.creado_en,p.creado_en) creado_en,o.nombre operador,oa.nombre operador_acompanante
  from public.turnos_operativos t
  cross join lateral private.bt_intervalo(t.fecha_operativa,t.turno) v
  join public.operadores o on o.id=t.operador_id
  left join public.operadores oa on oa.id=t.operador_acompanante_id
  left join public.bitacora_calderas c on c.turno_id=t.id and t.area::text='calderas'
  left join public.bitacora_ptar p on p.turno_id=t.id and t.area::text='ptar'
  where t.area::text in ('calderas','ptar') and t.fecha_operativa between p_desde and p_hasta and (p_area='todas' or t.area::text=p_area)
   and statement_timestamp()>=v.fin
   and not private.bt_snapshot_completo(t.area::text,private.bt_snapshot_v1('bitacora_'||t.area::text,coalesce(c.id,p.id)))
  order by t.fecha_operativa desc,t.id desc limit p_limite+1 offset p_offset
 ), numeradas as(select *,row_number() over(order by fecha_operativa desc,turno_id desc) n from pendientes)
 select jsonb_build_object('filas',coalesce(jsonb_agg(to_jsonb(numeradas)-'n' order by n) filter(where n<=p_limite),'[]'::jsonb),'mas',count(*)>p_limite) into salida from numeradas;
 return salida;
end;
$f$;

-- Validación diferida: también impide enviar incompletos mediante RPC técnicas anteriores.
-- Se ejecuta cuando los hijos ya están escritos y revierte toda la operación si falta un dato.
create function private.bt_validar_envio_completo() returns trigger
language plpgsql security definer set search_path='' as $f$
declare t public.turnos_operativos%rowtype; area text:=case tg_table_name when 'bitacora_calderas' then 'calderas' else 'ptar' end;
begin
 if coalesce(private.es_admin(),false) then return null; end if;
 select * into t from public.turnos_operativos where id=new.turno_id;
 if not private.bt_operador_en_turno(t,clock_timestamp()) then
  raise exception using errcode='42501',message='El horario del reporte terminó antes de confirmar el envío.'; end if;
 if not private.bt_snapshot_completo(area,private.bt_snapshot_v1('bitacora_'||area,new.id)) then
  raise exception using errcode='22023',message='Completa todos los campos obligatorios antes de enviar.'; end if;
 return null;
end;
$f$;
alter function private.bt_validar_envio_completo() owner to postgres;
revoke all on function private.bt_validar_envio_completo() from public,anon,authenticated,service_role;
create constraint trigger validar_envio_completo after insert or update on public.bitacora_calderas
 deferrable initially deferred for each row execute function private.bt_validar_envio_completo();
create constraint trigger validar_envio_completo after insert or update on public.bitacora_ptar
 deferrable initially deferred for each row execute function private.bt_validar_envio_completo();

-- Mismo trigger de inicio existente: corrige únicamente las altas nocturnas tras medianoche.
create function private.bt_fecha_turno(p_hora timestamptz) returns date
language sql stable set search_path='' as $f$
 select (p_hora at time zone 'America/Mexico_City')::date
   - case when (p_hora at time zone 'America/Mexico_City')::time<time '07:01' then 1 else 0 end
$f$;
alter function private.bt_fecha_turno(timestamptz) owner to postgres;
revoke all on function private.bt_fecha_turno(timestamptz) from public,anon,authenticated,service_role;
grant execute on function private.bt_fecha_turno(timestamptz) to authenticated;

create or replace function private.asignar_inicio_turno() returns trigger
language plpgsql security invoker set search_path='' as $f$
begin
 new.iniciado_en:=statement_timestamp();
 new.fecha_operativa:=private.bt_fecha_turno(new.iniciado_en);
 if not coalesce(private.es_admin(),false)
  and not exists(select 1 from private.bt_intervalo(new.fecha_operativa,new.turno) v
    where new.iniciado_en>=v.inicio and new.iniciado_en<v.fin) then
  raise exception using errcode='22023',message='Selecciona el turno que corresponde al horario actual del servidor.';
 end if;
 return new;
end;
$f$;



-- ACL explícitas solo de funciones nuevas. No cambia RLS ni permisos de otros módulos.
do $acl$ declare firma text; begin
 foreach firma in array array[
 'private.bt_intervalo(date,public.turno_tipo)','private.bt_operador_en_turno(public.turnos_operativos,timestamptz)',
 'private.bt_operador_reporte(text,uuid)','private.bt_completo(text,jsonb)','private.bt_snapshot_completo(text,jsonb)',
 'private.bt_bloquear_fuera_horario()'
 ] loop execute 'alter function '||firma||' owner to postgres';execute 'revoke all on function '||firma||' from public,anon,authenticated,service_role';end loop;
 foreach firma in array array[
 'public.consultar_contexto_reporte_operativo(text,uuid)',
 'public.guardar_reporte_operativo(uuid,text,uuid,jsonb,uuid,bigint)',
 'public.consultar_pendientes_tecnicos(date,date,text,integer,integer)'
 ] loop execute 'alter function '||firma||' owner to postgres';execute 'revoke all on function '||firma||' from public,anon,authenticated,service_role';execute 'grant execute on function '||firma||' to authenticated';end loop;
end; $acl$;
grant execute on function private.bt_intervalo(date,public.turno_tipo) to authenticated;
notify pgrst,'reload schema';
commit;
