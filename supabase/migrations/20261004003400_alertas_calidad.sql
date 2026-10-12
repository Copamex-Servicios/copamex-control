-- Alertas de Calidad: episodios con datos originales y atención administrativa.
-- Una corrección no elimina ni cierra la alerta: marca su origen como corregido.
-- Si el valor corregido continúa fuera de norma, crea un episodio nuevo.
begin;
alter table public.alertas_operativas add column if not exists detalle jsonb not null default '{}'::jsonb;
alter table public.alertas_operativas add column if not exists origen_estado text not null default 'vigente';
alter table public.alertas_operativas add column if not exists actualizado_en timestamptz not null default clock_timestamp();
create unique index if not exists alerta_calidad_episodio_vigente on public.alertas_operativas(registro_id)
  where modulo='calidad' and tipo='calidad_fuera_norma_v1' and origen_estado='vigente';

create table if not exists public.atenciones_alerta (
  id uuid primary key,
  alerta_id uuid not null references public.alertas_operativas(id),
  accion text not null check(accion in ('reconocer','cerrar')),
  estado_anterior public.estado_alerta not null,
  estado_nuevo public.estado_alerta not null,
  version_esperada timestamptz not null,
  comentario text not null check(length(trim(comentario)) between 1 and 4000),
  creado_por uuid not null references auth.users(id),
  responsable_nombre text not null,
  creado_en timestamptz not null default clock_timestamp()
);
create index if not exists atenciones_alerta_origen on public.atenciones_alerta(alerta_id,creado_en,id);
alter table public.atenciones_alerta enable row level security;
revoke all on public.atenciones_alerta from public,anon,authenticated;
grant select on public.atenciones_alerta to authenticated;
drop policy if exists lectura_atenciones on public.atenciones_alerta;
create policy lectura_atenciones on public.atenciones_alerta for select to authenticated
  using ((select private.rol_actual()) is not null);
drop trigger if exists auditar_cambios on public.atenciones_alerta;
create trigger auditar_cambios after insert or update or delete on public.atenciones_alerta
  for each row execute function private.registrar_auditoria();

create or replace function private.proteger_alerta_calidad() returns trigger language plpgsql set search_path='' as $$
begin
  if row(new.id,new.modulo,new.registro_id,new.tipo,new.mensaje,new.valor,new.limite,new.creado_en,new.detalle)
    is distinct from row(old.id,old.modulo,old.registro_id,old.tipo,old.mensaje,old.valor,old.limite,old.creado_en,old.detalle) then
    raise exception using errcode='42501',message='Los datos originales de la alerta se conservan.';
  end if;
  if new.origen_estado not in ('vigente','corregido','anulado') then
    raise exception using errcode='22023',message='Estado de origen inválido.';
  end if;
  new.actualizado_en := greatest(clock_timestamp(),old.actualizado_en+interval '1 microsecond');
  return new;
end;
$$;
alter function private.proteger_alerta_calidad() owner to postgres;
revoke all on function private.proteger_alerta_calidad() from public,anon,authenticated;
drop trigger if exists proteger_alerta_calidad on public.alertas_operativas;
create trigger proteger_alerta_calidad before update on public.alertas_operativas
  for each row when (old.tipo='calidad_fuera_norma_v1') execute function private.proteger_alerta_calidad();
drop trigger if exists conservar_alertas on public.alertas_operativas;
create trigger conservar_alertas before delete on public.alertas_operativas
  for each row execute function private.impedir_borrado_operativo();
drop trigger if exists conservar_atenciones on public.atenciones_alerta;
create trigger conservar_atenciones before update or delete on public.atenciones_alerta
  for each row execute function private.impedir_borrado_operativo();

drop trigger if exists conservar_alertas_truncate on public.alertas_operativas;
create trigger conservar_alertas_truncate before truncate on public.alertas_operativas
  for each statement execute function private.impedir_borrado_operativo();
drop trigger if exists conservar_atenciones_truncate on public.atenciones_alerta;
create trigger conservar_atenciones_truncate before truncate on public.atenciones_alerta
  for each statement execute function private.impedir_borrado_operativo();

create or replace function private.crear_alerta_calidad(p_resultado uuid,p_historica boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare d record; limite numeric;
begin
  select r.*,m.turno_id,m.capturado_en,m.creado_por,m.eliminado_en,t.area,t.turno,t.fecha_operativa,
    o.nombre as operador,o.id as operador_id,p.nombre as punto,q.nombre as parametro,q.unidad
  into d from public.resultados_calidad r
    join public.muestras_calidad m on m.id=r.muestra_id
    join public.turnos_operativos t on t.id=m.turno_id
    join public.operadores o on o.id=t.operador_id
    join public.puntos_muestreo p on p.id=r.punto_id
    join public.parametros_calidad q on q.id=r.parametro_id where r.id=p_resultado;
  if not found or d.fuera_norma is distinct from true or d.eliminado_en is not null then return; end if;
  limite := case when d.limite_min_aplicado is not null and d.valor<d.limite_min_aplicado
    then d.limite_min_aplicado else d.limite_max_aplicado end;
  insert into public.alertas_operativas(modulo,registro_id,tipo,mensaje,valor,limite,detalle,creado_en,actualizado_en)
  values('calidad',d.id,'calidad_fuera_norma_v1',d.punto||' · '||d.parametro||' fuera de norma',d.valor,limite,
    jsonb_build_object('muestra_id',d.muestra_id,'turno_id',d.turno_id,'operador_id',d.operador_id,
      'operador',d.operador,'area',d.area,'turno',d.turno,'fecha_operativa',d.fecha_operativa,
      'capturado_en',d.capturado_en,'cuenta_captura',d.creado_por,'punto_id',d.punto_id,'punto',d.punto,
      'parametro_id',d.parametro_id,'parametro',d.parametro,'unidad',d.unidad,
      'limite_min',d.limite_min_aplicado,'limite_max',d.limite_max_aplicado,'historica',p_historica),
    clock_timestamp(),clock_timestamp())
  on conflict(registro_id) where modulo='calidad' and tipo='calidad_fuera_norma_v1' and origen_estado='vigente' do nothing;
end;
$$;
alter function private.crear_alerta_calidad(uuid,boolean) owner to postgres;
revoke all on function private.crear_alerta_calidad(uuid,boolean) from public,anon,authenticated;

create or replace function private.alerta_resultado_calidad() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if new.valor is not distinct from old.valor then return new; end if;
    update public.alertas_operativas set origen_estado='corregido'
      where registro_id=new.id and tipo='calidad_fuera_norma_v1' and origen_estado='vigente';
  end if;
  perform private.crear_alerta_calidad(new.id,false);
  return new;
end;
$$;
alter function private.alerta_resultado_calidad() owner to postgres;
revoke all on function private.alerta_resultado_calidad() from public,anon,authenticated;
drop trigger if exists generar_alerta_resultado on public.resultados_calidad;
create trigger generar_alerta_resultado after insert or update of valor on public.resultados_calidad
  for each row execute function private.alerta_resultado_calidad();
create or replace function private.alerta_muestra_anulada() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.eliminado_en is not null and old.eliminado_en is null then
    update public.alertas_operativas a set origen_estado='anulado'
      where a.tipo='calidad_fuera_norma_v1' and a.origen_estado <> 'anulado'
        and a.registro_id in (select id from public.resultados_calidad where muestra_id=new.id);
  end if;
  return new;
end;
$$;
alter function private.alerta_muestra_anulada() owner to postgres;
revoke all on function private.alerta_muestra_anulada() from public,anon,authenticated;
drop trigger if exists marcar_alerta_muestra_anulada on public.muestras_calidad;
create trigger marcar_alerta_muestra_anulada after update of eliminado_en on public.muestras_calidad
  for each row execute function private.alerta_muestra_anulada();

create or replace function public.atender_alerta_calidad(
  p_id uuid,p_alerta_id uuid,p_estado_esperado public.estado_alerta,
  p_version_esperada timestamptz,p_accion text,p_comentario text
) returns uuid language plpgsql security definer set search_path='' as $$
declare a public.alertas_operativas%rowtype; e public.atenciones_alerta%rowtype;
  nuevo public.estado_alerta; hora timestamptz; nombre text;
begin
  if auth.uid() is null or not private.es_admin() then
    raise exception using errcode='42501',message='Solo un administrador activo puede atender alertas.';
  end if;
  if p_id is null or p_alerta_id is null or p_estado_esperado is null or p_version_esperada is null
    or p_accion is null or p_accion not in ('reconocer','cerrar') or p_comentario is null
    or length(trim(p_comentario)) not between 1 and 4000 then
    raise exception using errcode='22023',message='Escribe un comentario de atención y revisa la acción.';
  end if;
  select * into a from public.alertas_operativas where id=p_alerta_id and tipo='calidad_fuera_norma_v1' for update;
  if not found then raise exception using errcode='22023',message='No se encontró la alerta de Calidad.'; end if;
  select * into e from public.atenciones_alerta where id=p_id;
  if found then
    if e.alerta_id=p_alerta_id and e.creado_por=auth.uid() and e.accion=p_accion
      and e.comentario=trim(p_comentario) and e.estado_anterior=p_estado_esperado and e.version_esperada=p_version_esperada then return p_id; end if;
    raise exception using errcode='23505',message='Este identificador pertenece a otra solicitud.';
  end if;
  if a.estado is distinct from p_estado_esperado or a.actualizado_en is distinct from p_version_esperada then
    raise exception using errcode='40001',message='La alerta cambió. Actualiza y revisa antes de atenderla.';
  end if;
  if p_accion='reconocer' and a.estado='abierta' then nuevo:='reconocida';
  elsif p_accion='cerrar' and a.estado='reconocida' then nuevo:='cerrada';
  else raise exception using errcode='22023',message='Primero reconoce una alerta abierta; solo una reconocida puede cerrarse.'; end if;
  hora:=clock_timestamp();
  select p.nombre into strict nombre from public.perfiles p where p.id=auth.uid() and p.activo;
  insert into public.atenciones_alerta(id,alerta_id,accion,estado_anterior,estado_nuevo,version_esperada,comentario,creado_por,responsable_nombre,creado_en)
    values(p_id,p_alerta_id,p_accion,a.estado,nuevo,p_version_esperada,trim(p_comentario),auth.uid(),nombre,hora);
  update public.alertas_operativas set estado=nuevo,comentario=trim(p_comentario),
    reconocido_por=case when p_accion='reconocer' then auth.uid() else reconocido_por end,
    reconocido_en=case when p_accion='reconocer' then hora else reconocido_en end,
    cerrado_por=case when p_accion='cerrar' then auth.uid() else cerrado_por end,
    cerrado_en=case when p_accion='cerrar' then hora else cerrado_en end where id=p_alerta_id;
  return p_id;
end;
$$;
alter function public.atender_alerta_calidad(uuid,uuid,public.estado_alerta,timestamptz,text,text) owner to postgres;
revoke all on function public.atender_alerta_calidad(uuid,uuid,public.estado_alerta,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.atender_alerta_calidad(uuid,uuid,public.estado_alerta,timestamptz,text,text) to authenticated;
-- La generación es interna; ninguna cuenta cliente escribe alertas directamente.
revoke insert,update,delete,truncate on public.alertas_operativas from public,anon,authenticated;

-- Recuperar hallazgos existentes sin duplicar: se identifican como carga histórica.
do $$ declare r record; begin
  for r in select r.id from public.resultados_calidad r join public.muestras_calidad m on m.id=r.muestra_id
    where r.fuera_norma and m.eliminado_en is null and not exists(
      select 1 from public.alertas_operativas a where a.registro_id=r.id and a.tipo='calidad_fuera_norma_v1')
  loop perform private.crear_alerta_calidad(r.id,true); end loop;
end; $$;
-- Autocomprobación transaccional: los datos ficticios y su auditoría se revierten.
-- No abre, cierra ni modifica turnos o capturas reales.
do $
declare
  ua uuid:=gen_random_uuid(); uc uuid:=gen_random_uuid(); aid uuid:=gen_random_uuid(); rid uuid:=gen_random_uuid();
  e1 uuid:=gen_random_uuid(); e2 uuid:=gen_random_uuid(); ver timestamptz; ver2 timestamptz;
  original jsonb; rechazado boolean; terminada boolean:=false; firma text:='public.atender_alerta_calidad(uuid,uuid,public.estado_alerta,timestamptz,text,text)';
  jwt_sub text:=current_setting('request.jwt.claim.sub',true); jwt_claims text:=current_setting('request.jwt.claims',true);
begin
  if current_user<>'postgres' then raise exception 'Ejecuta el archivo completo como postgres en SQL Editor.'; end if;
  if not has_function_privilege('authenticated',firma,'EXECUTE') or has_function_privilege('anon',firma,'EXECUTE')
    or has_table_privilege('authenticated','public.alertas_operativas','UPDATE')
    or has_table_privilege('authenticated','public.atenciones_alerta','INSERT')
    or not exists(select 1 from pg_catalog.pg_class where oid='public.atenciones_alerta'::regclass and relrowsecurity)
    then raise exception 'Permisos de Alertas inesperados.'; end if;
  begin
    perform set_config('request.jwt.claim.sub','',true); perform set_config('request.jwt.claims','{}',true);
    insert into auth.users(id,aud,role,email,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
      select u,'authenticated','authenticated','prueba-alerta-'||u::text||'@example.invalid',clock_timestamp(),clock_timestamp(),'{}','{}' from unnest(array[ua,uc]) x(u);
    insert into public.perfiles(id,nombre,rol,activo) values (ua,'PRUEBA ALERTA ADMIN','admin',true),(uc,'PRUEBA ALERTA OPERADOR','calderas',true);
    insert into public.alertas_operativas(id,modulo,registro_id,tipo,mensaje,valor,limite,detalle)
      values(aid,'calidad',rid,'calidad_fuera_norma_v1','PRUEBA TRANSACCIONAL',55,30,'{"historica":true,"limite_max":30}'::jsonb);
    select actualizado_en,to_jsonb(a) into ver,original from public.alertas_operativas a where id=aid;
    -- Incluso ejecutando como postgres, el RPC verifica la cuenta real del JWT.
    perform set_config('request.jwt.claim.sub',uc::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',uc,'role','authenticated')::text,true);
    rechazado:=false;
    begin perform public.atender_alerta_calidad(e1,aid,'abierta',ver,'reconocer','Revisión'); exception when insufficient_privilege then rechazado:=true; end;
    if not rechazado then raise exception 'Un operador pudo atender.'; end if;
    perform set_config('request.jwt.claim.sub',ua::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',ua,'role','authenticated')::text,true);
    rechazado:=false;
    begin perform public.atender_alerta_calidad(e1,aid,'abierta',ver,'cerrar','Cierre directo'); exception when invalid_parameter_value then rechazado:=true; end;
    if not rechazado then raise exception 'Se permitió cierre directo.'; end if;
    rechazado:=false;
    begin perform public.atender_alerta_calidad(e1,aid,'abierta',ver,'reconocer','  '); exception when invalid_parameter_value then rechazado:=true; end;
    if not rechazado then raise exception 'Se permitió comentario vacío.'; end if;
    perform public.atender_alerta_calidad(e1,aid,'abierta',ver,'reconocer','Revisión y responsable');
    perform public.atender_alerta_calidad(e1,aid,'abierta',ver,'reconocer','Revisión y responsable');
    if (select count(*) from public.atenciones_alerta where alerta_id=aid)<>1 then raise exception 'Reintento duplicado.'; end if;
    select actualizado_en into ver2 from public.alertas_operativas where id=aid;
    if ver2<=ver then raise exception 'La versión no avanzó.'; end if;
    rechazado:=false;
    begin perform public.atender_alerta_calidad(e2,aid,'abierta',ver,'reconocer','Versión anterior'); exception when serialization_failure then rechazado:=true; end;
    if not rechazado then raise exception 'Se aceptó una versión anterior.'; end if;
    rechazado:=false;
    begin perform public.atender_alerta_calidad(e1,aid,'abierta',ver,'reconocer','Otro comentario'); exception when unique_violation then rechazado:=true; end;
    if not rechazado then raise exception 'Se reutilizó el UUID con otros datos.'; end if;
    rechazado:=false;
    begin update public.alertas_operativas set valor=0 where id=aid; exception when insufficient_privilege then rechazado:=true; end;
    if not rechazado then raise exception 'Se modificó el valor original.'; end if;
    perform public.atender_alerta_calidad(e2,aid,'reconocida',ver2,'cerrar','Acción realizada y cierre');
    perform public.atender_alerta_calidad(e1,aid,'abierta',ver,'reconocer','Revisión y responsable');
    if not exists(select 1 from public.alertas_operativas a where id=aid and estado='cerrada' and reconocido_por=ua and cerrado_por=ua
      and a.valor=(original->>'valor')::numeric and a.limite=(original->>'limite')::numeric and a.detalle=original->'detalle')
      or (select count(*) from public.atenciones_alerta where alerta_id=aid)<>2 then raise exception 'Cierre o conservación incorrectos.'; end if;
    rechazado:=false;
    begin update public.atenciones_alerta set comentario='Modificado' where id=e1; exception when others then rechazado:=true; end;
    if not rechazado then raise exception 'Atención editable.'; end if;
    rechazado:=false;
    begin delete from public.alertas_operativas where id=aid; exception when others then rechazado:=true; end;
    if not rechazado then raise exception 'Alerta borrable.'; end if;
    if not exists(select 1 from public.auditoria where tabla='public.atenciones_alerta' and registro_id=e1::text and usuario=ua) then raise exception 'Falta auditoría de la atención.'; end if;
    terminada:=true;
    raise exception using errcode='ZX034',message='Rollback intencional de fixtures';
  exception when sqlstate 'ZX034' then null;
  end;
  if not terminada or exists(select 1 from auth.users where id in(ua,uc))
    or exists(select 1 from public.alertas_operativas where id=aid)
    or exists(select 1 from public.atenciones_alerta where alerta_id=aid)
    or exists(select 1 from public.auditoria where registro_id in(aid::text,e1::text,e2::text,ua::text,uc::text))
    then raise exception 'La autocomprobación dejó datos de prueba.'; end if;
  perform set_config('request.jwt.claim.sub',coalesce(jwt_sub,''),true); perform set_config('request.jwt.claims',coalesce(jwt_claims,'{}'),true);
end;
$;

commit;
select 'Alertas de Calidad' as comprobacion,'APROBADA' as resultado,
 'Instalación y autocomprobación: permisos, estados, reintentos, versiones, conservación, auditoría y rollback de fixtures.' as detalle;
