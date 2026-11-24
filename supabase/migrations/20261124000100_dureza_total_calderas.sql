-- Agrega Dureza total (PPM) a nuevas capturas de Calderas.
-- Los reportes históricos conservan NULL: no se reconstruyen ni se marcan incompletos.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
begin
  if to_regclass('public.bitacora_calderas') is null
    or to_regprocedure('private.bt_numero_v1(jsonb)') is null
    or to_regprocedure('private.bt_normalizar_v1(text,jsonb)') is null
    or to_regprocedure('private.bc_normalizar_v2(jsonb)') is null
    or to_regprocedure('private.bc_escribir_v2(uuid,uuid,jsonb,boolean)') is null
    or to_regprocedure('private.btr_escribir_calderas(uuid,uuid,jsonb,boolean)') is null
    or to_regprocedure('private.bt_validar_envio_completo()') is null then
    raise exception 'Faltan las funciones de bitácora técnica de Calderas.';
  end if;
  if exists(select 1 from pg_catalog.pg_attribute
    where attrelid='public.bitacora_calderas'::regclass and attname='dureza_total_ppm' and not attisdropped) then
    raise exception 'La columna de dureza ya existe; revisar antes de volver a aplicar.';
  end if;
end;
$pre$;

alter table public.bitacora_calderas
  add column dureza_total_ppm numeric
  constraint bc_dureza_total_ppm_finita_check check (private.bt_finito_v1(dureza_total_ppm));

comment on column public.bitacora_calderas.dureza_total_ppm is
  'Dureza total medida en PPM. NULL se conserva en reportes anteriores a la captura de este dato.';

-- Acepta el nuevo campo sin cambiar la normalización histórica de solicitudes antiguas.
create or replace function private.bc_normalizar_v2(p_datos jsonb) returns jsonb
language plpgsql immutable set search_path='' as $f$
declare d jsonb; s jsonb; r jsonb:='{}'; k text; v jsonb; med jsonb;
  datos_base jsonb; normalizado jsonb; dureza numeric;
begin
 d:=private.bt_objeto_v1(p_datos,array['versionFormato','mediciones','equipos','pilas','compresores','estadoUF','comentariosUF','servicioAgua']);
 if d->'versionFormato' is distinct from '2'::jsonb then
   raise exception using errcode='22023',message='Indica formato 2 para guardar las unidades kg/cm².';
 end if;
 med:=private.bt_objeto_v1(d->'mediciones',array['nivel_condensado','presion_432','presion_433','presion_422','presion_424','flujo_osmosis','flujo_uf','nivel_rotoplas','presion_aire','nivel_agua_potable','dureza_total_ppm']::text[]);
 if med ? 'dureza_total_ppm' then dureza:=private.bt_numero_v1(med->'dureza_total_ppm'); end if;
 s:=private.bt_objeto_v1(d->'servicioAgua',array['norte','sur','pozo1','pozo2']);
 foreach k in array array['norte','sur','pozo1','pozo2'] loop
   v:=s->k;
   if v is not null and v<>'null'::jsonb and v<>'true'::jsonb then
     raise exception using errcode='22023',message='Seleccion en servicio inválida: admite TRUE o NULL.';
   end if;
   r:=r||jsonb_build_object(k,case when v='true'::jsonb then true else null end);
 end loop;
 datos_base:=d-array['versionFormato','servicioAgua'];
 datos_base:=jsonb_set(datos_base,'{mediciones}',(d->'mediciones')-'dureza_total_ppm',false);
 normalizado:=private.bt_normalizar_v1('bitacora_calderas',datos_base);
 -- No añadir una clave ausente en reintentos antiguos; conserva su contenido idempotente.
 if med ? 'dureza_total_ppm' then
   normalizado:=jsonb_set(normalizado,'{mediciones}',
     (normalizado->'mediciones')||jsonb_build_object('dureza_total_ppm',dureza),false);
 end if;
 return normalizado||jsonb_build_object('versionFormato',2,'servicioAgua',r);
end;
$f$;

-- El escritor v2 sigue guardando el valor si llega desde la interfaz actual.
-- Si una corrección antigua omite la clave, conserva el valor existente.
create or replace function private.bc_escribir_v2(p_id uuid,p_turno uuid,p_datos jsonb,p_crear boolean) returns void
language plpgsql set search_path='' as $f$
declare c public.bitacora_calderas%rowtype; k text; e jsonb; v_estado text; v_presion numeric; v_unidad text;
begin
 c:=jsonb_populate_record(null::public.bitacora_calderas,p_datos->'mediciones');
 if p_crear then
  insert into public.bitacora_calderas(id,turno_id,creado_por,creado_en,nivel_condensado,presion_432,presion_433,presion_422,presion_424,flujo_osmosis,dureza_total_ppm,flujo_uf,nivel_rotoplas,presion_aire,nivel_agua_potable,estado_uf,comentarios_uf,presion_condensado_unidad,bomba_norte_servicio,bomba_sur_servicio,pozo_1_servicio,pozo_2_servicio)
  values(p_id,p_turno,auth.uid(),clock_timestamp(),c.nivel_condensado,c.presion_432,c.presion_433,c.presion_422,c.presion_424,c.flujo_osmosis,c.dureza_total_ppm,c.flujo_uf,c.nivel_rotoplas,c.presion_aire,c.nivel_agua_potable,p_datos->>'estadoUF',p_datos->>'comentariosUF','kg/cm²',(p_datos->'servicioAgua'->>'norte')::boolean,(p_datos->'servicioAgua'->>'sur')::boolean,(p_datos->'servicioAgua'->>'pozo1')::boolean,(p_datos->'servicioAgua'->>'pozo2')::boolean);
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
  update public.bitacora_calderas as actual set nivel_condensado=c.nivel_condensado,presion_432=c.presion_432,presion_433=c.presion_433,presion_422=c.presion_422,presion_424=c.presion_424,flujo_osmosis=c.flujo_osmosis,
   dureza_total_ppm=case when (p_datos->'mediciones') ? 'dureza_total_ppm' then c.dureza_total_ppm else actual.dureza_total_ppm end,
   flujo_uf=c.flujo_uf,nivel_rotoplas=c.nivel_rotoplas,presion_aire=c.presion_aire,nivel_agua_potable=c.nivel_agua_potable,estado_uf=p_datos->>'estadoUF',comentarios_uf=p_datos->>'comentariosUF',
   bomba_norte_servicio=(p_datos->'servicioAgua'->>'norte')::boolean,bomba_sur_servicio=(p_datos->'servicioAgua'->>'sur')::boolean,pozo_1_servicio=(p_datos->'servicioAgua'->>'pozo1')::boolean,pozo_2_servicio=(p_datos->'servicioAgua'->>'pozo2')::boolean where actual.id=p_id;
  if not found then raise exception using errcode='22023',message='Reporte no encontrado.'; end if;
 end if;
end;
$f$;

create or replace function private.btr_escribir_calderas(p_id uuid,p_turno uuid,p_datos jsonb,p_crear boolean) returns void
language plpgsql set search_path='' as $f$
declare c public.bitacora_calderas%rowtype; k text; e jsonb; v_estado text; v_presion numeric; v_unidad text;
begin
 c:=jsonb_populate_record(null::public.bitacora_calderas,p_datos->'mediciones');
 if p_crear then
  insert into public.bitacora_calderas(id,turno_id,creado_por,creado_en,reporte_relevante,nivel_condensado,presion_432,presion_433,presion_422,presion_424,flujo_osmosis,dureza_total_ppm,flujo_uf,nivel_rotoplas,presion_aire,nivel_agua_potable,estado_uf,comentarios_uf,comentarios_pilas,comentarios_compresores,presion_condensado_unidad,bomba_norte_servicio,bomba_sur_servicio,pozo_1_servicio,pozo_2_servicio)
  values(p_id,p_turno,auth.uid(),clock_timestamp(),p_datos->>'reporteRelevante',c.nivel_condensado,c.presion_432,c.presion_433,c.presion_422,c.presion_424,c.flujo_osmosis,c.dureza_total_ppm,c.flujo_uf,c.nivel_rotoplas,c.presion_aire,c.nivel_agua_potable,p_datos->>'estadoUF',p_datos->>'comentariosUF',p_datos->>'comentariosPilas',coalesce(p_datos->>'comentariosCompresores','NA'),'kg/cm²',(p_datos->'servicioAgua'->>'norte')::boolean,(p_datos->'servicioAgua'->>'sur')::boolean,(p_datos->'servicioAgua'->>'pozo1')::boolean,(p_datos->'servicioAgua'->>'pozo2')::boolean);
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
  update public.bitacora_calderas as actual set reporte_relevante=p_datos->>'reporteRelevante',nivel_condensado=c.nivel_condensado,presion_432=c.presion_432,presion_433=c.presion_433,presion_422=c.presion_422,presion_424=c.presion_424,flujo_osmosis=c.flujo_osmosis,
   dureza_total_ppm=case when (p_datos->'mediciones') ? 'dureza_total_ppm' then c.dureza_total_ppm else actual.dureza_total_ppm end,
   flujo_uf=c.flujo_uf,nivel_rotoplas=c.nivel_rotoplas,presion_aire=c.presion_aire,nivel_agua_potable=c.nivel_agua_potable,estado_uf=p_datos->>'estadoUF',comentarios_uf=p_datos->>'comentariosUF',
   comentarios_pilas=case when p_datos ? 'comentariosPilas' then p_datos->>'comentariosPilas' else actual.comentarios_pilas end,
   comentarios_compresores=case when p_datos ? 'comentariosCompresores' then p_datos->>'comentariosCompresores' else actual.comentarios_compresores end,
   bomba_norte_servicio=(p_datos->'servicioAgua'->>'norte')::boolean,bomba_sur_servicio=(p_datos->'servicioAgua'->>'sur')::boolean,pozo_1_servicio=(p_datos->'servicioAgua'->>'pozo1')::boolean,pozo_2_servicio=(p_datos->'servicioAgua'->>'pozo2')::boolean where actual.id=p_id;
  if not found then raise exception using errcode='22023',message='Reporte no encontrado.'; end if;
 end if;
end;
$f$;

-- El trigger diferido exige el dato en nuevas capturas, sin recalcular el estado de reportes anteriores.
create or replace function private.bt_validar_envio_completo() returns trigger
language plpgsql security definer set search_path='' as $f$
declare t public.turnos_operativos%rowtype; area text:=case tg_table_name when 'bitacora_calderas' then 'calderas' else 'ptar' end;
begin
 if area='calderas'
   and (tg_op='INSERT' or not coalesce(private.es_admin(),false))
   and to_jsonb(new)->>'dureza_total_ppm' is null then
  raise exception using errcode='22023',message='Registra la dureza total en PPM antes de enviar el reporte.';
 end if;
 if coalesce(private.es_admin(),false) then return null; end if;
 select * into t from public.turnos_operativos where id=new.turno_id;
 if not private.bt_operador_en_turno(t,clock_timestamp()) then
  raise exception using errcode='42501',message='El horario del reporte terminó antes de confirmar el envío.';
 end if;
 if not private.bt_snapshot_completo(area,private.bt_snapshot_v1('bitacora_'||area,new.id)) then
  raise exception using errcode='22023',message='Completa todos los campos obligatorios antes de enviar.';
 end if;
 return null;
end;
$f$;

notify pgrst,'reload schema';
commit;
