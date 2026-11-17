-- LOCAL: pendiente de aplicar en Supabase.
-- La lectura final de la captura anterior de UF inicia el siguiente turno.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $pre$
begin
  if to_regprocedure('private.es_admin()') is null
    or to_regclass('public.lecturas_uf') is null
    or to_regclass('public.turnos_operativos') is null then
    raise exception 'Faltan dependencias para proteger las lecturas iniciales de UF.';
  end if;
end;
$pre$;

create or replace function public.consultar_inicio_automatico_uf(p_turno_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  cuenta uuid := auth.uid();
  turno_actual public.turnos_operativos%rowtype;
  lectura_anterior record;
begin
  if cuenta is null or private.rol_actual()::text is distinct from 'calderas' then
    raise exception using errcode = '42501', message = 'Solo Calderas puede consultar el inicio de UF.';
  end if;
  if p_turno_id is null then
    raise exception using errcode = '22023', message = 'Selecciona un turno válido de Calderas.';
  end if;

  select t.* into turno_actual
  from public.turnos_operativos t
  where t.id = p_turno_id and t.area::text = 'calderas' and t.iniciado_por = cuenta;
  if not found then
    raise exception using errcode = '42501', message = 'El turno de UF no corresponde a tu cuenta de Calderas.';
  end if;

  select l.alim_fin, l.acep_fin into lectura_anterior
  from public.lecturas_uf l
  join public.turnos_operativos t on t.id = l.turno_id
  where t.area::text = 'calderas'
    and t.iniciado_en < turno_actual.iniciado_en
    and l.turno_id <> p_turno_id
    and l.eliminado_en is null
  order by t.iniciado_en desc, l.capturado_en desc, l.id desc
  limit 1;

  if not found then return null; end if;
  return pg_catalog.jsonb_build_object(
    'alimentacion', lectura_anterior.alim_fin,
    'aceptacion', lectura_anterior.acep_fin
  );
end;
$function$;

alter function public.consultar_inicio_automatico_uf(uuid) owner to postgres;
revoke all on function public.consultar_inicio_automatico_uf(uuid) from public, anon, authenticated, service_role;
grant execute on function public.consultar_inicio_automatico_uf(uuid) to authenticated;

create function private.validar_inicio_automatico_uf()
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
    if (new.alim_ini is distinct from old.alim_ini
      or new.acep_ini is distinct from old.acep_ini)
      and not coalesce(private.es_admin(), false) then
      raise exception using errcode = '42501',
        message = 'Las lecturas iniciales de UF no se pueden modificar.';
    end if;
    return new;
  end if;

  -- Serializa las altas para que dos turnos no tomen referencias distintas.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('copamex:uf:lectura_inicial:calderas', 0)
  );

  select t.iniciado_en into inicio_actual
  from public.turnos_operativos t
  where t.id = new.turno_id and t.area::text = 'calderas';
  if not found then
    raise exception using errcode = '22023',
      message = 'La lectura de UF requiere un turno válido de Calderas.';
  end if;

  select l.alim_fin, l.acep_fin into lectura_anterior
  from public.lecturas_uf l
  join public.turnos_operativos t on t.id = l.turno_id
  where t.area::text = 'calderas'
    and t.iniciado_en < inicio_actual
    and l.turno_id <> new.turno_id
    and l.eliminado_en is null
  order by t.iniciado_en desc, l.capturado_en desc, l.id desc
  limit 1;

  if found and (new.alim_ini is distinct from lectura_anterior.alim_fin
    or new.acep_ini is distinct from lectura_anterior.acep_fin) then
    raise exception using errcode = '22023',
      message = 'Las lecturas iniciales de UF deben coincidir con las lecturas finales del turno anterior.';
  end if;
  return new;
end;
$function$;

alter function private.validar_inicio_automatico_uf() owner to postgres;
revoke all on function private.validar_inicio_automatico_uf() from public, anon, authenticated, service_role;

create trigger validar_inicio_automatico_uf
before insert or update on public.lecturas_uf
for each row execute function private.validar_inicio_automatico_uf();

notify pgrst, 'reload schema';
commit;
