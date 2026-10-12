-- Fase 3: fecha e inicio asignados por Supabase.
-- Ejecutar completo como postgres DESPUÉS de la migración 024.
-- Regla confirmada: fecha de inicio en America/Mexico_City,
-- conservada durante el turno aunque después pase de medianoche.
-- No modifica turnos existentes ni sus capturas.
-- Después deben actualizarse servicio, hook, formulario y panel en React.
-- Referencias:
-- https://www.postgresql.org/docs/current/functions-datetime.html
-- https://supabase.com/docs/guides/database/postgres/triggers

begin;

-- También protege INSERT directos: fecha y hora enviadas por el cliente
-- se sustituyen por el momento en que comienza la operación en el servidor.
-- statement_timestamp mantiene la misma hora para cierre/inicio en un cambio.
create or replace function private.asignar_inicio_turno()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.iniciado_en := statement_timestamp();
  new.fecha_operativa := (new.iniciado_en at time zone 'America/Mexico_City')::date;
  return new;
end;
$$;

alter function private.asignar_inicio_turno() owner to postgres;
revoke all on function private.asignar_inicio_turno() from public, anon, authenticated;

drop trigger if exists asignar_inicio_turno on public.turnos_operativos;
create trigger asignar_inicio_turno
  before insert on public.turnos_operativos
  for each row execute function private.asignar_inicio_turno();

-- La protección existente de la migración 023 conserva fecha/hora en UPDATE.
-- Se retira el permiso de la RPC anterior, que recibía una fecha elegida.
-- No se elimina la función ni se reescriben migraciones ya aplicadas.
revoke all on function public.iniciar_turno(uuid, date, public.turno_tipo, text, uuid)
  from public, anon, authenticated;

-- Nueva RPC: el cliente envía UUID, tipo, nombre y anterior; nunca una fecha.
-- Un reintento devuelve el turno original incluso si ya cambió el día.

create or replace function public.iniciar_turno(
  p_id uuid,
  p_turno public.turno_tipo,
  p_nombre_operador text,
  p_turno_anterior uuid default null
)
returns setof public.turnos_operativos
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  cuenta uuid := auth.uid();
  rol public.rol_usuario := private.rol_actual();
  area_cuenta public.area_planta;
  nombre_limpio text := private.nombre_operador_normalizado(p_nombre_operador);
  existente public.turnos_operativos%rowtype;
  anterior public.turnos_operativos%rowtype;
  hay_anterior boolean;
  operador_nuevo uuid;
  hora_cambio timestamptz := statement_timestamp();
  fecha_nueva date := (hora_cambio at time zone 'America/Mexico_City')::date;
begin
  if cuenta is null or not coalesce(rol in ('calderas', 'ptar'), false) then
    raise exception using errcode = '42501',
      message = 'Solo una cuenta de área activa puede iniciar o cambiar de turno.';
  end if;
  if p_id is null or p_turno is null
    or nombre_limpio is null or nombre_limpio = ''
  then
    raise exception using errcode = '22023',
      message = 'Selecciona el tipo de turno y escribe el nombre completo del operador.';
  end if;
  area_cuenta := rol::text::public.area_planta;

  perform pg_advisory_xact_lock(hashtextextended('copamex:turno:' || area_cuenta::text, 0));

  select t.* into existente from public.turnos_operativos t where t.id = p_id;
  if found then
    if existente.iniciado_por is distinct from cuenta
      or existente.area is distinct from area_cuenta
      or existente.turno is distinct from p_turno
      or not exists (
        select 1 from public.operadores o where o.id = existente.operador_id
          and lower(private.nombre_operador_normalizado(o.nombre)) = lower(nombre_limpio)
      )
    then
      raise exception using errcode = '22023',
        message = 'Ese identificador ya corresponde a otro turno o a otros datos. Recarga la información.';
    end if;
    return query select t.* from public.turnos_operativos t where t.id = p_id;
    return;
  end if;

  if exists (
    select 1 from public.turnos_operativos t
    where t.area = area_cuenta and t.fecha_operativa = fecha_nueva and t.turno = p_turno
  ) then
    raise exception using errcode = '23505',
      message = 'Ya existe ese tipo de turno para la fecha de hoy y esta área. Revisa el tipo de turno seleccionado.';
  end if;

  select t.* into anterior from public.turnos_operativos t
  where t.area = area_cuenta and t.finalizado_en is null for update;
  hay_anterior := found;

  if hay_anterior then
    if p_turno_anterior is distinct from anterior.id then
      raise exception using errcode = '22023',
        message = 'Hay un turno abierto. Recarga y utiliza Cambiar de turno para cerrarlo e iniciar el siguiente.';
    end if;
    if anterior.iniciado_por is distinct from cuenta then
      raise exception using errcode = '42501',
        message = 'Ese turno pertenece a otra cuenta del área. Pide al administrador que lo cierre.';
    end if;
  elsif p_turno_anterior is not null then
    raise exception using errcode = '22023',
      message = 'El turno anterior ya cambió o fue cerrado. Recarga antes de continuar.';
  end if;

  operador_nuevo := private.obtener_operador_por_nombre(nombre_limpio);

  if hay_anterior then
    update public.turnos_operativos set finalizado_en = hora_cambio
    where id = anterior.id and iniciado_por = cuenta and finalizado_en is null;
    if not found then
      raise exception using errcode = '42501', message = 'No se pudo cerrar el turno anterior.';
    end if;
  end if;

  insert into public.turnos_operativos (
    id, fecha_operativa, area, turno, operador_id, iniciado_por, iniciado_en
  ) values (
    p_id, fecha_nueva, area_cuenta, p_turno, operador_nuevo, cuenta, hora_cambio
  );
  return query select t.* from public.turnos_operativos t where t.id = p_id;
end;
$$;

alter function public.iniciar_turno(uuid, public.turno_tipo, text, uuid) owner to postgres;
revoke all on function public.iniciar_turno(uuid, public.turno_tipo, text, uuid)
  from public, anon, authenticated;
grant execute on function public.iniciar_turno(uuid, public.turno_tipo, text, uuid)
  to authenticated;


notify pgrst, 'reload schema';
commit; 