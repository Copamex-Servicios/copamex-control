-- LOCAL: aplicar manualmente tras revisión. No ejecutada remotamente.
-- Seguimiento adicional vinculado a Avisos; no reemplaza muestras habituales.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
do $pre$
begin
 if to_regprocedure('private.bt_operador_en_turno(public.turnos_operativos,timestamptz)') is null
  or to_regprocedure('private.resumen_muestra_calidad_online(uuid)') is null then
  raise exception 'Faltan dependencias de turnos y Calidad.';
 end if;
 if not exists(select 1 from public.puntos_muestreo where id='20000000-0000-4000-8000-000000000004')
  or not exists(select 1 from public.parametros_calidad where id='30000000-0000-4000-8000-000000000001') then
  raise exception 'Revisar los IDs originales de Pila M-4 y Color.';
 end if;
end;
$pre$;

-- Catálogo interno extensible a otros seguimientos, sin palabras clave en avisos.
create table private.tipos_seguimiento_calidad(
 tipo text primary key, nombre text not null, area public.area_planta not null,
 punto_id uuid not null references public.puntos_muestreo(id),
 parametro_id uuid not null references public.parametros_calidad(id));
-- Catálogo interno: RLS sin políticas de cliente. Solo lo consultan las RPC del servidor.
alter table private.tipos_seguimiento_calidad enable row level security;
insert into private.tipos_seguimiento_calidad values(
 'color_m4','Seguimiento de color M4','calderas',
 '20000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000001');
revoke all on private.tipos_seguimiento_calidad from public,anon,authenticated,service_role;

create table public.seguimientos_calidad(
 id uuid primary key, tipo text not null references private.tipos_seguimiento_calidad(tipo),
 aviso_id uuid not null unique references public.avisos(id),
 instruccion text not null check(length(btrim(instruccion)) between 1 and 4000),
 instruccion_inicial text not null check(length(btrim(instruccion_inicial)) between 1 and 4000),
 creado_por uuid not null references auth.users(id),
 creado_en timestamptz not null default clock_timestamp(),
 finalizado_en timestamptz);
create unique index seguimiento_calidad_unico_activo on public.seguimientos_calidad(tipo) where finalizado_en is null;
alter table public.seguimientos_calidad enable row level security;
revoke all on public.seguimientos_calidad from public,anon,authenticated,service_role;
-- La lectura se realiza por RPC con cuenta activa; sin escrituras directas.
create trigger auditar_seguimiento after insert or update or delete on public.seguimientos_calidad
 for each row execute function private.registrar_auditoria();
create trigger impedir_borrado_seguimiento before delete on public.seguimientos_calidad
 for each row execute function private.impedir_borrado_operativo();
create trigger impedir_truncate_seguimiento before truncate on public.seguimientos_calidad
 for each statement execute function private.impedir_borrado_operativo();

alter table public.muestras_calidad
 add column seguimiento_id uuid references public.seguimientos_calidad(id),
 add column seguimiento_valor_inicial numeric,
 add constraint muestra_seguimiento_consistente check(
  (seguimiento_id is null and seguimiento_valor_inicial is null)
  or (seguimiento_id is not null and seguimiento_valor_inicial is not null
   and seguimiento_valor_inicial::text not in ('NaN','Infinity','-Infinity')));
create index muestras_calidad_seguimiento_idx on public.muestras_calidad(seguimiento_id) where seguimiento_id is not null;

create function private.proteger_identidad_seguimiento() returns trigger
language plpgsql set search_path='' as $f$
begin
 if tg_op='UPDATE' and row(new.seguimiento_id,new.seguimiento_valor_inicial)
  is distinct from row(old.seguimiento_id,old.seguimiento_valor_inicial) then
  raise exception using errcode='42501',message='El seguimiento original de la muestra se conserva.';
 end if;
 if tg_op='INSERT' and new.seguimiento_id is not null and
  (current_user<>'postgres' or auth.uid() is null
   or current_setting('copamex.seguimiento_calidad',true) is distinct from new.id::text) then
  raise exception using errcode='42501',message='La lectura adicional requiere la operación controlada.';
 end if;
 return new;
end;
$f$;
create trigger proteger_identidad_seguimiento before insert or update on public.muestras_calidad
 for each row execute function private.proteger_identidad_seguimiento();

-- Finalizar/editar el aviso mediante la gestión existente sincroniza el seguimiento.
create function private.sincronizar_aviso_seguimiento() returns trigger
language plpgsql security definer set search_path='' as $f$
begin
 update public.seguimientos_calidad set instruccion=new.mensaje,
  finalizado_en=case when not new.permanente and new.fin is not null and new.fin<=clock_timestamp()
    then clock_timestamp() else null end
 where aviso_id=new.id and finalizado_en is null;
 return null;
end;
$f$;
create trigger sincronizar_aviso_seguimiento after update on public.avisos
 for each row execute function private.sincronizar_aviso_seguimiento();

create function public.consultar_seguimiento_calidad(p_tipo text default 'color_m4')
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare salida jsonb; rol text:=private.rol_actual()::text;
begin
 if auth.uid() is null or rol is null or rol not in ('admin','calidad','calderas','ptar') then
  raise exception using errcode='42501',message='Se requiere una cuenta activa.';
 end if;
 select jsonb_build_object('id',s.id,'tipo',s.tipo,'area',c.area,'punto_id',c.punto_id,
  'parametro_id',c.parametro_id,'instruccion',s.instruccion,'creado_por',s.creado_por)
 into salida from public.seguimientos_calidad s join private.tipos_seguimiento_calidad c on c.tipo=s.tipo
 join public.avisos a on a.id=s.aviso_id
 where s.tipo=p_tipo and s.finalizado_en is null
  and (rol in ('admin','calidad') or rol=c.area::text)
  and (a.inicio is null or a.inicio<=statement_timestamp())
  and (a.permanente or a.fin is null or a.fin>statement_timestamp());
 return salida;
end;
$f$;

create function public.activar_seguimiento_calidad(p_id uuid,p_tipo text,p_instruccion text)
returns uuid language plpgsql security definer set search_path='' as $f$
declare c private.tipos_seguimiento_calidad%rowtype; s public.seguimientos_calidad%rowtype;
 nota text:=upper(btrim(p_instruccion));
begin
 if auth.uid() is null or not coalesce(private.es_admin(),false) then
  raise exception using errcode='42501',message='Solo Administración puede activar el seguimiento.';
 end if;
 if p_id is null or nota is null or length(nota) not between 1 and 4000 then
  raise exception using errcode='22023',message='Escribe una instrucción de hasta 4000 caracteres.';
 end if;
 select * into c from private.tipos_seguimiento_calidad where tipo=p_tipo;
 if not found then raise exception using errcode='22023',message='Seguimiento desconocido.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('copamex.seguimiento:'||p_tipo,0));
 select * into s from public.seguimientos_calidad where id=p_id;
 if found then
  if s.tipo<>p_tipo or s.creado_por<>auth.uid() or s.instruccion_inicial<>nota then
   raise exception using errcode='23505',message='El identificador corresponde a otra activación.';
  end if;
  return s.id; -- Reintento confirmado, incluso si después editaron/finalizaron el aviso.
 end if;
 -- Un aviso temporal que expiró cierra su seguimiento antes de permitir otro.
 update public.seguimientos_calidad q set finalizado_en=clock_timestamp()
 from public.avisos a where q.aviso_id=a.id and q.tipo=p_tipo and q.finalizado_en is null
  and not a.permanente and a.fin is not null and a.fin<=clock_timestamp();
 if exists(select 1 from public.seguimientos_calidad where tipo=p_tipo and finalizado_en is null) then
  raise exception using errcode='23505',message='Ya existe un seguimiento activo. Actualiza el Dashboard.';
 end if;
 insert into public.avisos(id,mensaje,permanente,creado_por) values(p_id,nota,true,auth.uid());
 insert into public.seguimientos_calidad(id,tipo,aviso_id,instruccion,instruccion_inicial,creado_por)
 values(p_id,p_tipo,p_id,nota,nota,auth.uid());
 return p_id;
end;
$f$;

create function public.finalizar_seguimiento_calidad(p_id uuid)
returns uuid language plpgsql security definer set search_path='' as $f$
declare s public.seguimientos_calidad%rowtype;
begin
 if auth.uid() is null or not coalesce(private.es_admin(),false) then
  raise exception using errcode='42501',message='Solo Administración puede finalizar el seguimiento.';
 end if;
 -- Aviso antes de seguimiento, igual que su edición manual y las lecturas.
 select * into s from public.seguimientos_calidad where id=p_id;
 if not found or s.creado_por<>auth.uid() then
  raise exception using errcode='42501',message='Solo el creador del aviso puede finalizar el seguimiento.';
 end if;
 if s.finalizado_en is not null then return p_id; end if;
 update public.avisos set permanente=false,inicio=null,fin=clock_timestamp() where id=s.aviso_id;
 update public.seguimientos_calidad set finalizado_en=clock_timestamp() where id=p_id and finalizado_en is null;
 return p_id;
end;
$f$;

create function public.guardar_lectura_seguimiento_calidad(p_id uuid,p_turno uuid,p_seguimiento uuid,p_valor numeric)
returns uuid language plpgsql security definer set search_path='' as $f$
declare s public.seguimientos_calidad%rowtype; c private.tipos_seguimiento_calidad%rowtype;
 t public.turnos_operativos%rowtype; m public.muestras_calidad%rowtype;
 instante timestamptz; previo text;
begin
 if auth.uid() is null or private.rol_actual()::text is distinct from 'calderas' then
  raise exception using errcode='42501',message='Se requiere la cuenta activa de Calderas.';
 end if;
 if p_id is null or p_turno is null or p_seguimiento is null or p_valor is null
  or p_valor::text in ('NaN','Infinity','-Infinity') or abs(p_valor)>9007199254740991 then
  raise exception using errcode='22023',message='Escribe un valor numérico válido.';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('copamex.muestras_calidad:'||p_id::text,0));
 select * into m from public.muestras_calidad where id=p_id;
 if found then
  if m.turno_id<>p_turno or m.seguimiento_id is distinct from p_seguimiento
   or m.creado_por<>auth.uid() or m.seguimiento_valor_inicial is distinct from p_valor then
   raise exception using errcode='23505',message='El identificador corresponde a otra lectura.';
  end if;
  return p_id; -- Confirmar no inserta otra muestra ni reabre el seguimiento.
 end if;
 select * into s from public.seguimientos_calidad where id=p_seguimiento;
 if not found or s.finalizado_en is not null then
  raise exception using errcode='42501',message='El seguimiento ya no está activo.';
 end if;
 select * into c from private.tipos_seguimiento_calidad where tipo=s.tipo;
 -- Bloquear el aviso durante la validación para no capturar mientras se finaliza.
 perform 1 from public.avisos a where a.id=s.aviso_id
  and (a.inicio is null or a.inicio<=clock_timestamp())
  and (a.permanente or a.fin is null or a.fin>clock_timestamp()) for share;
 if not found then raise exception using errcode='42501',message='El aviso del seguimiento ya no está activo.'; end if;
 select * into s from public.seguimientos_calidad where id=p_seguimiento for share;
 if s.finalizado_en is not null then
  raise exception using errcode='42501',message='El seguimiento ya no está activo.';
 end if;
 select * into t from public.turnos_operativos where id=p_turno for share;
 instante:=clock_timestamp();
 if not found or t.finalizado_en is not null or t.area<>c.area or t.iniciado_por<>auth.uid()
  or not private.bt_operador_en_turno(t,instante) then
  raise exception using errcode='42501',message='La lectura requiere tu turno abierto dentro de su horario.';
 end if;
 if not exists(select 1 from public.muestras_calidad where turno_id=t.id
  and seguimiento_id is null and eliminado_en is null) then
  raise exception using errcode='22023',message='Registra primero la muestra habitual de Calidad del turno.';
 end if;
 if not exists(select 1 from public.puntos_muestreo where id=c.punto_id and activo
  and (area is null or area=t.area))
  or not exists(select 1 from public.parametros_calidad where id=c.parametro_id and activo) then
  raise exception using errcode='22023',message='El punto o parámetro de seguimiento no está habilitado.';
 end if;
 previo:=current_setting('copamex.seguimiento_calidad',true);
 perform set_config('copamex.seguimiento_calidad',p_id::text,true);
 insert into public.muestras_calidad(id,turno_id,hora_muestra,capturado_en,creado_por,seguimiento_id,seguimiento_valor_inicial)
 values(p_id,t.id,(instante at time zone 'America/Mexico_City')::time,instante,auth.uid(),s.id,p_valor);
 perform set_config('copamex.seguimiento_calidad',coalesce(previo,''),true);
 insert into public.resultados_calidad(id,muestra_id,punto_id,parametro_id,valor)
 values(gen_random_uuid(),p_id,c.punto_id,c.parametro_id,p_valor);
 return p_id;
end;
$f$;

do $acl$ declare firma text; begin
 foreach firma in array array[
  'private.proteger_identidad_seguimiento()','private.sincronizar_aviso_seguimiento()',
  'public.consultar_seguimiento_calidad(text)','public.activar_seguimiento_calidad(uuid,text,text)',
  'public.finalizar_seguimiento_calidad(uuid)','public.guardar_lectura_seguimiento_calidad(uuid,uuid,uuid,numeric)'
 ] loop
  execute 'alter function '||firma||' owner to postgres';
  execute 'revoke all on function '||firma||' from public,anon,authenticated,service_role';
 end loop;
 grant execute on function public.consultar_seguimiento_calidad(text),
  public.activar_seguimiento_calidad(uuid,text,text),public.finalizar_seguimiento_calidad(uuid),
  public.guardar_lectura_seguimiento_calidad(uuid,uuid,uuid,numeric) to authenticated;
end; $acl$;
notify pgrst,'reload schema';
commit;
