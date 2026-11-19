-- LOCAL: pendiente de revisión y aplicación manual en Supabase.
-- Registra bases iniciales anuales de Pozos y UF; no crea lecturas ni turnos operativos.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $pre$
begin
  if to_regclass('public.lecturas_pozos') is null
    or to_regclass('public.turnos_operativos') is null
    or to_regprocedure('private.es_admin()') is null
    or to_regprocedure('private.rol_actual()') is null
    or to_regprocedure('private.validar_inicio_automatico_pozos()') is null then
    raise exception 'Faltan las dependencias de Pozos y del encadenamiento de lecturas.';
  end if;
  if to_regclass('private.base_historica_pozos') is not null then
    raise exception 'La base histórica de Pozos ya existe; revisar antes de volver a aplicar.';
  end if;
  if to_regclass('private.base_historica_uf') is not null then
    raise exception 'La base histórica de UF ya existe; revisar antes de volver a aplicar.';
  end if;
  if to_regclass('public.lecturas_uf') is null
    or to_regprocedure('public.consultar_inicio_automatico_uf(uuid)') is null
    or to_regprocedure('private.validar_inicio_automatico_uf()') is null then
    raise exception 'Aplicar primero la migración de encadenamiento automático de UF.';
  end if;
  -- La base incluye el consumo hasta el 18/11/2026. No continuar si ya hay
  -- capturas operativas dentro de ese período que pudieran duplicarlo.
  if exists (
    select 1
    from public.lecturas_pozos l
    join public.turnos_operativos t on t.id = l.turno_id
    where t.area::text = 'calderas'
      and t.fecha_operativa >= date '2026-01-01'
      and t.fecha_operativa <= date '2026-11-18'
      and l.eliminado_en is null
  ) then
    raise exception 'Hay lecturas activas de Pozos anteriores o iguales al corte. Revisar el consumo para evitar duplicarlo.';
  end if;
  if exists (
    select 1
    from public.lecturas_uf l
    join public.turnos_operativos t on t.id = l.turno_id
    where t.area::text = 'calderas'
      and t.fecha_operativa >= date '2026-01-01'
      and t.fecha_operativa <= date '2026-11-18'
      and l.eliminado_en is null
  ) then
    raise exception 'Hay lecturas activas de UF anteriores o iguales al corte. Revisar los medidores para evitar saltar o duplicar consumo.';
  end if;
end;
$pre$;

create table private.base_historica_pozos (
  anio smallint primary key check (anio between 2000 and 9998),
  fecha_corte date not null,
  pozo1_lectura_inicial numeric(18,3) not null check (pozo1_lectura_inicial >= 0),
  pozo2_lectura_inicial numeric(18,3) not null check (pozo2_lectura_inicial >= 0),
  consumo_historico_m3 numeric(18,3) not null check (consumo_historico_m3 >= 0),
  creado_en timestamptz not null default pg_catalog.clock_timestamp(),
  constraint base_historica_pozos_corte_anual check (extract(year from fecha_corte)::smallint = anio)
);
alter table private.base_historica_pozos owner to postgres;
alter table private.base_historica_pozos enable row level security;
revoke all on table private.base_historica_pozos from public, anon, authenticated, service_role;

insert into private.base_historica_pozos (
  anio, fecha_corte, pozo1_lectura_inicial, pozo2_lectura_inicial, consumo_historico_m3
) values (
  2026, date '2026-11-18', 35448, 587372, 248430
);

-- Lecturas de los totalizadores de UF al mismo corte; son bases, no capturas.
create table private.base_historica_uf (
  anio smallint primary key check (anio between 2000 and 9998),
  fecha_corte date not null,
  alimentacion_lectura_inicial numeric(18,3) not null check (alimentacion_lectura_inicial >= 0),
  aceptacion_lectura_inicial numeric(18,3) not null check (aceptacion_lectura_inicial >= 0),
  creado_en timestamptz not null default pg_catalog.clock_timestamp(),
  constraint base_historica_uf_corte_anual check (extract(year from fecha_corte)::smallint = anio)
);
alter table private.base_historica_uf owner to postgres;
alter table private.base_historica_uf enable row level security;
revoke all on table private.base_historica_uf from public, anon, authenticated, service_role;

insert into private.base_historica_uf (
  anio, fecha_corte, alimentacion_lectura_inicial, aceptacion_lectura_inicial
) values (
  2026, date '2026-11-18', 1730270, 1381632
);

create function public.consultar_base_historica_pozos(p_anio integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare base private.base_historica_pozos%rowtype;
begin
  if auth.uid() is null
    or (private.rol_actual()::text is distinct from 'calderas'
      and not coalesce(private.es_admin(), false)) then
    raise exception using errcode = '42501', message = 'Solo Calderas o Administración puede consultar la base de Pozos.';
  end if;
  if p_anio is null or p_anio not between 2000 and 9998 then
    raise exception using errcode = '22023', message = 'El año de Pozos no es válido.';
  end if;

  select b.* into base from private.base_historica_pozos b where b.anio = p_anio;
  if not found then return null; end if;
  return pg_catalog.jsonb_build_object(
    'anio', base.anio,
    'fecha_corte', base.fecha_corte,
    'pozo1_lectura_inicial', base.pozo1_lectura_inicial,
    'pozo2_lectura_inicial', base.pozo2_lectura_inicial,
    'consumo_historico_m3', base.consumo_historico_m3
  );
end;
$function$;

create function public.consultar_concesion_pozos(p_anio integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  base private.base_historica_pozos%rowtype;
  desde date;
  consumo_historico numeric(18,3) := 0;
  consumo_operativo numeric(18,3) := 0;
  lecturas bigint := 0;
begin
  if auth.uid() is null
    or (private.rol_actual()::text is distinct from 'calderas'
      and not coalesce(private.es_admin(), false)) then
    raise exception using errcode = '42501', message = 'Solo Calderas o Administración puede consultar el consumo anual de Pozos.';
  end if;
  if p_anio is null or p_anio not between 2000 and 9998 then
    raise exception using errcode = '22023', message = 'El año de consulta no es válido.';
  end if;

  select b.* into base from private.base_historica_pozos b where b.anio = p_anio;
  if found then
    desde := greatest(base.fecha_corte, pg_catalog.make_date(p_anio, 1, 1));
    consumo_historico := base.consumo_historico_m3;
  else
    desde := pg_catalog.make_date(p_anio, 1, 1);
  end if;

  select count(*), coalesce(sum(l.consumo_pozo1 + l.consumo_pozo2), 0)
    into lecturas, consumo_operativo
  from public.lecturas_pozos l
  join public.turnos_operativos t on t.id = l.turno_id
  where t.area::text = 'calderas'
    and t.fecha_operativa >= desde
    and t.fecha_operativa < pg_catalog.make_date(p_anio + 1, 1, 1)
    and l.eliminado_en is null;

  return pg_catalog.jsonb_build_object(
    'anio', p_anio,
    'fecha_corte', base.fecha_corte,
    'consumo_historico_m3', consumo_historico,
    'consumo_operativo_m3', consumo_operativo,
    'lecturas', lecturas
  );
end;
$function$;

-- Primera lectura posterior al corte usa la base histórica; los turnos siguientes
-- continúan desde el cierre operativo más reciente.
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
  base private.base_historica_uf%rowtype;
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

  select b.* into base
  from private.base_historica_uf b
  where b.anio = extract(year from turno_actual.fecha_operativa)::smallint
    and turno_actual.fecha_operativa >= b.fecha_corte;

  if found then
    select l.alim_fin, l.acep_fin into lectura_anterior
    from public.lecturas_uf l
    join public.turnos_operativos t on t.id = l.turno_id
    where t.area::text = 'calderas'
      and t.fecha_operativa >= base.fecha_corte
      and t.iniciado_en < turno_actual.iniciado_en
      and l.turno_id <> p_turno_id
      and l.eliminado_en is null
    order by t.iniciado_en desc, l.capturado_en desc, l.id desc
    limit 1;

    if found then
      return pg_catalog.jsonb_build_object(
        'alimentacion', lectura_anterior.alim_fin,
        'aceptacion', lectura_anterior.acep_fin
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'alimentacion', base.alimentacion_lectura_inicial,
      'aceptacion', base.aceptacion_lectura_inicial
    );
  end if;

  -- Años sin base importada conservan el encadenamiento anterior.
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

create or replace function private.validar_inicio_automatico_uf()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  inicio_actual timestamptz;
  fecha_actual date;
  base private.base_historica_uf%rowtype;
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('copamex:uf:lectura_inicial:calderas', 0)
  );

  select t.iniciado_en, t.fecha_operativa into inicio_actual, fecha_actual
  from public.turnos_operativos t
  where t.id = new.turno_id and t.area::text = 'calderas';
  if not found then
    raise exception using errcode = '22023',
      message = 'La lectura de UF requiere un turno válido de Calderas.';
  end if;

  select b.* into base
  from private.base_historica_uf b
  where b.anio = extract(year from fecha_actual)::smallint
    and fecha_actual >= b.fecha_corte;

  if found then
    select l.alim_fin, l.acep_fin into lectura_anterior
    from public.lecturas_uf l
    join public.turnos_operativos t on t.id = l.turno_id
    where t.area::text = 'calderas'
      and t.fecha_operativa >= base.fecha_corte
      and t.iniciado_en < inicio_actual
      and l.turno_id <> new.turno_id
      and l.eliminado_en is null
    order by t.iniciado_en desc, l.capturado_en desc, l.id desc
    limit 1;

    if found then
      if new.alim_ini is distinct from lectura_anterior.alim_fin
        or new.acep_ini is distinct from lectura_anterior.acep_fin then
        raise exception using errcode = '22023',
          message = 'Las lecturas iniciales de UF deben coincidir con las lecturas finales del turno anterior.';
      end if;
    elsif new.alim_ini is distinct from base.alimentacion_lectura_inicial
      or new.acep_ini is distinct from base.aceptacion_lectura_inicial then
      raise exception using errcode = '22023',
        message = 'Las lecturas iniciales de UF deben coincidir con la base histórica de los medidores.';
    end if;
    return new;
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

alter function public.consultar_base_historica_pozos(integer) owner to postgres;
alter function public.consultar_concesion_pozos(integer) owner to postgres;
alter function public.consultar_inicio_automatico_uf(uuid) owner to postgres;
alter function private.validar_inicio_automatico_uf() owner to postgres;
revoke all on function public.consultar_base_historica_pozos(integer) from public, anon, authenticated, service_role;
revoke all on function public.consultar_concesion_pozos(integer) from public, anon, authenticated, service_role;
revoke all on function public.consultar_inicio_automatico_uf(uuid) from public, anon, authenticated, service_role;
revoke all on function private.validar_inicio_automatico_uf() from public, anon, authenticated, service_role;
grant execute on function public.consultar_base_historica_pozos(integer) to authenticated;
grant execute on function public.consultar_concesion_pozos(integer) to authenticated;
grant execute on function public.consultar_inicio_automatico_uf(uuid) to authenticated;

-- Si todavía no existe una captura posterior al corte, usa los medidores base.
-- A partir de la primera captura nueva, el turno siguiente continúa desde sus finales.
create or replace function private.validar_inicio_automatico_pozos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  inicio_actual timestamptz;
  fecha_actual date;
  base private.base_historica_pozos%rowtype;
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('copamex:pozos:lectura_inicial:calderas', 0)
  );

  select t.iniciado_en, t.fecha_operativa into inicio_actual, fecha_actual
  from public.turnos_operativos t
  where t.id = new.turno_id and t.area::text = 'calderas';
  if not found then
    raise exception using errcode = '22023',
      message = 'La lectura de Pozos requiere un turno válido de Calderas.';
  end if;

  select b.* into base
  from private.base_historica_pozos b
  where b.anio = extract(year from fecha_actual)::smallint
    and fecha_actual >= b.fecha_corte;

  if found then
    select l.pozo1_fin, l.pozo2_fin into lectura_anterior
    from public.lecturas_pozos l
    join public.turnos_operativos t on t.id = l.turno_id
    where t.area::text = 'calderas'
      and t.fecha_operativa >= base.fecha_corte
      and t.iniciado_en < inicio_actual
      and l.turno_id <> new.turno_id
      and l.eliminado_en is null
    order by t.iniciado_en desc, l.capturado_en desc, l.id desc
    limit 1;

    if found then
      if new.pozo1_ini is distinct from lectura_anterior.pozo1_fin
        or new.pozo2_ini is distinct from lectura_anterior.pozo2_fin then
        raise exception using errcode = '22023',
          message = 'Las lecturas iniciales deben coincidir con las lecturas finales del turno anterior.';
      end if;
    elsif new.pozo1_ini is distinct from base.pozo1_lectura_inicial
      or new.pozo2_ini is distinct from base.pozo2_lectura_inicial then
      raise exception using errcode = '22023',
        message = 'Las lecturas iniciales deben coincidir con la base histórica de los medidores.';
    end if;
    return new;
  end if;

  -- Años sin base importada conservan el encadenamiento previo existente.
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

notify pgrst, 'reload schema';
commit;
