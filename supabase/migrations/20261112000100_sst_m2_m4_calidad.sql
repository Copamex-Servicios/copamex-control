-- LOCAL: pendiente de aplicar en Supabase. No ejecutada remotamente.
-- Reglas de captura por catálogo. SST M2/M4 se guarda sin evaluación de norma.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
 if to_regprocedure('private.aplicar_limites_resultado_calidad()') is null then
  raise exception 'Falta la migración de historial de límites de Calidad.';
 end if;
 if (select count(*) from public.puntos_muestreo where id in (
  '20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000004')) <> 3 then
  raise exception 'Revisar IDs del catálogo: se requieren AIMSU, Pila M-2 y Pila M-4 originales.';
 end if;
 if (select count(*) from public.parametros_calidad where lower(btrim(nombre))='sst') > 1 then
  raise exception 'Hay varios parámetros SST. Revisar antes de aplicar.';
 end if;
end;
$pre$;

alter table public.parametros_calidad
 add column areas_captura text[] not null default array['ptar']::text[]
  check (cardinality(areas_captura)>0 and array_position(areas_captura,null) is null
   and areas_captura <@ array['calderas','ptar']::text[]),
 add column puntos_permitidos uuid[]
  check (puntos_permitidos is null or (cardinality(puntos_permitidos)>0 and array_position(puntos_permitidos,null) is null)),
 add column evaluar_limites boolean not null default true;

-- Mantener las combinaciones anteriores: Color en ambas áreas y Turbidez solo AIMSU.
update public.parametros_calidad set areas_captura=array['calderas','ptar']::text[]
 where lower(btrim(nombre)) in ('color','turbidez');
update public.parametros_calidad
 set puntos_permitidos=array['20000000-0000-4000-8000-000000000001'::uuid]
 where lower(btrim(nombre))='turbidez';

-- Reutilizar SST si existe, sin inventar una unidad de medida.
insert into public.parametros_calidad(nombre,unidad)
 select 'SST',null where not exists(
  select 1 from public.parametros_calidad where lower(btrim(nombre))='sst');
update public.parametros_calidad
 set activo=true, areas_captura=array['calderas','ptar']::text[],
 puntos_permitidos=array[
  '20000000-0000-4000-8000-000000000003'::uuid,
  '20000000-0000-4000-8000-000000000004'::uuid],
 evaluar_limites=false
 where lower(btrim(nombre))='sst';

comment on column public.parametros_calidad.areas_captura is 'Áreas que pueden incluir este parámetro en muestras nuevas.';
comment on column public.parametros_calidad.puntos_permitidos is 'IDs habilitados. NULL permite todos los puntos del área. No depende de nombres visibles.';
comment on column public.parametros_calidad.evaluar_limites is 'FALSE conserva límites aplicados NULL en muestras nuevas y fuera_norma NULL. No cambia históricos.';

create or replace function private.aplicar_limites_resultado_calidad()
returns trigger language plpgsql security invoker set search_path='' as $f$
declare fecha_captura timestamptz; fecha_borrado timestamptz; area_captura text;
 configuracion public.parametros_calidad%rowtype;
begin
 select m.capturado_en,m.eliminado_en,t.area::text
 into fecha_captura,fecha_borrado,area_captura
 from public.muestras_calidad m join public.turnos_operativos t on t.id=m.turno_id
 where m.id=new.muestra_id;
 if not found then
  raise exception using errcode='23503',message='La muestra debe existir y estar disponible antes de guardar sus resultados.';
 end if;
 if fecha_borrado is not null then
  raise exception using errcode='42501',message='No se agregan resultados a una muestra eliminada.';
 end if;
 select * into configuracion from public.parametros_calidad where id=new.parametro_id;
 if not found or not configuracion.activo
  or not (area_captura=any(configuracion.areas_captura))
  or (configuracion.puntos_permitidos is not null and not (new.punto_id=any(configuracion.puntos_permitidos))) then
  raise exception using errcode='22023',message='Revisa los puntos y parámetros habilitados para esta área.';
 end if;
 new.limite_min_aplicado:=null;
 new.limite_max_aplicado:=null;
 if configuracion.evaluar_limites then
  select l.limite_min,l.limite_max into new.limite_min_aplicado,new.limite_max_aplicado
  from public.limites_calidad l
  where l.punto_id=new.punto_id and l.parametro_id=new.parametro_id
   and pg_catalog.tstzrange(l.vigente_desde,l.vigente_hasta,'[)') @> fecha_captura;
 end if;
 -- fuera_norma ya es una columna generada: sin límites resulta NULL.
 return new;
end;
$f$;
-- CREATE OR REPLACE conserva el trigger existente. No se conceden permisos nuevos.
alter function private.aplicar_limites_resultado_calidad() owner to postgres;
revoke all on function private.aplicar_limites_resultado_calidad() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
