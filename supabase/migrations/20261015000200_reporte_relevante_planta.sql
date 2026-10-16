-- COPAMEX: reporte relevante obligatorio y consulta compartida de bitácoras técnicas.
-- SOLO ARCHIVO LOCAL PARA REVISIÓN. No ejecutar pruebas ni fixtures en el original.
-- Requiere las dos migraciones técnicas anteriores. No modifica sus archivos.
-- Históricos: columna nueva NULL, sin reescribir valores ni observaciones.
-- RPC anteriores conservadas para reintentos idénticos; nuevos INSERT exigen reporte.
-- La consulta compartida usa RPC de solo lectura; las políticas RLS propias no se amplían.
begin;
set local lock_timeout='10s';
set local statement_timeout='120s';
do $pre$ begin
 if current_user<>'postgres' then raise exception 'Ejecutar como postgres'; end if;
 if to_regprocedure('private.bc_guardar_v2(uuid,uuid,jsonb)') is null
 or to_regprocedure('private.bt_guardar_v1(text,uuid,uuid,jsonb)') is null then raise exception 'Faltan las migraciones técnicas anteriores'; end if;
end $pre$;
alter table public.bitacora_calderas add column reporte_relevante text
 constraint bc_reporte_relevante_check check(reporte_relevante is null or length(regexp_replace(reporte_relevante,'^[[:space:]]+|[[:space:]]+$','','g')) between 1 and 4000);
alter table public.bitacora_ptar add column reporte_relevante text
 constraint bp_reporte_relevante_check check(reporte_relevante is null or length(regexp_replace(reporte_relevante,'^[[:space:]]+|[[:space:]]+$','','g')) between 1 and 4000);
comment on column public.bitacora_calderas.reporte_relevante is 'Obligatorio en nuevos reportes; NULL conserva ausencia en históricos. Corrección administrativa auditada.';
comment on column public.bitacora_ptar.reporte_relevante is 'Obligatorio en nuevos reportes; independiente del comentario de prensas y de las observaciones antiguas.';
create function private.btr_exigir_reporte() returns trigger
language plpgsql set search_path='' as $f$
begin
 if tg_op='INSERT' or old.reporte_relevante is not null then
  if private.bt_texto_v1(to_jsonb(new.reporte_relevante)) is null then
   raise exception using errcode='22023',message='Escribe el reporte relevante del turno antes de guardar.';
  end if;
 end if;
 return new;
end;
$f$;
create trigger exigir_reporte_relevante before insert or update on public.bitacora_calderas for each row execute function private.btr_exigir_reporte();
create trigger exigir_reporte_relevante before insert or update on public.bitacora_ptar for each row execute function private.btr_exigir_reporte();


create function private.btr_normalizar_calderas(p_datos jsonb) returns jsonb
language plpgsql immutable set search_path='' as $f$
declare relevante text;
begin
 relevante:=private.bt_texto_v1(p_datos->'reporteRelevante');
 if relevante is null or length(relevante)>4000 then raise exception using errcode='22023',message='Escribe el reporte relevante del turno (hasta 4000 caracteres).'; end if;
 return private.bc_normalizar_v2(p_datos-'reporteRelevante')||jsonb_build_object('reporteRelevante',relevante);
end;
$f$;

create function private.btr_escribir_calderas(p_id uuid,p_turno uuid,p_datos jsonb,p_crear boolean) returns void
language plpgsql set search_path='' as $f$
declare c public.bitacora_calderas%rowtype; k text; e jsonb; v_estado text; v_presion numeric; v_unidad text;
begin
    c:=jsonb_populate_record(null::public.bitacora_calderas,p_datos->'mediciones');
    if p_crear then
      insert into public.bitacora_calderas(id,turno_id,creado_por,creado_en,reporte_relevante,nivel_condensado,presion_432,presion_433,presion_422,presion_424,flujo_osmosis,flujo_uf,nivel_rotoplas,presion_aire,nivel_agua_potable,estado_uf,comentarios_uf,presion_condensado_unidad,bomba_norte_servicio,bomba_sur_servicio,pozo_1_servicio,pozo_2_servicio)
      values(p_id,p_turno,auth.uid(),clock_timestamp(),p_datos->>'reporteRelevante',c.nivel_condensado,c.presion_432,c.presion_433,c.presion_422,c.presion_424,c.flujo_osmosis,c.flujo_uf,c.nivel_rotoplas,c.presion_aire,c.nivel_agua_potable,p_datos->>'estadoUF',p_datos->>'comentariosUF','kg/cm²',(p_datos->'servicioAgua'->>'norte')::boolean,(p_datos->'servicioAgua'->>'sur')::boolean,(p_datos->'servicioAgua'->>'pozo1')::boolean,(p_datos->'servicioAgua'->>'pozo2')::boolean);
    end if;
    foreach k in array array['caldera_2','caldera_3','caldera_5','caldera_6','sulzer_436','sulzer_456','sulzer_469','sulzer_470','compresor_1','compresor_2','compresor_3','compresor_4']::text[] loop
      if k like 'compresor_%' then v_estado:=p_datos->'compresores'->>right(k,1);v_presion:=null;v_unidad:=null;
      else e:=p_datos->'equipos'->k;v_estado:=e->>'estado';v_presion:=(e->>'presion')::numeric;v_unidad:=case when k like 'sulzer_%' then 'kg/cm²' else null end; end if;
      if p_crear then insert into public.bitacora_calderas_equipos(reporte_id,equipo,estado,presion,presion_unidad) values(p_id,k,v_estado,v_presion,v_unidad);
      else update public.bitacora_calderas_equipos set estado=v_estado,presion=v_presion,presion_unidad=v_unidad where reporte_id=p_id and equipo=k;
        if not found then raise exception using errcode='22023',message='Falta un equipo estructural del reporte.'; end if;
      end if;
    end loop;
    foreach k in array array['pila_1_3','pila_2','pila_calderas','pila_4']::text[] loop
      e:=p_datos->'pilas'->k;
      if p_crear then insert into public.bitacora_calderas_pilas(reporte_id,pila,nivel,bomba,presion) values(p_id,k,(e->>'nivel')::numeric,e->>'bomba',(e->>'presion')::numeric);
      else update public.bitacora_calderas_pilas set nivel=(e->>'nivel')::numeric,bomba=e->>'bomba',presion=(e->>'presion')::numeric where reporte_id=p_id and pila=k;
        if not found then raise exception using errcode='22023',message='Falta una pila estructural del reporte.'; end if;
      end if;
    end loop;
    if not p_crear then
      update public.bitacora_calderas set reporte_relevante=p_datos->>'reporteRelevante',nivel_condensado=c.nivel_condensado,presion_432=c.presion_432,presion_433=c.presion_433,presion_422=c.presion_422,presion_424=c.presion_424,flujo_osmosis=c.flujo_osmosis,flujo_uf=c.flujo_uf,nivel_rotoplas=c.nivel_rotoplas,presion_aire=c.presion_aire,nivel_agua_potable=c.nivel_agua_potable,estado_uf=p_datos->>'estadoUF',comentarios_uf=p_datos->>'comentariosUF',bomba_norte_servicio=(p_datos->'servicioAgua'->>'norte')::boolean,bomba_sur_servicio=(p_datos->'servicioAgua'->>'sur')::boolean,pozo_1_servicio=(p_datos->'servicioAgua'->>'pozo1')::boolean,pozo_2_servicio=(p_datos->'servicioAgua'->>'pozo2')::boolean where id=p_id;
      if not found then raise exception using errcode='22023',message='Reporte no encontrado.'; end if;
    end if;
end;
$f$;

create function private.btr_guardar_calderas(p_id uuid,p_turno_id uuid,p_datos jsonb) returns jsonb
language plpgsql set search_path='' as $f$
declare p_modulo constant text:='bitacora_calderas'; formato_anterior text; cuenta uuid:=auth.uid(); area text; d jsonb; t public.turnos_operativos%rowtype;
  recibo private.solicitudes_bitacora_tecnica%rowtype; anterior text; existente uuid;
begin
  area:=case p_modulo when 'bitacora_calderas' then 'calderas' when 'bitacora_ptar' then 'ptar' end;
  if cuenta is null or area is null or private.rol_actual()::text is distinct from area then
    raise exception using errcode='42501',message='Se requiere una cuenta activa del área del reporte.';
  end if;
  if p_id is null or p_turno_id is null then raise exception using errcode='22023',message='Se requiere identificador estable y turno.'; end if;
  d:=private.btr_normalizar_calderas(p_datos);
  perform pg_advisory_xact_lock(hashtextextended('copamex.bt.operacion:'||p_id::text,0));
  select * into recibo from private.solicitudes_bitacora_tecnica where id=p_id;
  if found then
    if recibo.modulo is distinct from p_modulo or recibo.turno_id is distinct from p_turno_id
      or recibo.creado_por is distinct from cuenta or recibo.contenido_inicial is distinct from d then
      raise exception using errcode='23505',message='El identificador ya pertenece a otra solicitud; no se sobrescribió el reporte.';
    end if;
    return jsonb_build_object('id',p_id,'reintento',true,'confirmado',true,'snapshot',private.bt_snapshot_v1(p_modulo,p_id));
  end if;
  perform pg_advisory_xact_lock(hashtextextended('copamex.bt.turno:'||p_modulo||':'||p_turno_id::text,0));
  select * into t from public.turnos_operativos where id=p_turno_id for share;
  if not found or t.area::text is distinct from area or t.iniciado_por is distinct from cuenta or t.finalizado_en is not null then
    raise exception using errcode='42501',message='El reporte requiere tu turno activo del área autorizada.';
  end if;
  if p_modulo='bitacora_calderas' then select id into existente from public.bitacora_calderas where turno_id=p_turno_id or id=p_id;
  else select id into existente from public.bitacora_ptar where turno_id=p_turno_id or id=p_id; end if;
  if found then raise exception using errcode='23505',message='Ya existe un reporte técnico para ese turno o identificador. Consulta el registro; solo Administración puede corregirlo.'; end if;
  formato_anterior:=current_setting('copamex.bc_formato',true);
  perform set_config('copamex.bc_formato','2',true);
  anterior:=current_setting('copamex.bt_escritura',true);
  perform set_config('copamex.bt_escritura',p_modulo||':'||p_id::text,true);
  perform private.btr_escribir_calderas(p_id,p_turno_id,d,true);
  insert into private.solicitudes_bitacora_tecnica(id,modulo,calderas_id,ptar_id,turno_id,creado_por,recibido_en,contenido_inicial)
    values(p_id,p_modulo,case when p_modulo='bitacora_calderas' then p_id end,case when p_modulo='bitacora_ptar' then p_id end,p_turno_id,cuenta,clock_timestamp(),d);
  perform set_config('copamex.bt_escritura',coalesce(anterior,''),true);
  perform set_config('copamex.bc_formato',coalesce(formato_anterior,''),true);
  return jsonb_build_object('id',p_id,'reintento',false,'confirmado',true,'snapshot',private.bt_snapshot_v1(p_modulo,p_id));
end;
$f$;

create function public.guardar_bitacora_tecnica_calderas_v3(p_id uuid,p_turno_id uuid,p_datos jsonb) returns jsonb
language sql volatile security definer set search_path='' as $f$
 select private.btr_guardar_calderas(p_id,p_turno_id,p_datos);
$f$;

create function public.corregir_bitacora_calderas_admin_v3(
  p_id uuid,p_reporte_id uuid,p_revision_esperada bigint,p_datos jsonb,p_motivo text
) returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare p_modulo constant text:='bitacora_calderas'; formato integer; formato_anterior text; cuenta uuid:=auth.uid(); d jsonb; antes jsonb; despues jsonb; nombre text; motivo text;
  previa public.revisiones_captura%rowtype; revision_actual bigint; turno_id uuid; contexto text;
begin
  if cuenta is null or not coalesce(private.es_admin(),false) then raise exception using errcode='42501',message='Solo un administrador activo puede corregir reportes técnicos.'; end if;
  motivo:=nullif(regexp_replace(p_motivo,'^[[:space:]]+|[[:space:]]+$','','g'),'');
  if p_id is null or p_reporte_id is null or p_revision_esperada is null or p_revision_esperada<0
    or p_modulo is null or p_modulo not in('bitacora_calderas','bitacora_ptar')
    or motivo is null or length(motivo)>4000 then raise exception using errcode='22023',message='Indica reporte, revisión y motivo obligatorio (hasta 4000 caracteres).'; end if;
  d:=private.btr_normalizar_calderas(p_datos);
  -- Corrección completa y normalizada: evita borrar campos por omisiones accidentales.
  if p_datos is distinct from d then raise exception using errcode='22023',message='La corrección requiere todos los campos del formato normalizado; los opcionales pueden ser NULL.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('copamex.bt.operacion:'||p_id::text,0));
  if p_modulo='bitacora_calderas' then select r.revision,r.turno_id,r.version_formato into revision_actual,turno_id,formato from public.bitacora_calderas r where r.id=p_reporte_id for update;
  else select r.revision,r.turno_id into revision_actual,turno_id from public.bitacora_ptar r where r.id=p_reporte_id for update; end if;
  if not found then raise exception using errcode='22023',message='Reporte técnico no encontrado.'; end if;
  if formato<>2 then raise exception using errcode='22023',message='Este reporte conserva formato 1; usa su correccion original sin reinterpretar unidades.';end if;
  select * into previa from public.revisiones_captura where id=p_id;
  if found then
    if previa.modulo=p_modulo and previa.registro_id=p_reporte_id and previa.accion='corregir'
      and previa.creado_por=cuenta and previa.motivo=motivo and previa.datos_solicitados=d
      and (previa.antes->'registro'->>'revision')::bigint=p_revision_esperada then
      return jsonb_build_object('id',p_id,'reintento',true,'confirmado',true,'snapshot',private.bt_snapshot_v1(p_modulo,p_reporte_id));
    end if;
    raise exception using errcode='23505',message='El identificador corresponde a otra revisión.';
  end if;
  if revision_actual<>p_revision_esperada then raise exception using errcode='40001',message='El reporte cambió. Actualiza y revisa antes de corregir.'; end if;
  antes:=private.bt_snapshot_v1(p_modulo,p_reporte_id);
  formato_anterior:=current_setting('copamex.bc_formato',true);
  perform set_config('copamex.bc_formato','2',true);
  contexto:=current_setting('copamex.bt_escritura',true);
  perform set_config('copamex.bt_escritura',p_modulo||':'||p_reporte_id::text,true);
  perform private.btr_escribir_calderas(p_reporte_id,turno_id,d,false);
  perform set_config('copamex.bt_escritura',coalesce(contexto,''),true);
  perform set_config('copamex.bc_formato',coalesce(formato_anterior,''),true);
  despues:=private.bt_snapshot_v1(p_modulo,p_reporte_id);
  if ((antes->'registro')-'revision')=((despues->'registro')-'revision')
    and (antes->'equipos')=(despues->'equipos') and (antes->'pilas')=(despues->'pilas') then
    raise exception using errcode='22023',message='No hay cambios técnicos para registrar.';
  end if;
  select p.nombre into strict nombre from public.perfiles p where p.id=cuenta and p.activo;
  insert into public.revisiones_captura(id,modulo,registro_id,accion,motivo,creado_por,responsable_nombre,creado_en,antes,despues,datos_solicitados)
    values(p_id,p_modulo,p_reporte_id,'corregir',motivo,cuenta,nombre,clock_timestamp(),antes,despues,d);
  return jsonb_build_object('id',p_id,'reintento',false,'confirmado',true,'snapshot',despues);
end;
$f$;

create function private.btr_normalizar_ptar(p_datos jsonb) returns jsonb
language plpgsql immutable set search_path='' as $f$
declare relevante text;
begin
 relevante:=private.bt_texto_v1(p_datos->'reporteRelevante');
 if relevante is null or length(relevante)>4000 then raise exception using errcode='22023',message='Escribe el reporte relevante del turno (hasta 4000 caracteres).'; end if;
 return private.bt_normalizar_v1('bitacora_ptar',p_datos-'reporteRelevante')||jsonb_build_object('reporteRelevante',relevante);
end;
$f$;

create function private.btr_escribir_ptar(p_modulo text,p_id uuid,p_turno uuid,p_datos jsonb,p_crear boolean) returns void
language plpgsql set search_path='' as $f$
declare c public.bitacora_calderas%rowtype; t public.bitacora_ptar%rowtype;
  k text; e jsonb; v_estado text; v_presion numeric; v_unidad text;
begin
  if p_modulo='bitacora_calderas' then
    c:=jsonb_populate_record(null::public.bitacora_calderas,p_datos->'mediciones');
    if p_crear then
      insert into public.bitacora_calderas(id,turno_id,creado_por,creado_en,reporte_relevante,nivel_condensado,presion_432,presion_433,presion_422,presion_424,flujo_osmosis,flujo_uf,nivel_rotoplas,presion_aire,nivel_agua_potable,estado_uf,comentarios_uf)
      values(p_id,p_turno,auth.uid(),clock_timestamp(),p_datos->>'reporteRelevante',c.nivel_condensado,c.presion_432,c.presion_433,c.presion_422,c.presion_424,c.flujo_osmosis,c.flujo_uf,c.nivel_rotoplas,c.presion_aire,c.nivel_agua_potable,p_datos->>'estadoUF',p_datos->>'comentariosUF');
    end if;
    foreach k in array array['caldera_2','caldera_3','caldera_5','caldera_6','sulzer_436','sulzer_456','sulzer_469','sulzer_470','compresor_1','compresor_2','compresor_3','compresor_4']::text[] loop
      if k like 'compresor_%' then v_estado:=p_datos->'compresores'->>right(k,1);v_presion:=null;v_unidad:=null;
      else e:=p_datos->'equipos'->k;v_estado:=e->>'estado';v_presion:=(e->>'presion')::numeric;v_unidad:=case when k like 'sulzer_%' then 'PSI' else null end; end if;
      if p_crear then insert into public.bitacora_calderas_equipos(reporte_id,equipo,estado,presion,presion_unidad) values(p_id,k,v_estado,v_presion,v_unidad);
      else update public.bitacora_calderas_equipos set estado=v_estado,presion=v_presion,presion_unidad=v_unidad where reporte_id=p_id and equipo=k;
        if not found then raise exception using errcode='22023',message='Falta un equipo estructural del reporte.'; end if;
      end if;
    end loop;
    foreach k in array array['pila_1_3','pila_2','pila_calderas','pila_4']::text[] loop
      e:=p_datos->'pilas'->k;
      if p_crear then insert into public.bitacora_calderas_pilas(reporte_id,pila,nivel,bomba,presion) values(p_id,k,(e->>'nivel')::numeric,e->>'bomba',(e->>'presion')::numeric);
      else update public.bitacora_calderas_pilas set nivel=(e->>'nivel')::numeric,bomba=e->>'bomba',presion=(e->>'presion')::numeric where reporte_id=p_id and pila=k;
        if not found then raise exception using errcode='22023',message='Falta una pila estructural del reporte.'; end if;
      end if;
    end loop;
    if not p_crear then
      update public.bitacora_calderas set reporte_relevante=p_datos->>'reporteRelevante',nivel_condensado=c.nivel_condensado,presion_432=c.presion_432,presion_433=c.presion_433,presion_422=c.presion_422,presion_424=c.presion_424,flujo_osmosis=c.flujo_osmosis,flujo_uf=c.flujo_uf,nivel_rotoplas=c.nivel_rotoplas,presion_aire=c.presion_aire,nivel_agua_potable=c.nivel_agua_potable,estado_uf=p_datos->>'estadoUF',comentarios_uf=p_datos->>'comentariosUF' where id=p_id;
      if not found then raise exception using errcode='22023',message='Reporte no encontrado.'; end if;
    end if;
  elsif p_modulo='bitacora_ptar' then
    t:=jsonb_populate_record(null::public.bitacora_ptar,p_datos->'mediciones');
    if p_crear then
      insert into public.bitacora_ptar(id,turno_id,creado_por,creado_en,reporte_relevante,flujo_clarificador,nivel_tanque_11,nivel_tanque_300,torque_clarificador,setpoint_b13,flujo_entrada_ptar,flujo_daf_chino,nivel_daf_chino,flujo_daf_huber,flujo_reactor_2,flujo_aimsu,presion_linea,nivel_almacen,estado_agitador_9300,destino_descarga_daf,modo_bomba_9,modo_bomba_13,modo_bomba_9310,estado_prensa_essity,estado_prensa_nalco,comentario_prensas)
      values(p_id,p_turno,auth.uid(),clock_timestamp(),p_datos->>'reporteRelevante',t.flujo_clarificador,t.nivel_tanque_11,t.nivel_tanque_300,t.torque_clarificador,t.setpoint_b13,t.flujo_entrada_ptar,t.flujo_daf_chino,t.nivel_daf_chino,t.flujo_daf_huber,t.flujo_reactor_2,t.flujo_aimsu,t.presion_linea,t.nivel_almacen,p_datos->>'estadoAgitador',p_datos->>'destinoDescarga',p_datos->'bombas'->>'9',p_datos->'bombas'->>'13',p_datos->'bombas'->>'9310',p_datos->'prensas'->>'Essity',p_datos->'prensas'->>'Nalco',p_datos->>'comentarioPrensas');
    else
      update public.bitacora_ptar set reporte_relevante=p_datos->>'reporteRelevante',flujo_clarificador=t.flujo_clarificador,nivel_tanque_11=t.nivel_tanque_11,nivel_tanque_300=t.nivel_tanque_300,torque_clarificador=t.torque_clarificador,setpoint_b13=t.setpoint_b13,flujo_entrada_ptar=t.flujo_entrada_ptar,flujo_daf_chino=t.flujo_daf_chino,nivel_daf_chino=t.nivel_daf_chino,flujo_daf_huber=t.flujo_daf_huber,flujo_reactor_2=t.flujo_reactor_2,flujo_aimsu=t.flujo_aimsu,presion_linea=t.presion_linea,nivel_almacen=t.nivel_almacen,
        estado_agitador_9300=p_datos->>'estadoAgitador',destino_descarga_daf=p_datos->>'destinoDescarga',
        modo_bomba_9=p_datos->'bombas'->>'9',modo_bomba_13=p_datos->'bombas'->>'13',modo_bomba_9310=p_datos->'bombas'->>'9310',
        estado_prensa_essity=p_datos->'prensas'->>'Essity',estado_prensa_nalco=p_datos->'prensas'->>'Nalco',comentario_prensas=p_datos->>'comentarioPrensas' where id=p_id;
      if not found then raise exception using errcode='22023',message='Reporte no encontrado.'; end if;
    end if;
  else raise exception using errcode='22023',message='Módulo técnico inválido.'; end if;
end;
$f$;

create function private.btr_guardar_ptar(p_modulo text,p_id uuid,p_turno_id uuid,p_datos jsonb) returns jsonb
language plpgsql set search_path='' as $f$
declare cuenta uuid:=auth.uid(); area text; d jsonb; t public.turnos_operativos%rowtype;
  recibo private.solicitudes_bitacora_tecnica%rowtype; anterior text; existente uuid;
begin
  if p_modulo is distinct from 'bitacora_ptar' then raise exception using errcode='22023',message='Módulo no permitido'; end if;
  area:=case p_modulo when 'bitacora_calderas' then 'calderas' when 'bitacora_ptar' then 'ptar' end;
  if cuenta is null or area is null or private.rol_actual()::text is distinct from area then
    raise exception using errcode='42501',message='Se requiere una cuenta activa del área del reporte.';
  end if;
  if p_id is null or p_turno_id is null then raise exception using errcode='22023',message='Se requiere identificador estable y turno.'; end if;
  d:=private.btr_normalizar_ptar(p_datos);
  perform pg_advisory_xact_lock(hashtextextended('copamex.bt.operacion:'||p_id::text,0));
  select * into recibo from private.solicitudes_bitacora_tecnica where id=p_id;
  if found then
    if recibo.modulo is distinct from p_modulo or recibo.turno_id is distinct from p_turno_id
      or recibo.creado_por is distinct from cuenta or recibo.contenido_inicial is distinct from d then
      raise exception using errcode='23505',message='El identificador ya pertenece a otra solicitud; no se sobrescribió el reporte.';
    end if;
    return jsonb_build_object('id',p_id,'reintento',true,'confirmado',true,'snapshot',private.bt_snapshot_v1(p_modulo,p_id));
  end if;
  perform pg_advisory_xact_lock(hashtextextended('copamex.bt.turno:'||p_modulo||':'||p_turno_id::text,0));
  select * into t from public.turnos_operativos where id=p_turno_id for share;
  if not found or t.area::text is distinct from area or t.iniciado_por is distinct from cuenta or t.finalizado_en is not null then
    raise exception using errcode='42501',message='El reporte requiere tu turno activo del área autorizada.';
  end if;
  if p_modulo='bitacora_calderas' then select id into existente from public.bitacora_calderas where turno_id=p_turno_id or id=p_id;
  else select id into existente from public.bitacora_ptar where turno_id=p_turno_id or id=p_id; end if;
  if found then raise exception using errcode='23505',message='Ya existe un reporte técnico para ese turno o identificador. Consulta el registro; solo Administración puede corregirlo.'; end if;
  anterior:=current_setting('copamex.bt_escritura',true);
  perform set_config('copamex.bt_escritura',p_modulo||':'||p_id::text,true);
  perform private.btr_escribir_ptar(p_modulo,p_id,p_turno_id,d,true);
  insert into private.solicitudes_bitacora_tecnica(id,modulo,calderas_id,ptar_id,turno_id,creado_por,recibido_en,contenido_inicial)
    values(p_id,p_modulo,case when p_modulo='bitacora_calderas' then p_id end,case when p_modulo='bitacora_ptar' then p_id end,p_turno_id,cuenta,clock_timestamp(),d);
  perform set_config('copamex.bt_escritura',coalesce(anterior,''),true);
  return jsonb_build_object('id',p_id,'reintento',false,'confirmado',true,'snapshot',private.bt_snapshot_v1(p_modulo,p_id));
end;
$f$;

create function public.guardar_bitacora_tecnica_ptar_v2(p_id uuid,p_turno_id uuid,p_datos jsonb) returns jsonb
language sql volatile security definer set search_path='' as $f$
 select private.btr_guardar_ptar('bitacora_ptar',p_id,p_turno_id,p_datos);
$f$;

create function public.corregir_bitacora_ptar_admin_v2(
  p_id uuid,p_modulo text,p_reporte_id uuid,p_revision_esperada bigint,p_datos jsonb,p_motivo text
) returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare cuenta uuid:=auth.uid(); d jsonb; antes jsonb; despues jsonb; nombre text; motivo text;
  previa public.revisiones_captura%rowtype; revision_actual bigint; turno_id uuid; contexto text;
begin
  if cuenta is null or not coalesce(private.es_admin(),false) then raise exception using errcode='42501',message='Solo un administrador activo puede corregir reportes técnicos.'; end if;
  motivo:=nullif(regexp_replace(p_motivo,'^[[:space:]]+|[[:space:]]+$','','g'),'');
  if p_id is null or p_reporte_id is null or p_revision_esperada is null or p_revision_esperada<0
    or p_modulo is null or p_modulo<>'bitacora_ptar'
    or motivo is null or length(motivo)>4000 then raise exception using errcode='22023',message='Indica reporte, revisión y motivo obligatorio (hasta 4000 caracteres).'; end if;
  d:=private.btr_normalizar_ptar(p_datos);
  -- Corrección completa y normalizada: evita borrar campos por omisiones accidentales.
  if p_datos is distinct from d then raise exception using errcode='22023',message='La corrección requiere todos los campos del formato normalizado; los opcionales pueden ser NULL.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('copamex.bt.operacion:'||p_id::text,0));
  if p_modulo='bitacora_calderas' then select r.revision,r.turno_id into revision_actual,turno_id from public.bitacora_calderas r where r.id=p_reporte_id for update;
  else select r.revision,r.turno_id into revision_actual,turno_id from public.bitacora_ptar r where r.id=p_reporte_id for update; end if;
  if not found then raise exception using errcode='22023',message='Reporte técnico no encontrado.'; end if;
  select * into previa from public.revisiones_captura where id=p_id;
  if found then
    if previa.modulo=p_modulo and previa.registro_id=p_reporte_id and previa.accion='corregir'
      and previa.creado_por=cuenta and previa.motivo=motivo and previa.datos_solicitados=d
      and (previa.antes->'registro'->>'revision')::bigint=p_revision_esperada then
      return jsonb_build_object('id',p_id,'reintento',true,'confirmado',true,'snapshot',private.bt_snapshot_v1(p_modulo,p_reporte_id));
    end if;
    raise exception using errcode='23505',message='El identificador corresponde a otra revisión.';
  end if;
  if revision_actual<>p_revision_esperada then raise exception using errcode='40001',message='El reporte cambió. Actualiza y revisa antes de corregir.'; end if;
  antes:=private.bt_snapshot_v1(p_modulo,p_reporte_id);
  contexto:=current_setting('copamex.bt_escritura',true);
  perform set_config('copamex.bt_escritura',p_modulo||':'||p_reporte_id::text,true);
  perform private.btr_escribir_ptar(p_modulo,p_reporte_id,turno_id,d,false);
  perform set_config('copamex.bt_escritura',coalesce(contexto,''),true);
  despues:=private.bt_snapshot_v1(p_modulo,p_reporte_id);
  if ((antes->'registro')-'revision')=((despues->'registro')-'revision')
    and (antes->'equipos')=(despues->'equipos') and (antes->'pilas')=(despues->'pilas') then
    raise exception using errcode='22023',message='No hay cambios técnicos para registrar.';
  end if;
  select p.nombre into strict nombre from public.perfiles p where p.id=cuenta and p.activo;
  insert into public.revisiones_captura(id,modulo,registro_id,accion,motivo,creado_por,responsable_nombre,creado_en,antes,despues,datos_solicitados)
    values(p_id,p_modulo,p_reporte_id,'corregir',motivo,cuenta,nombre,clock_timestamp(),antes,despues,d);
  return jsonb_build_object('id',p_id,'reintento',false,'confirmado',true,'snapshot',despues);
end;
$f$;

create function public.consultar_bitacora_tecnica_planta(p_modulo text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $f$
declare s jsonb; area text; t public.turnos_operativos%rowtype; operador text;
begin
  area:=case p_modulo when 'bitacora_calderas' then 'calderas' when 'bitacora_ptar' then 'ptar' end;
  if auth.uid() is null or not coalesce(private.rol_actual()::text in('admin','calderas','ptar'),false) or area is null then
    raise exception using errcode='42501',message='No tienes acceso al área del reporte técnico.';
  end if;
  s:=private.bt_snapshot_v1(p_modulo,p_id); if s is null then return null; end if;
  select * into t from public.turnos_operativos where id=(s->'registro'->>'turno_id')::uuid;
  if not found or t.area::text<>area then raise exception using errcode='22023',message='Relación de turno técnico inconsistente.'; end if;
  select nombre into strict operador from public.operadores where id=t.operador_id;
  return jsonb_build_object('modulo',p_modulo,'snapshot',s,'turno',to_jsonb(t),'operador',operador);
end;
$f$;

create function public.consultar_bitacoras_tecnicas_planta(
  p_desde date,p_hasta date,p_area text default 'todas',p_turno text default 'todos',p_limite integer default 25,p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare salida jsonb;
begin
  if auth.uid() is null or not coalesce(private.rol_actual()::text in('admin','calderas','ptar'),false) then raise exception using errcode='42501',message='Se requiere una cuenta activa de Calderas, PTAR o Administración.'; end if;
  if p_desde is null or p_hasta is null or p_hasta<p_desde or p_area is null or p_area not in('todas','calderas','ptar')
    or p_turno is null or p_turno not in('todos','dia','tarde','noche') or p_limite is null or p_limite not between 1 and 100
    or p_offset is null or p_offset<0 then raise exception using errcode='22023',message='Filtros o paginación inválidos.'; end if;
  with reportes as (
    select 'bitacora_calderas'::text modulo,r.id,r.turno_id,r.creado_en,r.creado_por,r.revision from public.bitacora_calderas r
    union all select 'bitacora_ptar',r.id,r.turno_id,r.creado_en,r.creado_por,r.revision from public.bitacora_ptar r
  ), elegidos as (
    select r.*,t.fecha_operativa,t.area,t.turno,t.operador_id,o.nombre as operador
    from reportes r join public.turnos_operativos t on t.id=r.turno_id join public.operadores o on o.id=t.operador_id
    where t.fecha_operativa between p_desde and p_hasta and (p_area='todas' or t.area::text=p_area) and (p_turno='todos' or t.turno::text=p_turno)
    order by t.fecha_operativa desc,r.creado_en desc,r.modulo,r.id limit p_limite+1 offset p_offset
  ), numerados as (select e.*,row_number() over(order by e.fecha_operativa desc,e.creado_en desc,e.modulo,e.id) n from elegidos e)
  select jsonb_build_object('filas',coalesce(jsonb_agg(to_jsonb(numerados)-'n' order by n) filter(where n<=p_limite),'[]'::jsonb),'mas',count(*)>p_limite)
    into salida from numerados;
  return salida;
end;
$f$;

-- Privilegios explícitos: ningún helper ni trigger ejecutable por clientes.
do $acl$ declare f record; begin
 for f in select p.oid::regprocedure firma,n.nspname esquema from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='private' and p.proname in('btr_exigir_reporte','btr_normalizar_calderas','btr_normalizar_ptar','btr_escribir_calderas','btr_escribir_ptar','btr_guardar_calderas','btr_guardar_ptar'))
 or (n.nspname='public' and p.proname in('guardar_bitacora_tecnica_calderas_v3','guardar_bitacora_tecnica_ptar_v2','corregir_bitacora_calderas_admin_v3','corregir_bitacora_ptar_admin_v2','consultar_bitacora_tecnica_planta','consultar_bitacoras_tecnicas_planta')) loop
  execute format('alter function %s owner to postgres',f.firma);
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.firma);
  if f.esquema='public' then execute format('grant execute on function %s to authenticated',f.firma); end if;
 end loop;
end $acl$;
notify pgrst,'reload schema';
commit;
