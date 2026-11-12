-- COPAMEX: dos operadores identificados en turnos nuevos.
-- Historial anterior conserva operador_acompanante_id = NULL.
-- No modifica lecturas, cuentas, roles, RLS ni datos ya guardados.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table public.turnos_operativos
  add column if not exists operador_acompanante_id uuid;

do $constraint$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.turnos_operativos'::regclass
      and conname = 'turnos_operativos_operador_acompanante_id_fkey'
  ) then
    alter table public.turnos_operativos
      add constraint turnos_operativos_operador_acompanante_id_fkey
      foreign key (operador_acompanante_id) references public.operadores(id);
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.turnos_operativos'::regclass
      and conname = 'turnos_operativos_operadores_distintos'
  ) then
    alter table public.turnos_operativos
      add constraint turnos_operativos_operadores_distintos
      check (operador_acompanante_id is null or operador_acompanante_id <> operador_id) not valid;
  end if;
end;
$constraint$;
alter table public.turnos_operativos validate constraint turnos_operativos_operadores_distintos;

-- Conserva las protecciones del turno y evita que el área cambie la pareja después del inicio.
create or replace function private.proteger_turno_operativo()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  es_administrador boolean;
  rol_cuenta public.rol_usuario;
  ultima_captura timestamptz;
begin
  es_administrador := current_user in ('postgres', 'service_role');
  if not es_administrador then es_administrador := private.es_admin(); end if;

  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.iniciado_por := auth.uid(); end if;
    if not es_administrador then
      rol_cuenta := private.rol_actual();
      if not coalesce(rol_cuenta in ('calderas', 'ptar'), false) then
        raise exception using errcode = '42501', message = 'Solo una cuenta de área activa puede iniciar un turno.';
      end if;
      new.area := rol_cuenta::text::public.area_planta;
      if not exists (select 1 from public.operadores where id = new.operador_id and activo)
        or not exists (select 1 from public.operadores where id = new.operador_acompanante_id and activo)
      then
        raise exception using errcode = '22023', message = 'Selecciona dos operadores activos.';
      end if;
    end if;
    if new.iniciado_en > clock_timestamp() then
      raise exception using errcode = '22023', message = 'La hora de inicio del turno no puede estar en el futuro.';
    end if;
  else
    if row(new.id, new.fecha_operativa, new.area, new.turno, new.iniciado_por, new.iniciado_en)
      is distinct from row(old.id, old.fecha_operativa, old.area, old.turno, old.iniciado_por, old.iniciado_en)
    then
      raise exception using errcode = '42501', message = 'La identidad, fecha, área, tipo, cuenta y hora original del turno se conservan.';
    end if;
    if new is not distinct from old then return new; end if;
    if not es_administrador then
      if new.operador_id is distinct from old.operador_id
        or new.operador_acompanante_id is distinct from old.operador_acompanante_id
      then
        raise exception using errcode = '42501', message = 'La cuenta del área no puede cambiar los operadores de un turno iniciado.';
      end if;
      if old.finalizado_en is not null then
        raise exception using errcode = '42501', message = 'Un turno cerrado solo puede ser ajustado por un administrador.';
      end if;
    end if;
  end if;

  if new.finalizado_en is not null then
    if new.finalizado_en > clock_timestamp() then
      raise exception using errcode = '22023', message = 'La hora de cierre del turno no puede estar en el futuro.';
    end if;
    if tg_op = 'UPDATE' then
      select max(c.capturado_en) into ultima_captura from (
        select capturado_en from public.bitacora where turno_id = old.id and eliminado_en is null
        union all select capturado_en from public.lecturas_pozos where turno_id = old.id and eliminado_en is null
        union all select capturado_en from public.lecturas_uf where turno_id = old.id and eliminado_en is null
        union all select capturado_en from public.lecturas_ptar where turno_id = old.id and eliminado_en is null
        union all select capturado_en from public.muestras_calidad where turno_id = old.id and eliminado_en is null
      ) c;
      if ultima_captura is not null and new.finalizado_en < ultima_captura then
        raise exception using errcode = '22023', message = 'El cierre no puede ser anterior a las capturas del turno.';
      end if;
    end if;
  end if;
  return new;
end;
$function$;
alter function private.proteger_turno_operativo() owner to postgres;
revoke all on function private.proteger_turno_operativo() from public, anon, authenticated;

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

alter function public.iniciar_turno_pareja_empleado(uuid, public.turno_tipo, text, uuid, text, text, uuid, text, uuid) owner to postgres;
revoke all on function public.iniciar_turno_pareja_empleado(uuid, public.turno_tipo, text, uuid, text, text, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.iniciar_turno_pareja_empleado(uuid, public.turno_tipo, text, uuid, text, text, uuid, text, uuid) to authenticated;

-- Impide omitir la pareja llamando directamente a las RPC anteriores.
revoke all on function public.iniciar_turno_empleado(uuid, public.turno_tipo, text, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.iniciar_turno(uuid, public.turno_tipo, text, uuid) from public, anon, authenticated;
revoke all on function public.iniciar_turno(uuid, date, public.turno_tipo, text, uuid) from public, anon, authenticated;

create or replace function public.consultar_bitacoras_tecnicas_planta(
  p_desde date,
  p_hasta date,
  p_area text default 'todas',
  p_turno text default 'todos',
  p_limite integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare salida jsonb;
begin
  if auth.uid() is null or not coalesce(private.rol_actual()::text in ('admin','calderas','ptar'), false) then
    raise exception using errcode = '42501', message = 'Se requiere una cuenta activa de Calderas, PTAR o Administración.';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde
    or p_area is null or p_area not in ('todas','calderas','ptar')
    or p_turno is null or p_turno not in ('todos','dia','tarde','noche')
    or p_limite is null or p_limite not between 1 and 100 or p_offset is null or p_offset < 0
  then raise exception using errcode = '22023', message = 'Filtros o paginación inválidos.'; end if;
  with reportes as (
    select 'bitacora_calderas'::text modulo,r.id,r.turno_id,r.creado_en,r.creado_por,r.revision from public.bitacora_calderas r
    union all
    select 'bitacora_ptar',r.id,r.turno_id,r.creado_en,r.creado_por,r.revision from public.bitacora_ptar r
  ), elegidos as (
    select r.*,t.fecha_operativa,t.area,t.turno,t.operador_id,o.nombre as operador,
      t.operador_acompanante_id,oa.nombre as operador_acompanante
    from reportes r
    join public.turnos_operativos t on t.id = r.turno_id
    join public.operadores o on o.id = t.operador_id
    left join public.operadores oa on oa.id = t.operador_acompanante_id
    where t.fecha_operativa between p_desde and p_hasta
      and (p_area = 'todas' or t.area::text = p_area)
      and (p_turno = 'todos' or t.turno::text = p_turno)
    order by t.fecha_operativa desc,r.creado_en desc,r.modulo,r.id
    limit p_limite + 1 offset p_offset
  ), numerados as (
    select e.*,row_number() over(order by e.fecha_operativa desc,e.creado_en desc,e.modulo,e.id) n from elegidos e
  )
  select jsonb_build_object(
    'filas',coalesce(jsonb_agg(to_jsonb(numerados)-'n' order by n) filter(where n <= p_limite),'[]'::jsonb),
    'mas',count(*) > p_limite
  ) into salida from numerados;
  return salida;
end;
$function$;
alter function public.consultar_bitacoras_tecnicas_planta(date, date, text, text, integer, integer) owner to postgres;
revoke all on function public.consultar_bitacoras_tecnicas_planta(date, date, text, text, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.consultar_bitacoras_tecnicas_planta(date, date, text, text, integer, integer) to authenticated;

create or replace function public.consultar_bitacora_tecnica_planta(p_modulo text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare s jsonb; area text; t public.turnos_operativos%rowtype; operador text; operador_acompanante text;
begin
  area := case p_modulo when 'bitacora_calderas' then 'calderas' when 'bitacora_ptar' then 'ptar' end;
  if auth.uid() is null or not coalesce(private.rol_actual()::text in ('admin','calderas','ptar'), false) or area is null then
    raise exception using errcode = '42501', message = 'No tienes acceso al área del reporte técnico.';
  end if;
  s := private.bt_snapshot_v1(p_modulo,p_id);
  if s is null then return null; end if;
  select * into t from public.turnos_operativos where id = (s->'registro'->>'turno_id')::uuid;
  if not found or t.area::text <> area then
    raise exception using errcode = '22023', message = 'Relación de turno técnico inconsistente.';
  end if;
  select nombre into strict operador from public.operadores where id = t.operador_id;
  if t.operador_acompanante_id is not null then
    select nombre into strict operador_acompanante from public.operadores where id = t.operador_acompanante_id;
  end if;
  return jsonb_build_object('modulo',p_modulo,'snapshot',s,'turno',to_jsonb(t),
    'operador',operador,'operador_acompanante',operador_acompanante);
end;
$function$;
alter function public.consultar_bitacora_tecnica_planta(text, uuid) owner to postgres;
revoke all on function public.consultar_bitacora_tecnica_planta(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.consultar_bitacora_tecnica_planta(text, uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
