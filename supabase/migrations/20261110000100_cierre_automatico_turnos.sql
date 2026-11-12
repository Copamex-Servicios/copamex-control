-- LOCAL: pendiente de revisión y aplicación autorizada en Supabase.
-- Cierra turnos completos por horario, sin crear, completar ni borrar capturas.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
begin
  if to_regprocedure('private.bt_intervalo(date,public.turno_tipo)') is null then
    raise exception 'Aplicar primero la migración de horario técnico 20261106000400.';
  end if;
  if coalesce(current_setting('cron.timezone', true), 'GMT') not in ('GMT', 'UTC') then
    raise exception 'Revisar cron.timezone: este trabajo requiere UTC o GMT.';
  end if;
end;
$pre$;

create extension if not exists pg_cron with schema pg_catalog;

create function private.cerrar_turnos_vencidos()
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  area_actual text;
  registro record;
  ultima_captura timestamptz;
  cierre timestamptz;
  cerrados integer := 0;
begin
  if current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'Operación interna del servidor.';
  end if;
  foreach area_actual in array array['calderas', 'ptar'] loop
    -- Mismo candado que inicio, cambio y cierre manual; no interrumpir operaciones en curso.
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('copamex:turno:' || area_actual, 0)) then
      continue;
    end if;
    for registro in
      select t.id, t.iniciado_en, v.fin
      from public.turnos_operativos t
      cross join lateral private.bt_intervalo(t.fecha_operativa, t.turno) v
      where t.area::text = area_actual and t.finalizado_en is null
        and v.fin <= pg_catalog.statement_timestamp()
      for update of t skip locked
    loop
      -- Compatibilidad histórica: no fechar un cierre antes de una captura ya existente.
      select max(c.instante) into ultima_captura from (
        select capturado_en instante from public.bitacora where turno_id = registro.id and eliminado_en is null
        union all select capturado_en from public.lecturas_pozos where turno_id = registro.id and eliminado_en is null
        union all select capturado_en from public.lecturas_uf where turno_id = registro.id and eliminado_en is null
        union all select capturado_en from public.lecturas_ptar where turno_id = registro.id and eliminado_en is null
        union all select capturado_en from public.muestras_calidad where turno_id = registro.id and eliminado_en is null
        union all select creado_en from public.bitacora_calderas where turno_id = registro.id
        union all select creado_en from public.bitacora_ptar where turno_id = registro.id
      ) c;
      cierre := greatest(registro.fin, registro.iniciado_en, ultima_captura);
      if cierre > pg_catalog.clock_timestamp() then
        raise warning 'Turno % contiene fechas futuras; requiere revisión administrativa.', registro.id;
        continue;
      end if;
      update public.turnos_operativos set finalizado_en = cierre
        where id = registro.id and finalizado_en is null;
      if found then cerrados := cerrados + 1; end if;
    end loop;
  end loop;
  return cerrados;
end;
$function$;
alter function private.cerrar_turnos_vencidos() owner to postgres;
revoke all on function private.cerrar_turnos_vencidos() from public, anon, authenticated, service_role;

-- Minuto 01 de cada hora: incluye todos los límites de turno sin llamadas HTTP.
-- Solo se cierran los turnos cuyo fin real ya pasó (America/Mexico_City).
select cron.schedule('copamex-cerrar-turnos-vencidos', '1 * * * *',
  'select private.cerrar_turnos_vencidos();');

-- Regularizar únicamente turnos abiertos ya vencidos al instalar la mejora.
select private.cerrar_turnos_vencidos();
commit;
