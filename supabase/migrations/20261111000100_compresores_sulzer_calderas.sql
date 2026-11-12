-- LOCAL: pendiente de revisión y aplicación autorizada en Supabase.
-- Comentario general opcional de Compresores y presión cero en Sulzer fuera de servicio.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
do $pre$
begin
 if to_regprocedure('private.btr_normalizar_calderas(jsonb)') is null
   or to_regprocedure('private.btr_escribir_calderas(uuid,uuid,jsonb,boolean)') is null
   or not exists(select 1 from pg_catalog.pg_attribute where attrelid='public.bitacora_calderas'::regclass and attname='comentarios_pilas' and not attisdropped) then
  raise exception 'Aplicar primero las migraciones de reporte relevante y comentarios de Pilas.';
 end if;
end;
$pre$;
alter table public.bitacora_calderas add column comentarios_compresores text
 constraint bc_comentarios_compresores_check check (comentarios_compresores is null or length(comentarios_compresores)<=4000);
comment on column public.bitacora_calderas.comentarios_compresores is 'Comentario general opcional de Compresores. Nuevas capturas vacías: NA. Históricos: NULL.';

create or replace function private.btr_normalizar_calderas(p_datos jsonb) returns jsonb
language plpgsql immutable set search_path='' as $f$
declare relevante text; comentario text; compresores text; salida jsonb; k text;
begin
 relevante:=private.bt_texto_v1(p_datos->'reporteRelevante');
 if relevante is null or length(relevante)>4000 then raise exception using errcode='22023',message='Escribe el reporte relevante del turno (hasta 4000 caracteres).'; end if;
 comentario:=private.bt_texto_v1(p_datos->'comentariosPilas');
 if length(comentario)>4000 then raise exception using errcode='22023',message='Los comentarios de Pilas admiten hasta 4000 caracteres.'; end if;
 compresores:=coalesce(private.bt_texto_v1(p_datos->'comentariosCompresores'),'NA');
 if length(compresores)>4000 then raise exception using errcode='22023',message='Los comentarios de Compresores admiten hasta 4000 caracteres.'; end if;
 salida:=private.bc_normalizar_v2(p_datos-'reporteRelevante'-'comentariosPilas'-'comentariosCompresores')||jsonb_build_object('reporteRelevante',relevante);
 if p_datos ? 'comentariosPilas' then salida:=salida||jsonb_build_object('comentariosPilas',comentario); end if;
 -- Las solicitudes antiguas conservan sus claves y valores para poder confirmar reintentos.
 if p_datos ? 'comentariosCompresores' then
  salida:=salida||jsonb_build_object('comentariosCompresores',compresores);
  foreach k in array array['sulzer_436','sulzer_469','sulzer_470','sulzer_456'] loop
   if salida->'equipos'->k->>'estado' in ('Reserva','Mantenimiento') then
    salida:=jsonb_set(salida,array['equipos',k,'presion'],'0'::jsonb,false);
   end if;
  end loop;
 end if;
 return salida;
end;
$f$;

create or replace function private.btr_escribir_calderas(p_id uuid,p_turno uuid,p_datos jsonb,p_crear boolean) returns void
language plpgsql set search_path='' as $f$
declare c public.bitacora_calderas%rowtype; k text; e jsonb; v_estado text; v_presion numeric; v_unidad text;
begin
 c:=jsonb_populate_record(null::public.bitacora_calderas,p_datos->'mediciones');
 if p_crear then
  insert into public.bitacora_calderas(id,turno_id,creado_por,creado_en,reporte_relevante,nivel_condensado,presion_432,presion_433,presion_422,presion_424,flujo_osmosis,flujo_uf,nivel_rotoplas,presion_aire,nivel_agua_potable,estado_uf,comentarios_uf,comentarios_pilas,comentarios_compresores,presion_condensado_unidad,bomba_norte_servicio,bomba_sur_servicio,pozo_1_servicio,pozo_2_servicio)
  values(p_id,p_turno,auth.uid(),clock_timestamp(),p_datos->>'reporteRelevante',c.nivel_condensado,c.presion_432,c.presion_433,c.presion_422,c.presion_424,c.flujo_osmosis,c.flujo_uf,c.nivel_rotoplas,c.presion_aire,c.nivel_agua_potable,p_datos->>'estadoUF',p_datos->>'comentariosUF',p_datos->>'comentariosPilas',coalesce(p_datos->>'comentariosCompresores','NA'),'kg/cm²',(p_datos->'servicioAgua'->>'norte')::boolean,(p_datos->'servicioAgua'->>'sur')::boolean,(p_datos->'servicioAgua'->>'pozo1')::boolean,(p_datos->'servicioAgua'->>'pozo2')::boolean);
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
  update public.bitacora_calderas set reporte_relevante=p_datos->>'reporteRelevante',nivel_condensado=c.nivel_condensado,presion_432=c.presion_432,presion_433=c.presion_433,presion_422=c.presion_422,presion_424=c.presion_424,flujo_osmosis=c.flujo_osmosis,flujo_uf=c.flujo_uf,nivel_rotoplas=c.nivel_rotoplas,presion_aire=c.presion_aire,nivel_agua_potable=c.nivel_agua_potable,estado_uf=p_datos->>'estadoUF',comentarios_uf=p_datos->>'comentariosUF',comentarios_pilas=case when p_datos ? 'comentariosPilas' then p_datos->>'comentariosPilas' else comentarios_pilas end,comentarios_compresores=case when p_datos ? 'comentariosCompresores' then p_datos->>'comentariosCompresores' else comentarios_compresores end,bomba_norte_servicio=(p_datos->'servicioAgua'->>'norte')::boolean,bomba_sur_servicio=(p_datos->'servicioAgua'->>'sur')::boolean,pozo_1_servicio=(p_datos->'servicioAgua'->>'pozo1')::boolean,pozo_2_servicio=(p_datos->'servicioAgua'->>'pozo2')::boolean where id=p_id;
  if not found then raise exception using errcode='22023',message='Reporte no encontrado.'; end if;
 end if;
end;
$f$;

-- CREATE OR REPLACE conserva propietarios, ACL, RLS y auditoría existentes.
notify pgrst,'reload schema';
commit;
