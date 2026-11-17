-- LOCAL: pendiente de revisión y aplicación en Supabase.
-- Permite lecturas adicionales de Color M4 durante el turno, sin exigir aviso activo.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
begin
  if to_regprocedure('public.guardar_lectura_seguimiento_calidad(uuid,uuid,uuid,numeric)') is null
    or to_regprocedure('private.bt_operador_en_turno(public.turnos_operativos,timestamptz)') is null then
    raise exception 'Aplicar primero la migración 20261112000200 y las dependencias de turno.';
  end if;
  if not exists (select 1 from private.tipos_seguimiento_calidad where tipo = 'color_m4') then
    raise exception 'Falta la configuración del punto y parámetro Color M4.';
  end if;
end;
$pre$;

-- Las lecturas adicionales quedan marcadas por seguimiento_valor_inicial;
-- seguimiento_id solo se llena cuando había un aviso M4 activo.
alter table public.muestras_calidad drop constraint if exists muestra_seguimiento_consistente;
alter table public.muestras_calidad add constraint muestra_seguimiento_consistente check (
  (seguimiento_id is null and seguimiento_valor_inicial is null)
  or (seguimiento_valor_inicial is not null
    and seguimiento_valor_inicial::text not in ('NaN', 'Infinity', '-Infinity'))
);

create or replace function private.proteger_identidad_seguimiento() returns trigger
language plpgsql set search_path = '' as $function$
begin
  if tg_op = 'UPDATE' and row(new.seguimiento_id, new.seguimiento_valor_inicial)
    is distinct from row(old.seguimiento_id, old.seguimiento_valor_inicial) then
    raise exception using errcode = '42501', message = 'La lectura adicional original de la muestra se conserva.';
  end if;
  if tg_op = 'INSERT' and (new.seguimiento_id is not null or new.seguimiento_valor_inicial is not null)
    and (current_user <> 'postgres' or auth.uid() is null
      or current_setting('copamex.seguimiento_calidad', true) is distinct from new.id::text) then
    raise exception using errcode = '42501', message = 'La lectura adicional requiere la operación controlada.';
  end if;
  return new;
end;
$function$;

create or replace function public.guardar_lectura_seguimiento_calidad(
  p_id uuid, p_turno uuid, p_seguimiento uuid, p_valor numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  seguimiento public.seguimientos_calidad%rowtype;
  config private.tipos_seguimiento_calidad%rowtype;
  turno public.turnos_operativos%rowtype;
  muestra public.muestras_calidad%rowtype;
  instante timestamptz;
  previo text;
begin
  if auth.uid() is null or private.rol_actual()::text is distinct from 'calderas' then
    raise exception using errcode = '42501', message = 'Se requiere la cuenta activa de Calderas.';
  end if;
  if p_id is null or p_turno is null or p_valor is null
    or p_valor::text in ('NaN', 'Infinity', '-Infinity')
    or abs(p_valor) > 9007199254740991 then
    raise exception using errcode = '22023', message = 'Escribe un valor numérico válido.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('copamex.muestras_calidad:' || p_id::text, 0));
  select * into muestra from public.muestras_calidad where id = p_id;
  if found then
    if muestra.turno_id <> p_turno or muestra.seguimiento_id is distinct from p_seguimiento
      or muestra.creado_por <> auth.uid() or muestra.seguimiento_valor_inicial is distinct from p_valor then
      raise exception using errcode = '23505', message = 'El identificador corresponde a otra lectura.';
    end if;
    return p_id;
  end if;

  select * into config from private.tipos_seguimiento_calidad where tipo = 'color_m4';
  if not found then
    raise exception using errcode = '22023', message = 'No está configurado el punto y parámetro Color M4.';
  end if;

  if p_seguimiento is not null then
    select * into seguimiento from public.seguimientos_calidad where id = p_seguimiento;
    if not found or seguimiento.tipo <> 'color_m4' or seguimiento.finalizado_en is not null then
      raise exception using errcode = '42501', message = 'El seguimiento ya no está activo.';
    end if;
    select * into config from private.tipos_seguimiento_calidad where tipo = seguimiento.tipo;
    perform 1 from public.avisos a where a.id = seguimiento.aviso_id
      and (a.inicio is null or a.inicio <= clock_timestamp())
      and (a.permanente or a.fin is null or a.fin > clock_timestamp())
      for share;
    if not found then
      raise exception using errcode = '42501', message = 'El aviso del seguimiento ya no está activo.';
    end if;
    select * into seguimiento from public.seguimientos_calidad where id = p_seguimiento for share;
    if not found or seguimiento.finalizado_en is not null then
      raise exception using errcode = '42501', message = 'El seguimiento ya no está activo.';
    end if;
  end if;

  select * into turno from public.turnos_operativos where id = p_turno for share;
  instante := clock_timestamp();
  if not found or turno.finalizado_en is not null or turno.area <> config.area
    or turno.iniciado_por <> auth.uid() or not private.bt_operador_en_turno(turno, instante) then
    raise exception using errcode = '42501', message = 'La lectura requiere tu turno abierto dentro de su horario.';
  end if;
  if not exists (
    select 1 from public.muestras_calidad
    where turno_id = turno.id and seguimiento_valor_inicial is null and eliminado_en is null
  ) then
    raise exception using errcode = '22023', message = 'Registra primero la muestra habitual de Calidad del turno.';
  end if;
  if not exists (select 1 from public.puntos_muestreo where id = config.punto_id and activo
      and (area is null or area = turno.area))
    or not exists (select 1 from public.parametros_calidad where id = config.parametro_id and activo) then
    raise exception using errcode = '22023', message = 'El punto o parámetro Color M4 no está habilitado.';
  end if;

  previo := current_setting('copamex.seguimiento_calidad', true);
  perform set_config('copamex.seguimiento_calidad', p_id::text, true);
  insert into public.muestras_calidad (
    id, turno_id, hora_muestra, capturado_en, creado_por, seguimiento_id, seguimiento_valor_inicial
  ) values (
    p_id, turno.id, (instante at time zone 'America/Mexico_City')::time,
    instante, auth.uid(), p_seguimiento, p_valor
  );
  perform set_config('copamex.seguimiento_calidad', coalesce(previo, ''), true);
  insert into public.resultados_calidad (id, muestra_id, punto_id, parametro_id, valor)
  values (gen_random_uuid(), p_id, config.punto_id, config.parametro_id, p_valor);
  return p_id;
end;
$function$;

alter function private.proteger_identidad_seguimiento() owner to postgres;
revoke all on function private.proteger_identidad_seguimiento() from public, anon, authenticated, service_role;
alter function public.guardar_lectura_seguimiento_calidad(uuid, uuid, uuid, numeric) owner to postgres;
revoke all on function public.guardar_lectura_seguimiento_calidad(uuid, uuid, uuid, numeric) from public, anon, authenticated, service_role;
grant execute on function public.guardar_lectura_seguimiento_calidad(uuid, uuid, uuid, numeric) to authenticated;

notify pgrst, 'reload schema';
commit;
