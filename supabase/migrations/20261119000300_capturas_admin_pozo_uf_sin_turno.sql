-- LOCAL: capturas manuales de Pozos y UF por Administración, sin turno operativo asociado.
-- La fecha y el turno son referencias; no crean ni modifican turnos de Calderas.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if to_regclass('public.lecturas_pozos') is null
    or to_regclass('public.lecturas_uf') is null
    or to_regclass('public.turnos_operativos') is null
    or to_regclass('private.base_historica_pozos') is null
    or to_regprocedure('private.es_admin()') is null
    or to_regprocedure('private.registrar_auditoria()') is null then
    raise exception 'Faltan tablas base o funciones de seguridad/auditoría para capturas administrativas.';
  end if;
end;
$pre$;

-- Asegura la referencia inicial de UF indicada por Administración. Si la base ya
-- existe, conserva sus datos y verifica que el corte conocido sea el esperado.
create table if not exists private.base_historica_uf (
  anio integer primary key check (anio between 2000 and 9998),
  fecha_corte date not null,
  alim_inicial numeric(18,3) not null check (alim_inicial >= 0),
  acep_inicial numeric(18,3) not null check (acep_inicial >= 0),
  creado_en timestamptz not null default pg_catalog.clock_timestamp(),
  constraint base_historica_uf_corte_anual check (extract(year from fecha_corte)::smallint = anio)
);
alter table private.base_historica_uf owner to postgres;
alter table private.base_historica_uf enable row level security;
revoke all on table private.base_historica_uf from public, anon, authenticated, service_role;

-- Compatibilidad con la definición anterior, que usaba nombres largos.
-- Renombrar conserva los valores y las restricciones existentes.
do $columnas$ declare
  tiene_alim_corto boolean;
  tiene_acep_corto boolean;
  tiene_alim_largo boolean;
  tiene_acep_largo boolean;
begin
  select exists (select 1 from pg_catalog.pg_attribute
    where attrelid = 'private.base_historica_uf'::regclass and attname = 'alim_inicial' and not attisdropped),
    exists (select 1 from pg_catalog.pg_attribute
    where attrelid = 'private.base_historica_uf'::regclass and attname = 'acep_inicial' and not attisdropped),
    exists (select 1 from pg_catalog.pg_attribute
    where attrelid = 'private.base_historica_uf'::regclass and attname = 'alimentacion_lectura_inicial' and not attisdropped),
    exists (select 1 from pg_catalog.pg_attribute
    where attrelid = 'private.base_historica_uf'::regclass and attname = 'aceptacion_lectura_inicial' and not attisdropped)
    into tiene_alim_corto, tiene_acep_corto, tiene_alim_largo, tiene_acep_largo;

  if not tiene_alim_corto and tiene_alim_largo then
    execute 'alter table private.base_historica_uf rename column alimentacion_lectura_inicial to alim_inicial';
  elsif tiene_alim_corto and tiene_alim_largo then
    execute 'update private.base_historica_uf set alim_inicial = alimentacion_lectura_inicial where alim_inicial is null';
  end if;

  if not tiene_acep_corto and tiene_acep_largo then
    execute 'alter table private.base_historica_uf rename column aceptacion_lectura_inicial to acep_inicial';
  elsif tiene_acep_corto and tiene_acep_largo then
    execute 'update private.base_historica_uf set acep_inicial = aceptacion_lectura_inicial where acep_inicial is null';
  end if;

  if not (tiene_alim_corto or tiene_alim_largo) or not (tiene_acep_corto or tiene_acep_largo) then
    raise exception 'La tabla base_historica_uf no contiene las lecturas iniciales esperadas.';
  end if;
end; $columnas$;

insert into private.base_historica_uf (
  anio, fecha_corte, alim_inicial, acep_inicial
) values (
  2026, date '2026-11-18', 1730270, 1381632
) on conflict (anio) do nothing;

do $base$ begin
  if not exists (
    select 1 from private.base_historica_uf
    where anio = 2026 and fecha_corte = date '2026-11-18'
      and alim_inicial = 1730270 and acep_inicial = 1381632
  ) then
    raise exception 'La base histórica de UF 2026 no coincide con las lecturas iniciales autorizadas; revisar antes de continuar.';
  end if;
end; $base$;

create table public.lecturas_pozos_admin (
  id uuid primary key,
  fecha_operativa date not null,
  turno public.turno_tipo not null,
  pozo1_ini numeric(20,3) not null check (pozo1_ini >= 0 and pozo1_ini <= 9007199254740991),
  pozo1_fin numeric(20,3) not null check (pozo1_fin >= pozo1_ini and pozo1_fin <= 9007199254740991),
  consumo_pozo1 numeric(20,3) generated always as (pozo1_fin - pozo1_ini) stored,
  pozo2_ini numeric(20,3) not null check (pozo2_ini >= 0 and pozo2_ini <= 9007199254740991),
  pozo2_fin numeric(20,3) not null check (pozo2_fin >= pozo2_ini and pozo2_fin <= 9007199254740991),
  consumo_pozo2 numeric(20,3) generated always as (pozo2_fin - pozo2_ini) stored,
  notas text,
  capturado_en timestamptz not null default clock_timestamp(),
  creado_por uuid not null references auth.users(id),
  constraint lecturas_pozos_admin_una_por_turno unique (fecha_operativa, turno),
  constraint lecturas_pozos_admin_notas check (notas is null or length(notas) <= 20000)
);

create table public.lecturas_uf_admin (
  id uuid primary key,
  fecha_operativa date not null,
  turno public.turno_tipo not null,
  alim_ini numeric(20,3) not null check (alim_ini >= 0 and alim_ini <= 9007199254740991),
  alim_fin numeric(20,3) not null check (alim_fin >= alim_ini and alim_fin <= 9007199254740991),
  alimentado numeric(20,3) generated always as (alim_fin - alim_ini) stored,
  acep_ini numeric(20,3) not null check (acep_ini >= 0 and acep_ini <= 9007199254740991),
  acep_fin numeric(20,3) not null check (acep_fin >= acep_ini and acep_fin <= 9007199254740991),
  aceptado numeric(20,3) generated always as (acep_fin - acep_ini) stored,
  rechazo numeric(20,3) generated always as ((alim_fin - alim_ini) - (acep_fin - acep_ini)) stored,
  rendimiento numeric(9,4) generated always as (
    case when alim_fin - alim_ini = 0 then null
      else ((acep_fin - acep_ini) / (alim_fin - alim_ini)) * 100 end
  ) stored,
  notas text,
  capturado_en timestamptz not null default clock_timestamp(),
  creado_por uuid not null references auth.users(id),
  constraint lecturas_uf_admin_una_por_turno unique (fecha_operativa, turno),
  constraint lecturas_uf_admin_notas check (notas is null or length(notas) <= 20000)
);

alter table public.lecturas_pozos_admin owner to postgres;
alter table public.lecturas_uf_admin owner to postgres;
alter table public.lecturas_pozos_admin enable row level security;
alter table public.lecturas_uf_admin enable row level security;
revoke all on table public.lecturas_pozos_admin, public.lecturas_uf_admin from public, anon, authenticated, service_role;
create index lecturas_pozos_admin_fecha_idx on public.lecturas_pozos_admin (fecha_operativa desc, turno);
create index lecturas_uf_admin_fecha_idx on public.lecturas_uf_admin (fecha_operativa desc, turno);

create function private.impedir_cambio_medicion_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception using errcode = '42501', message = 'Las lecturas administrativas son de solo registro; no se corrigen ni eliminan.';
end;
$function$;
alter function private.impedir_cambio_medicion_admin() owner to postgres;
revoke all on function private.impedir_cambio_medicion_admin() from public, anon, authenticated, service_role;
create trigger solo_alta_pozos_admin before update or delete on public.lecturas_pozos_admin
  for each row execute function private.impedir_cambio_medicion_admin();
create trigger solo_alta_uf_admin before update or delete on public.lecturas_uf_admin
  for each row execute function private.impedir_cambio_medicion_admin();
create trigger auditar_lectura_pozos_admin after insert on public.lecturas_pozos_admin
  for each row execute function private.registrar_auditoria();
create trigger auditar_lectura_uf_admin after insert on public.lecturas_uf_admin
  for each row execute function private.registrar_auditoria();

-- Las lecturas operativas antiguas dejan de aceptar altas/cambios de cuentas Calderas.
-- La captura nueva se registra en las tablas administrativas anteriores de esta migración.
create function private.bloquear_lectura_operativa_pozos_uf()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if not coalesce(private.es_admin(), false) then
    raise exception using errcode = '42501',
      message = 'Pozos y UF ahora se capturan únicamente desde Administración.';
  end if;
  return new;
end;
$function$;
alter function private.bloquear_lectura_operativa_pozos_uf() owner to postgres;
revoke all on function private.bloquear_lectura_operativa_pozos_uf() from public, anon, authenticated, service_role;
create trigger a_solo_admin_lecturas_pozos
  before insert or update on public.lecturas_pozos
  for each row execute function private.bloquear_lectura_operativa_pozos_uf();
create trigger a_solo_admin_lecturas_uf
  before insert or update on public.lecturas_uf
  for each row execute function private.bloquear_lectura_operativa_pozos_uf();

-- Devuelve la última lectura anterior a la fecha/turno seleccionados.
-- Usa la base importada como referencia cuando corresponde, sin pedir un turno real.
create function private.inicio_medicion_admin(p_modulo text, p_fecha date, p_turno public.turno_tipo)
returns table(inicial1 numeric, inicial2 numeric)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  corte date;
  base1 numeric;
  base2 numeric;
  encontro_base boolean := false;
  anterior record;
  orden_turno integer := case p_turno when 'dia' then 1 when 'tarde' then 2 else 3 end;
begin
  if p_modulo = 'pozos' then
    select b.fecha_corte, b.pozo1_lectura_inicial, b.pozo2_lectura_inicial
      into corte, base1, base2
    from private.base_historica_pozos b
    where b.anio = extract(year from p_fecha)::smallint and b.fecha_corte <= p_fecha;
    encontro_base := found;
    select q.fin1, q.fin2 into anterior
    from (
      select t.fecha_operativa fecha, t.turno, l.pozo1_fin fin1, l.pozo2_fin fin2,
        l.capturado_en instante, l.id
      from public.lecturas_pozos l
      join public.turnos_operativos t on t.id = l.turno_id
      where t.area::text = 'calderas' and l.eliminado_en is null
        and (corte is null or t.fecha_operativa >= corte)
      union all
      select l.fecha_operativa, l.turno, l.pozo1_fin, l.pozo2_fin, l.capturado_en, l.id
      from public.lecturas_pozos_admin l
      where corte is null or l.fecha_operativa >= corte
    ) q
    where (q.fecha < p_fecha or (q.fecha = p_fecha
      and (case q.turno when 'dia' then 1 when 'tarde' then 2 else 3 end) < orden_turno))
    order by q.fecha desc, (case q.turno when 'dia' then 1 when 'tarde' then 2 else 3 end) desc,
      q.instante desc, q.id desc
    limit 1;
  elsif p_modulo = 'uf' then
    select b.fecha_corte, b.alim_inicial, b.acep_inicial
      into corte, base1, base2
    from private.base_historica_uf b
    where b.anio = extract(year from p_fecha)::smallint and b.fecha_corte <= p_fecha;
    encontro_base := found;
    select q.fin1, q.fin2 into anterior
    from (
      select t.fecha_operativa fecha, t.turno, l.alim_fin fin1, l.acep_fin fin2,
        l.capturado_en instante, l.id
      from public.lecturas_uf l
      join public.turnos_operativos t on t.id = l.turno_id
      where t.area::text = 'calderas' and l.eliminado_en is null
        and (corte is null or t.fecha_operativa >= corte)
      union all
      select l.fecha_operativa, l.turno, l.alim_fin, l.acep_fin, l.capturado_en, l.id
      from public.lecturas_uf_admin l
      where corte is null or l.fecha_operativa >= corte
    ) q
    where (q.fecha < p_fecha or (q.fecha = p_fecha
      and (case q.turno when 'dia' then 1 when 'tarde' then 2 else 3 end) < orden_turno))
    order by q.fecha desc, (case q.turno when 'dia' then 1 when 'tarde' then 2 else 3 end) desc,
      q.instante desc, q.id desc
    limit 1;
  else
    raise exception using errcode = '22023', message = 'Módulo inválido.';
  end if;

  if found then
    return query select anterior.fin1, anterior.fin2;
  elsif encontro_base then
    return query select base1, base2;
  else
    return query select null::numeric, null::numeric;
  end if;
end;
$function$;
alter function private.inicio_medicion_admin(text, date, public.turno_tipo) owner to postgres;
revoke all on function private.inicio_medicion_admin(text, date, public.turno_tipo) from public, anon, authenticated, service_role;

create function public.consultar_referencia_medicion_admin(p_modulo text, p_fecha date, p_turno public.turno_tipo)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  inicio record;
  fila jsonb;
  ocupada_operativa boolean := false;
begin
  if auth.uid() is null or not coalesce(private.es_admin(), false) then
    raise exception using errcode = '42501', message = 'Solo Administración puede consultar estas lecturas.';
  end if;
  if p_modulo is null or p_modulo not in ('pozos', 'uf') or p_fecha is null or p_turno is null then
    raise exception using errcode = '22023', message = 'Selecciona una fecha y un turno válidos.';
  end if;

  if p_modulo = 'pozos' then
    select to_jsonb(l) into fila from public.lecturas_pozos_admin l
    where l.fecha_operativa = p_fecha and l.turno = p_turno;
    select exists (
      select 1 from public.lecturas_pozos l
      join public.turnos_operativos t on t.id = l.turno_id
      where t.area::text = 'calderas' and t.fecha_operativa = p_fecha and t.turno = p_turno
        and l.eliminado_en is null
    ) into ocupada_operativa;
  else
    select to_jsonb(l) into fila from public.lecturas_uf_admin l
    where l.fecha_operativa = p_fecha and l.turno = p_turno;
    select exists (
      select 1 from public.lecturas_uf l
      join public.turnos_operativos t on t.id = l.turno_id
      where t.area::text = 'calderas' and t.fecha_operativa = p_fecha and t.turno = p_turno
        and l.eliminado_en is null
    ) into ocupada_operativa;
  end if;

  select * into inicio from private.inicio_medicion_admin(p_modulo, p_fecha, p_turno);
  return pg_catalog.jsonb_build_object(
    'inicial1', inicio.inicial1, 'inicial2', inicio.inicial2,
    'existente', fila, 'ocupada_operativa', ocupada_operativa
  );
end;
$function$;

create function public.consultar_historial_mediciones_admin(p_modulo text, p_limite integer default 7, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare salida jsonb;
begin
  if auth.uid() is null or not coalesce(private.es_admin(), false) then
    raise exception using errcode = '42501', message = 'Solo Administración puede consultar estas lecturas.';
  end if;
  if p_modulo is null or p_modulo not in ('pozos', 'uf') or p_limite is null or p_limite not between 1 and 50
    or p_offset is null or p_offset < 0 then
    raise exception using errcode = '22023', message = 'Los filtros del historial no son válidos.';
  end if;
  if p_modulo = 'pozos' then
    with q as (
      select l.id, l.fecha_operativa, l.turno, l.pozo1_ini inicial1, l.pozo1_fin final1,
        l.consumo_pozo1 consumo1, l.pozo2_ini inicial2, l.pozo2_fin final2,
        l.consumo_pozo2 consumo2, l.notas, l.capturado_en
      from public.lecturas_pozos_admin l
      order by l.fecha_operativa desc,
        case l.turno when 'noche' then 3 when 'tarde' then 2 else 1 end desc, l.capturado_en desc
      limit p_limite + 1 offset p_offset
    ), n as (select q.*, row_number() over (order by fecha_operativa desc,
      case turno when 'noche' then 3 when 'tarde' then 2 else 1 end desc, capturado_en desc) n from q)
    select pg_catalog.jsonb_build_object(
      'filas', coalesce(pg_catalog.jsonb_agg(to_jsonb(n) - 'n' order by n) filter (where n <= p_limite), '[]'::jsonb),
      'mas', count(*) > p_limite
    ) into salida from n;
  else
    with q as (
      select l.id, l.fecha_operativa, l.turno, l.alim_ini inicial1, l.alim_fin final1,
        l.alimentado consumo1, l.acep_ini inicial2, l.acep_fin final2,
        l.aceptado consumo2, l.rechazo, l.rendimiento, l.notas, l.capturado_en
      from public.lecturas_uf_admin l
      order by l.fecha_operativa desc,
        case l.turno when 'noche' then 3 when 'tarde' then 2 else 1 end desc, l.capturado_en desc
      limit p_limite + 1 offset p_offset
    ), n as (select q.*, row_number() over (order by fecha_operativa desc,
      case turno when 'noche' then 3 when 'tarde' then 2 else 1 end desc, capturado_en desc) n from q)
    select pg_catalog.jsonb_build_object(
      'filas', coalesce(pg_catalog.jsonb_agg(to_jsonb(n) - 'n' order by n) filter (where n <= p_limite), '[]'::jsonb),
      'mas', count(*) > p_limite
    ) into salida from n;
  end if;
  return salida;
end;
$function$;

create function public.crear_medicion_admin(
  p_modulo text, p_id uuid, p_fecha date, p_turno public.turno_tipo,
  p_final1 numeric, p_final2 numeric, p_notas text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  cuenta uuid := auth.uid();
  inicio record;
  existente record;
  ocupado boolean;
  notas_limpias text := nullif(btrim(p_notas), '');
begin
  if cuenta is null or not coalesce(private.es_admin(), false) then
    raise exception using errcode = '42501', message = 'Solo Administración puede guardar estas lecturas.';
  end if;
  if p_modulo is null or p_modulo not in ('pozos', 'uf') or p_id is null or p_fecha is null or p_turno is null
    or p_final1 is null or p_final2 is null or p_final1 < 0 or p_final2 < 0
    or p_final1 > 9007199254740991 or p_final2 > 9007199254740991
    or p_final1::text = 'NaN' or p_final2::text = 'NaN'
    or (p_notas is not null and length(p_notas) > 20000) then
    raise exception using errcode = '22023', message = 'Revisa las lecturas finales y las notas.';
  end if;

  -- Reintentos seguros: el mismo identificador confirma solo la misma captura original.
  if p_modulo = 'pozos' then
    select l.fecha_operativa, l.turno, l.pozo1_fin final1, l.pozo2_fin final2,
      l.notas, l.creado_por into existente
    from public.lecturas_pozos_admin l where l.id = p_id;
  else
    select l.fecha_operativa, l.turno, l.alim_fin final1, l.acep_fin final2,
      l.notas, l.creado_por into existente
    from public.lecturas_uf_admin l where l.id = p_id;
  end if;
  if found then
    if existente.creado_por = cuenta and existente.fecha_operativa = p_fecha
      and existente.turno = p_turno and existente.final1 = p_final1
      and existente.final2 = p_final2 and existente.notas is not distinct from notas_limpias then
      return p_id;
    end if;
    raise exception using errcode = '23505', message = 'El identificador ya corresponde a otra captura.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('copamex:lectura-admin:' || p_modulo || ':' || p_fecha::text || ':' || p_turno::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('copamex:lectura-admin:secuencia:' || p_modulo, 0)
  );

  if p_modulo = 'pozos' then
    select exists (
      select 1 from public.lecturas_pozos_admin l
      where l.fecha_operativa = p_fecha and l.turno = p_turno
    ) or exists (
      select 1 from public.lecturas_pozos l
      join public.turnos_operativos t on t.id = l.turno_id
      where t.area::text = 'calderas' and t.fecha_operativa = p_fecha and t.turno = p_turno
        and l.eliminado_en is null
    ) into ocupado;
  else
    select exists (
      select 1 from public.lecturas_uf_admin l
      where l.fecha_operativa = p_fecha and l.turno = p_turno
    ) or exists (
      select 1 from public.lecturas_uf l
      join public.turnos_operativos t on t.id = l.turno_id
      where t.area::text = 'calderas' and t.fecha_operativa = p_fecha and t.turno = p_turno
        and l.eliminado_en is null
    ) into ocupado;
  end if;
  if ocupado then
    raise exception using errcode = '23505', message = 'Ya hay una lectura registrada para esa fecha y turno.';
  end if;

  select * into inicio from private.inicio_medicion_admin(p_modulo, p_fecha, p_turno);
  if inicio.inicial1 is null or inicio.inicial2 is null then
    raise exception using errcode = '22023', message = 'No hay lectura inicial anterior ni base histórica para esta fecha.';
  end if;
  if p_final1 < inicio.inicial1 or p_final2 < inicio.inicial2 then
    raise exception using errcode = '22023', message = 'La lectura final no puede ser menor que la lectura inicial automática.';
  end if;

  if p_modulo = 'pozos' then
    insert into public.lecturas_pozos_admin
      (id, fecha_operativa, turno, pozo1_ini, pozo1_fin, pozo2_ini, pozo2_fin, notas, creado_por)
    values (p_id, p_fecha, p_turno, inicio.inicial1, p_final1, inicio.inicial2, p_final2, notas_limpias, cuenta);
  else
    insert into public.lecturas_uf_admin
      (id, fecha_operativa, turno, alim_ini, alim_fin, acep_ini, acep_fin, notas, creado_por)
    values (p_id, p_fecha, p_turno, inicio.inicial1, p_final1, inicio.inicial2, p_final2, notas_limpias, cuenta);
  end if;
  return p_id;
end;
$function$;

alter function public.consultar_referencia_medicion_admin(text, date, public.turno_tipo) owner to postgres;
alter function public.consultar_historial_mediciones_admin(text, integer, integer) owner to postgres;
alter function public.crear_medicion_admin(text, uuid, date, public.turno_tipo, numeric, numeric, text) owner to postgres;
revoke all on function public.consultar_referencia_medicion_admin(text, date, public.turno_tipo) from public, anon, authenticated, service_role;
revoke all on function public.consultar_historial_mediciones_admin(text, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.crear_medicion_admin(text, uuid, date, public.turno_tipo, numeric, numeric, text) from public, anon, authenticated, service_role;
grant execute on function public.consultar_referencia_medicion_admin(text, date, public.turno_tipo) to authenticated;
grant execute on function public.consultar_historial_mediciones_admin(text, integer, integer) to authenticated;
grant execute on function public.crear_medicion_admin(text, uuid, date, public.turno_tipo, numeric, numeric, text) to authenticated;

-- Si se instaló la captura administrativa anterior ligada a turnos, deshabilitarla:
-- las nuevas capturas ya no deben asociarse a un turno de Calderas.
do $compat$
begin
  if to_regprocedure('public.consultar_medicion_admin(text,date,public.turno_tipo)') is not null then
    execute 'revoke all on function public.consultar_medicion_admin(text,date,public.turno_tipo) from public,anon,authenticated,service_role';
  end if;
  if to_regprocedure('public.crear_medicion_admin(text,uuid,uuid,numeric,numeric,numeric,numeric,text)') is not null then
    execute 'revoke all on function public.crear_medicion_admin(text,uuid,uuid,numeric,numeric,numeric,numeric,text) from public,anon,authenticated,service_role';
  end if;
end;
$compat$;

-- El monitor anual de Pozos suma ambas fuentes: capturas antiguas de turno y registros manuales de Administración.
create or replace function public.consultar_concesion_pozos(p_anio integer)
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
  select coalesce(sum(x.consumo), 0), count(*) into consumo_operativo, lecturas
  from (
    select l.consumo_pozo1 + l.consumo_pozo2 consumo
    from public.lecturas_pozos l
    join public.turnos_operativos t on t.id = l.turno_id
    where t.area::text = 'calderas' and t.fecha_operativa >= desde
      and t.fecha_operativa < pg_catalog.make_date(p_anio + 1, 1, 1) and l.eliminado_en is null
    union all
    select l.consumo_pozo1 + l.consumo_pozo2
    from public.lecturas_pozos_admin l
    where l.fecha_operativa >= desde and l.fecha_operativa < pg_catalog.make_date(p_anio + 1, 1, 1)
  ) x;
  return pg_catalog.jsonb_build_object(
    'anio', p_anio, 'fecha_corte', base.fecha_corte,
    'consumo_historico_m3', consumo_historico,
    'consumo_operativo_m3', consumo_operativo,
    'lecturas', lecturas
  );
end;
$function$;
alter function public.consultar_concesion_pozos(integer) owner to postgres;
revoke all on function public.consultar_concesion_pozos(integer) from public, anon, authenticated, service_role;
grant execute on function public.consultar_concesion_pozos(integer) to authenticated;

notify pgrst, 'reload schema';
commit;
