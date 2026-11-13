-- LOCAL: pendiente de aplicar en Supabase.
-- La lectura final del turno anterior inicia el siguiente turno de Pozos.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $pre$
begin
  if to_regprocedure('private.es_admin()') is null
    or to_regclass('public.lecturas_pozos') is null
    or to_regclass('public.turnos_operativos') is null then
    raise exception 'Faltan dependencias para proteger las lecturas iniciales de Pozos.';
  end if;
end;
$pre$;

create function private.validar_inicio_automatico_pozos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  inicio_actual timestamptz;
  lectura_anterior record;
begin
  if tg_op = 'UPDATE' then
    if (new.pozo1_ini is distinct from old.pozo1_ini
      or new.pozo2_ini is distinct from old.pozo2_ini)
      and not coalesce(private.es_admin(), false) then
      raise exception using errcode = '42501',
        message = 'Las lecturas iniciales de Pozos no se pueden modificar.';
    end if;
    return new;
  end if;

  -- Serializa altas de Pozos para evitar dos referencias distintas al mismo cierre.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('copamex:pozos:lectura_inicial:calderas', 0)
  );

  select t.iniciado_en into inicio_actual
  from public.turnos_operativos t
  where t.id = new.turno_id and t.area::text = 'calderas';
  if not found then
    raise exception using errcode = '22023',
      message = 'La lectura de Pozos requiere un turno válido de Calderas.';
  end if;

  select l.pozo1_fin, l.pozo2_fin into lectura_anterior
  from public.lecturas_pozos l
  join public.turnos_operativos t on t.id = l.turno_id
  where t.area::text = 'calderas'
    and t.iniciado_en < inicio_actual
    and l.turno_id <> new.turno_id
    and l.eliminado_en is null
  order by t.iniciado_en desc, l.capturado_en desc, l.id desc
  limit 1;

  if found and (new.pozo1_ini is distinct from lectura_anterior.pozo1_fin
    or new.pozo2_ini is distinct from lectura_anterior.pozo2_fin) then
    raise exception using errcode = '22023',
      message = 'Las lecturas iniciales deben coincidir con las lecturas finales del turno anterior.';
  end if;
  return new;
end;
$function$;

alter function private.validar_inicio_automatico_pozos() owner to postgres;
revoke all on function private.validar_inicio_automatico_pozos() from public, anon, authenticated, service_role;

create trigger validar_inicio_automatico_pozos
before insert or update on public.lecturas_pozos
for each row execute function private.validar_inicio_automatico_pozos();

commit;
