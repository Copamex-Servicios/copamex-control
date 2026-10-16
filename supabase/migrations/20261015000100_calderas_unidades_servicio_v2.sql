-- COPAMEX: Calderas formato 2. ARCHIVO LOCAL PARA REVISION; NO APLICADO.
-- Unidades nuevas: Sulzer y condensado 432/433 kg/cm²; osmosis 422/424 PSI.
-- Formato 1 permanece PSI sin conversiones ni UPDATE de datos historicos.
-- Agrega seleccion independiente en servicio (TRUE o NULL), sin afirmar fuera de servicio.
-- No modifica tablas/RLS/RPC de PTAR, Pozos, UF ni observaciones.
-- RPC v1 sigue disponible para registros/reintentos del formato anterior.
-- Las correcciones v1 NO pueden tocar reportes formato 2; RPC v2 auditada independiente.
begin;
set local lock_timeout='10s';
set local statement_timeout='120s';
do $pre$ declare n integer;begin
 if current_user<>'postgres' then raise exception 'Ejecutar como postgres';end if;
 if to_regclass('public.bitacora_calderas') is null or to_regprocedure('private.bt_normalizar_v1(text,jsonb)') is null
 or to_regprocedure('public.corregir_bitacora_tecnica_admin(uuid,text,uuid,bigint,jsonb,text)') is null then raise exception 'Falta la migracion tecnica anterior';end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='bitacora_calderas' and column_name='presion_condensado_unidad')
 or to_regprocedure('public.guardar_bitacora_tecnica_calderas_v2(uuid,uuid,jsonb)') is not null then raise exception 'La actualizacion ya existe; revisar, no reejecutar';end if;
 if exists(select 1 from public.bitacora_calderas where version_formato<>1) then raise exception 'Version de origen inesperada';end if;
 select count(*) into n from pg_constraint where conrelid='public.bitacora_calderas'::regclass and contype='c'
 and regexp_replace(lower(pg_get_constraintdef(oid)),'[^a-z0-9_=]','','g')='checkversion_formato=1';
 if n<>1 then raise exception 'CHECK original de version no reconocido';end if;
 select count(*) into n from pg_constraint where conrelid='public.bitacora_calderas_equipos'::regclass and contype='c'
 and position('sulzer_' in pg_get_constraintdef(oid))>0 and position('presion_unidad' in pg_get_constraintdef(oid))>0 and position('PSI' in pg_get_constraintdef(oid))>0;
 if n<>1 then raise exception 'CHECK original de unidad Sulzer no reconocido';end if;
 if (select count(*) from pg_trigger where tgrelid in('public.bitacora_calderas'::regclass,'public.bitacora_calderas_equipos'::regclass,'public.bitacora_calderas_pilas'::regclass)
 and tgname in('proteger_tecnico','conservar_tecnico') and tgfoid=to_regprocedure('private.bt_proteger_v1()') and tgenabled in('O','A'))<>6 then raise exception 'Triggers originales no reconocidos';end if;
end $pre$;

do $checks$ declare c record;begin
 for c in select conname from pg_constraint where conrelid='public.bitacora_calderas'::regclass and contype='c'
 and regexp_replace(lower(pg_get_constraintdef(oid)),'[^a-z0-9_=]','','g')='checkversion_formato=1' loop
 execute format('alter table public.bitacora_calderas drop constraint %I',c.conname);end loop;
 for c in select conname from pg_constraint where conrelid='public.bitacora_calderas_equipos'::regclass and contype='c'
 and position('sulzer_' in pg_get_constraintdef(oid))>0 and position('presion_unidad' in pg_get_constraintdef(oid))>0 and position('PSI' in pg_get_constraintdef(oid))>0 loop
 execute format('alter table public.bitacora_calderas_equipos drop constraint %I',c.conname);end loop;
end $checks$;
alter table public.bitacora_calderas
 add column presion_condensado_unidad text,
 add column bomba_norte_servicio boolean,
 add column bomba_sur_servicio boolean,
 add column pozo_1_servicio boolean,
 add column pozo_2_servicio boolean,
 add constraint bc_version_v2_check check(version_formato in(1,2)),
 add constraint bc_unidades_version_v2_check check(
 (version_formato=1 and presion_condensado_unidad is null and bomba_norte_servicio is null and bomba_sur_servicio is null and pozo_1_servicio is null and pozo_2_servicio is null)
 or (version_formato=2 and presion_condensado_unidad is not distinct from 'kg/cm²')),
 add constraint bc_servicio_v2_check check((bomba_norte_servicio is null or bomba_norte_servicio=true) and (bomba_sur_servicio is null or bomba_sur_servicio=true) and (pozo_1_servicio is null or pozo_1_servicio=true) and (pozo_2_servicio is null or pozo_2_servicio=true));
alter table public.bitacora_calderas_equipos add constraint bc_sulzer_unidades_v2_check
 check(equipo not like 'sulzer_%' or presion_unidad is not distinct from 'PSI' or presion_unidad is not distinct from 'kg/cm²');
comment on column public.bitacora_calderas.version_formato is '1: contrato anterior PSI en Sulzer y condensado. 2: kg/cm² y selecciones independientes en servicio.';
comment on column public.bitacora_calderas.presion_432 is 'Formato 1: PSI. Formato 2: kg/cm². NULL sin lectura; cero explicito conservado. Sin conversiones.';
comment on column public.bitacora_calderas.presion_433 is 'Formato 1: PSI. Formato 2: kg/cm². NULL sin lectura; cero explicito conservado. Sin conversiones.';
comment on column public.bitacora_calderas_equipos.presion_unidad is 'Sulzer: PSI en formato 1, kg/cm² en formato 2. Calderas y compresores: NULL.';
comment on column public.bitacora_calderas.presion_condensado_unidad is 'Formato 1: NULL, contrato original PSI. Formato 2: kg/cm². Nunca convertir valores anteriores.';
comment on column public.bitacora_calderas.bomba_norte_servicio is 'TRUE: marcado en servicio. NULL: sin registrar; no afirma fuera de servicio.';
comment on column public.bitacora_calderas.bomba_sur_servicio is 'TRUE: marcado en servicio. NULL: sin registrar; no afirma fuera de servicio.';
comment on column public.bitacora_calderas.pozo_1_servicio is 'TRUE: marcado en servicio. NULL: sin registrar; no afirma fuera de servicio.';
comment on column public.bitacora_calderas.pozo_2_servicio is 'TRUE: marcado en servicio. NULL: sin registrar; no afirma fuera de servicio.';

create function private.bc_normalizar_v2(p_datos jsonb) returns jsonb
language plpgsql immutable set search_path='' as $f$
declare d jsonb; s jsonb; r jsonb='{}'; k text; v jsonb;begin
 d:=private.bt_objeto_v1(p_datos,array['versionFormato','mediciones','equipos','pilas','compresores','estadoUF','comentariosUF','servicioAgua']);
 if d->'versionFormato' is distinct from '2'::jsonb then raise exception using errcode='22023',message='Indica formato 2 para guardar las unidades kg/cm².';end if;
 s:=private.bt_objeto_v1(d->'servicioAgua',array['norte','sur','pozo1','pozo2']);
 foreach k in array array['norte','sur','pozo1','pozo2'] loop
 v:=s->k;
 if v is not null and v<>'null'::jsonb and v<>'true'::jsonb then raise exception using errcode='22023',message='Seleccion en servicio invalida: admite TRUE o NULL.';end if;
 r:=r||jsonb_build_object(k,case when v='true'::jsonb then true else null end);
 end loop;
 return private.bt_normalizar_v1('bitacora_calderas',d-array['versionFormato','servicioAgua'])||jsonb_build_object('versionFormato',2,'servicioAgua',r);
end;
$f$;

create function private.bc_proteger_v2() returns trigger
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
    if not coalesce(private.es_admin(),false) then raise exception using errcode='42501',message='Solo Administración puede corregir reportes técnicos.'; end if;
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
    if not found or t.finalizado_en is not null or t.iniciado_por is distinct from auth.uid()
      or t.area::text is distinct from (case modulo when 'bitacora_calderas' then 'calderas' else 'ptar' end)
      or private.rol_actual()::text is distinct from t.area::text then
      raise exception using errcode='42501',message='El reporte requiere tu turno activo en el área correspondiente.';
    end if;
    new.creado_por:=auth.uid(); new.creado_en:=clock_timestamp(); new.version_formato:=formato; new.revision:=0;
  else
    if private.rol_actual()::text is distinct from 'calderas' then raise exception using errcode='42501',message='La creación de equipos requiere Calderas.'; end if;
  end if;
  return new;
end;
$f$;

create function private.bc_escribir_v2(p_id uuid,p_turno uuid,p_datos jsonb,p_crear boolean) returns void
language plpgsql set search_path='' as $f$
declare c public.bitacora_calderas%rowtype; k text; e jsonb; v_estado text; v_presion numeric; v_unidad text;
begin
    c:=jsonb_populate_record(null::public.bitacora_calderas,p_datos->'mediciones');
    if p_crear then
      insert into public.bitacora_calderas(id,turno_id,creado_por,creado_en,nivel_condensado,presion_432,presion_433,presion_422,presion_424,flujo_osmosis,flujo_uf,nivel_rotoplas,presion_aire,nivel_agua_potable,estado_uf,comentarios_uf,presion_condensado_unidad,bomba_norte_servicio,bomba_sur_servicio,pozo_1_servicio,pozo_2_servicio)
      values(p_id,p_turno,auth.uid(),clock_timestamp(),c.nivel_condensado,c.presion_432,c.presion_433,c.presion_422,c.presion_424,c.flujo_osmosis,c.flujo_uf,c.nivel_rotoplas,c.presion_aire,c.nivel_agua_potable,p_datos->>'estadoUF',p_datos->>'comentariosUF','kg/cm²',(p_datos->'servicioAgua'->>'norte')::boolean,(p_datos->'servicioAgua'->>'sur')::boolean,(p_datos->'servicioAgua'->>'pozo1')::boolean,(p_datos->'servicioAgua'->>'pozo2')::boolean);
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
      update public.bitacora_calderas set nivel_condensado=c.nivel_condensado,presion_432=c.presion_432,presion_433=c.presion_433,presion_422=c.presion_422,presion_424=c.presion_424,flujo_osmosis=c.flujo_osmosis,flujo_uf=c.flujo_uf,nivel_rotoplas=c.nivel_rotoplas,presion_aire=c.presion_aire,nivel_agua_potable=c.nivel_agua_potable,estado_uf=p_datos->>'estadoUF',comentarios_uf=p_datos->>'comentariosUF',bomba_norte_servicio=(p_datos->'servicioAgua'->>'norte')::boolean,bomba_sur_servicio=(p_datos->'servicioAgua'->>'sur')::boolean,pozo_1_servicio=(p_datos->'servicioAgua'->>'pozo1')::boolean,pozo_2_servicio=(p_datos->'servicioAgua'->>'pozo2')::boolean where id=p_id;
      if not found then raise exception using errcode='22023',message='Reporte no encontrado.'; end if;
    end if;
end;
$f$;

create function private.bc_guardar_v2(p_id uuid,p_turno_id uuid,p_datos jsonb) returns jsonb
language plpgsql set search_path='' as $f$
declare p_modulo constant text:='bitacora_calderas'; formato_anterior text; cuenta uuid:=auth.uid(); area text; d jsonb; t public.turnos_operativos%rowtype;
  recibo private.solicitudes_bitacora_tecnica%rowtype; anterior text; existente uuid;
begin
  area:=case p_modulo when 'bitacora_calderas' then 'calderas' when 'bitacora_ptar' then 'ptar' end;
  if cuenta is null or area is null or private.rol_actual()::text is distinct from area then
    raise exception using errcode='42501',message='Se requiere una cuenta activa del área del reporte.';
  end if;
  if p_id is null or p_turno_id is null then raise exception using errcode='22023',message='Se requiere identificador estable y turno.'; end if;
  d:=private.bc_normalizar_v2(p_datos);
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
  perform private.bc_escribir_v2(p_id,p_turno_id,d,true);
  insert into private.solicitudes_bitacora_tecnica(id,modulo,calderas_id,ptar_id,turno_id,creado_por,recibido_en,contenido_inicial)
    values(p_id,p_modulo,case when p_modulo='bitacora_calderas' then p_id end,case when p_modulo='bitacora_ptar' then p_id end,p_turno_id,cuenta,clock_timestamp(),d);
  perform set_config('copamex.bt_escritura',coalesce(anterior,''),true);
  perform set_config('copamex.bc_formato',coalesce(formato_anterior,''),true);
  return jsonb_build_object('id',p_id,'reintento',false,'confirmado',true,'snapshot',private.bt_snapshot_v1(p_modulo,p_id));
end;
$f$;

create function public.guardar_bitacora_tecnica_calderas_v2(p_id uuid,p_turno_id uuid,p_datos jsonb) returns jsonb
language sql volatile security definer set search_path='' as $f$
 select private.bc_guardar_v2(p_id,p_turno_id,p_datos);
$f$;

create function public.corregir_bitacora_calderas_admin_v2(
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
  d:=private.bc_normalizar_v2(p_datos);
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
  perform private.bc_escribir_v2(p_reporte_id,turno_id,d,false);
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

do $acl$ declare firma text; tabla text; clase text;begin
 foreach firma in array array['private.bc_normalizar_v2(jsonb)','private.bc_proteger_v2()','private.bc_escribir_v2(uuid,uuid,jsonb,boolean)','private.bc_guardar_v2(uuid,uuid,jsonb)',
 'public.guardar_bitacora_tecnica_calderas_v2(uuid,uuid,jsonb)','public.corregir_bitacora_calderas_admin_v2(uuid,uuid,bigint,jsonb,text)'] loop
 execute 'alter function '||firma||' owner to postgres';
 execute 'revoke all on function '||firma||' from public,anon,authenticated,service_role';
 end loop;
 grant execute on function public.guardar_bitacora_tecnica_calderas_v2(uuid,uuid,jsonb),public.corregir_bitacora_calderas_admin_v2(uuid,uuid,bigint,jsonb,text) to authenticated;
 foreach tabla in array array['bitacora_calderas','bitacora_calderas_equipos','bitacora_calderas_pilas'] loop
 clase:=case tabla when 'bitacora_calderas' then 'cabecera' when 'bitacora_calderas_equipos' then 'equipo' else 'pila' end;
 execute format('drop trigger proteger_tecnico on public.%I',tabla);
 execute format('drop trigger conservar_tecnico on public.%I',tabla);
 execute format('create trigger proteger_tecnico before insert or update or delete on public.%I for each row execute function private.bc_proteger_v2(%L,%L)',tabla,'bitacora_calderas',clase);
 execute format('create trigger conservar_tecnico before truncate on public.%I for each statement execute function private.bc_proteger_v2(%L,%L)',tabla,'bitacora_calderas',clase);
 end loop;
end $acl$;
notify pgrst,'reload schema';
commit;
