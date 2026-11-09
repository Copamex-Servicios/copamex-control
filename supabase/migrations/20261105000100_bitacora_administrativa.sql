-- Preparada localmente. Aplicar solo con autorización; no cambia permisos de otros módulos.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table public.bitacora_administrativa (
  id uuid primary key,
  area text not null check (area in ('ptar', 'calderas', 'obra_civil')),
  actividad text not null check (length(btrim(actividad)) between 1 and 10000 and actividad ~ '[^[:space:]]'),
  fecha date not null,
  creado_en timestamptz not null,
  creado_por uuid not null references auth.users(id),
  actualizado_en timestamptz not null,
  actualizado_por uuid not null references auth.users(id),
  revision integer not null default 0 check (revision >= 0)
);
create index bitacora_administrativa_mes_idx on public.bitacora_administrativa(fecha, creado_en desc, id desc);
create index bitacora_administrativa_area_idx on public.bitacora_administrativa(area, creado_en desc, id desc);
create index bitacora_administrativa_actualizada_idx on public.bitacora_administrativa(actualizado_en desc);
alter table public.bitacora_administrativa enable row level security;
revoke all on public.bitacora_administrativa from public, anon, authenticated;
-- La consulta directa tampoco revela identidades de auditoría ni Obra Civil a otros roles.
grant select(id, area, actividad, fecha, creado_en, actualizado_en, revision)
  on public.bitacora_administrativa to authenticated;
create policy lectura_bitacora_administrativa on public.bitacora_administrativa
  for select to authenticated using (
    (select private.es_admin()) or (
      (select private.rol_actual())::text in ('calderas','ptar','calidad')
      and area in ('calderas','ptar')
    )
  );
create trigger auditar_bitacora_administrativa
  after insert or update or delete on public.bitacora_administrativa
  for each row execute function private.registrar_auditoria();
-- Sin INSERT/UPDATE/DELETE/TRUNCATE para cuentas de aplicación: escritura solo por RPC.
-- Sin eliminación permanente en la aplicación. La auditoría existente conserva antes/después.
create table private.bitacora_administrativa_solicitudes (
  id uuid primary key,
  cuenta uuid not null references auth.users(id),
  datos jsonb not null,
  respuesta jsonb not null,
  creado_en timestamptz not null default clock_timestamp()
);
alter table private.bitacora_administrativa_solicitudes enable row level security;
-- Sin políticas para clientes: solo la RPC SECURITY DEFINER del propietario accede.
revoke all on private.bitacora_administrativa_solicitudes from public, anon, authenticated;

create function public.guardar_bitacora_administrativa(
  p_solicitud uuid, p_id uuid, p_area text, p_actividad text, p_revision integer default null
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $funcion$
declare
  cuenta uuid := auth.uid(); hora timestamptz; r public.bitacora_administrativa%rowtype;
  previa private.bitacora_administrativa_solicitudes%rowtype;
  datos jsonb; respuesta jsonb; texto text := btrim(p_actividad);
begin
  if cuenta is null or not private.es_admin() then
    raise exception using errcode = '42501', message = 'Solo Administración puede registrar o corregir actividades.';
  end if;
  if p_solicitud is null or p_id is null or p_area is null
    or p_area not in ('ptar','calderas','obra_civil') or texto is null
    or length(texto) not between 1 and 10000 or texto !~ '[^[:space:]]' or p_revision < 0 then
    raise exception using errcode = '22023', message = 'Selecciona un área y escribe una actividad válida.';
  end if;
  datos := jsonb_build_object('id',p_id,'area',p_area,'actividad',texto,'revision',p_revision);
  perform pg_advisory_xact_lock(hashtextextended('copamex:ba:' || p_solicitud::text, 0));
  select * into previa from private.bitacora_administrativa_solicitudes where id = p_solicitud;
  if found then
    if previa.cuenta <> cuenta or previa.datos <> datos then
      raise exception using errcode = '22023', message = 'La solicitud ya corresponde a otros datos.';
    end if;
    return previa.respuesta;
  end if;
  hora := clock_timestamp();
  if p_revision is null then
    insert into public.bitacora_administrativa
      (id,area,actividad,fecha,creado_en,creado_por,actualizado_en,actualizado_por)
    values (p_id,p_area,texto,(hora at time zone 'America/Mexico_City')::date,hora,cuenta,hora,cuenta)
    returning * into r;
  else
    -- Revisión optimista: no sobrescribir una corrección de otro administrador.
    update public.bitacora_administrativa set area=p_area, actividad=texto,
      actualizado_en=hora, actualizado_por=cuenta, revision=revision+1
    where id=p_id and revision=p_revision returning * into r;
    if not found then
      raise exception using errcode = '40001', message = 'La actividad cambió. Actualiza el historial antes de corregirla.';
    end if;
  end if;
  respuesta := jsonb_build_object('id',r.id,'area',r.area,'actividad',r.actividad,'fecha',r.fecha,
    'creado_en',r.creado_en,'actualizado_en',r.actualizado_en,'revision',r.revision);
  insert into private.bitacora_administrativa_solicitudes(id,cuenta,datos,respuesta)
    values(p_solicitud,cuenta,datos,respuesta);
  return respuesta;
end;
$funcion$;
alter function public.guardar_bitacora_administrativa(uuid,uuid,text,text,integer) owner to postgres;
revoke all on function public.guardar_bitacora_administrativa(uuid,uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.guardar_bitacora_administrativa(uuid,uuid,text,text,integer) to authenticated;

create function public.consultar_bitacora_administrativa(
  p_mes text default null, p_area text default 'todas', p_recientes boolean default false,
  p_antes timestamptz default null, p_antes_id uuid default null, p_limite integer default 25
)
returns jsonb language plpgsql stable security invoker set search_path = '' as $funcion$
declare
  rol text := private.rol_actual()::text;
  mes text := coalesce(p_mes, to_char(statement_timestamp() at time zone 'America/Mexico_City','YYYY-MM'));
  desde date; salida jsonb;
begin
  if auth.uid() is null or not coalesce(rol in ('admin','calderas','ptar','calidad'),false)
    or (p_area = 'obra_civil' and rol <> 'admin') then
    raise exception using errcode='42501', message='No tienes acceso a estas actividades.';
  end if;
  if mes !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or left(mes,4)='0000'
    or p_area is null or p_area not in ('todas','calderas','ptar','obra_civil')
    or p_recientes is null or p_limite is null or p_limite not between 1 and 100
    or (p_antes is null) <> (p_antes_id is null) then
    raise exception using errcode='22023', message='Filtros de bitácora inválidos.';
  end if;
  desde := (mes || '-01')::date;
  with base as not materialized (
    select id,area,actividad,fecha,creado_en,actualizado_en,revision
    from public.bitacora_administrativa
    where (p_recientes or (fecha >= desde and fecha < (desde + interval '1 month')::date))
      and (p_area='todas' or area=p_area)
  ), pagina as (
    select * from base where p_antes is null or (creado_en,id) < (p_antes,p_antes_id)
    order by creado_en desc,id desc limit p_limite+1
  ), numeradas as (
    select *,row_number() over(order by creado_en desc,id desc) n from pagina
  )
  select jsonb_build_object(
    'filas',coalesce(jsonb_agg(to_jsonb(numeradas)-'n' order by n) filter(where n<=p_limite),'[]'::jsonb),
    'mas',count(*)>p_limite,'mes',mes,'ahora',statement_timestamp(),
    'version',(select actualizado_en from base order by actualizado_en desc limit 1)
  ) into salida from numeradas;
  return salida;
end;
$funcion$;
alter function public.consultar_bitacora_administrativa(text,text,boolean,timestamptz,uuid,integer) owner to postgres;
revoke all on function public.consultar_bitacora_administrativa(text,text,boolean,timestamptz,uuid,integer) from public,anon,authenticated;
grant execute on function public.consultar_bitacora_administrativa(text,text,boolean,timestamptz,uuid,integer) to authenticated;
notify pgrst, 'reload schema';
commit;
