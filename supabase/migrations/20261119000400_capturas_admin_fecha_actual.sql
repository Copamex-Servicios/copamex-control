-- LOCAL: capturas administrativas de Pozos y UF siempre en la fecha actual de México y turno Día.
-- No requiere turno operativo y no permite elegir fechas o turnos anteriores.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if to_regprocedure('private.inicio_medicion_admin(text,date,public.turno_tipo)') is null
    or to_regprocedure('private.es_admin()') is null
    or to_regclass('public.lecturas_pozos_admin') is null
    or to_regclass('public.lecturas_uf_admin') is null
    or to_regclass('public.lecturas_pozos') is null
    or to_regclass('public.lecturas_uf') is null
    or to_regclass('public.turnos_operativos') is null
    or to_regprocedure('public.consultar_referencia_medicion_admin(text,date,public.turno_tipo)') is null
    or to_regprocedure('public.crear_medicion_admin(text,uuid,date,public.turno_tipo,numeric,numeric,text)') is null then
    raise exception 'Aplicar primero 20261119000300_capturas_admin_pozo_uf_sin_turno.sql.';
  end if;
  if to_regprocedure('public.consultar_referencia_diaria_medicion_admin(text)') is not null
    or to_regprocedure('public.crear_medicion_diaria_admin(text,uuid,numeric,numeric,text)') is not null then
    raise exception 'Las funciones de captura diaria ya existen; revisar antes de volver a aplicar.';
  end if;
end;
$pre$;

create function public.consultar_referencia_diaria_medicion_admin(p_modulo text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  fecha_captura date := (pg_catalog.statement_timestamp() at time zone 'America/Mexico_City')::date;
  inicio record;
  fila jsonb;
  ocupada_operativa boolean := false;
begin
  if auth.uid() is null or not coalesce(private.es_admin(), false) then
    raise exception using errcode = '42501', message = 'Solo Administración puede consultar estas lecturas.';
  end if;
  if p_modulo is null or p_modulo not in ('pozos', 'uf') then
    raise exception using errcode = '22023', message = 'El módulo de medición no es válido.';
  end if;

  if p_modulo = 'pozos' then
    select pg_catalog.to_jsonb(l) into fila
    from public.lecturas_pozos_admin l
    where l.fecha_operativa = fecha_captura and l.turno = 'dia';
    select exists (
      select 1 from public.lecturas_pozos l
      join public.turnos_operativos t on t.id = l.turno_id
      where t.area::text = 'calderas' and t.fecha_operativa = fecha_captura and t.turno = 'dia'
        and l.eliminado_en is null
    ) into ocupada_operativa;
  else
    select pg_catalog.to_jsonb(l) into fila
    from public.lecturas_uf_admin l
    where l.fecha_operativa = fecha_captura and l.turno = 'dia';
    select exists (
      select 1 from public.lecturas_uf l
      join public.turnos_operativos t on t.id = l.turno_id
      where t.area::text = 'calderas' and t.fecha_operativa = fecha_captura and t.turno = 'dia'
        and l.eliminado_en is null
    ) into ocupada_operativa;
  end if;

  select * into inicio from private.inicio_medicion_admin(p_modulo, fecha_captura, 'dia');
  return pg_catalog.jsonb_build_object(
    'fecha_operativa', fecha_captura,
    'turno', 'dia',
    'inicial1', inicio.inicial1,
    'inicial2', inicio.inicial2,
    'existente', fila,
    'ocupada_operativa', ocupada_operativa
  );
end;
$function$;

create function public.crear_medicion_diaria_admin(
  p_modulo text,
  p_id uuid,
  p_final1 numeric,
  p_final2 numeric,
  p_notas text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  cuenta uuid := auth.uid();
  fecha_captura date := (pg_catalog.statement_timestamp() at time zone 'America/Mexico_City')::date;
  inicio record;
  existente record;
  ocupado boolean;
  notas_limpias text := nullif(btrim(p_notas), '');
begin
  if cuenta is null or not coalesce(private.es_admin(), false) then
    raise exception using errcode = '42501', message = 'Solo Administración puede guardar estas lecturas.';
  end if;
  if p_modulo is null or p_modulo not in ('pozos', 'uf') or p_id is null
    or p_final1 is null or p_final2 is null or p_final1 < 0 or p_final2 < 0
    or p_final1 > 9007199254740991 or p_final2 > 9007199254740991
    or p_final1::text = 'NaN' or p_final2::text = 'NaN'
    or (p_notas is not null and length(p_notas) > 20000) then
    raise exception using errcode = '22023', message = 'Revisa las lecturas finales y las notas.';
  end if;

  -- Reintentar el mismo envío tras un corte de red confirma el registro original,
  -- incluso si al reabrir la aplicación ya cambió la fecha en México.
  if p_modulo = 'pozos' then
    select l.pozo1_fin final1, l.pozo2_fin final2, l.notas, l.creado_por
      into existente from public.lecturas_pozos_admin l where l.id = p_id;
  else
    select l.alim_fin final1, l.acep_fin final2, l.notas, l.creado_por
      into existente from public.lecturas_uf_admin l where l.id = p_id;
  end if;
  if found then
    if existente.creado_por = cuenta and existente.final1 = p_final1
      and existente.final2 = p_final2 and existente.notas is not distinct from notas_limpias then
      return p_id;
    end if;
    raise exception using errcode = '23505', message = 'El identificador ya corresponde a otra captura.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('copamex:lectura-admin:' || p_modulo || ':' || fecha_captura::text || ':dia', 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('copamex:lectura-admin:secuencia:' || p_modulo, 0)
  );

  if p_modulo = 'pozos' then
    select exists (
      select 1 from public.lecturas_pozos_admin l
      where l.fecha_operativa = fecha_captura and l.turno = 'dia'
    ) or exists (
      select 1 from public.lecturas_pozos l
      join public.turnos_operativos t on t.id = l.turno_id
      where t.area::text = 'calderas' and t.fecha_operativa = fecha_captura and t.turno = 'dia'
        and l.eliminado_en is null
    ) into ocupado;
  else
    select exists (
      select 1 from public.lecturas_uf_admin l
      where l.fecha_operativa = fecha_captura and l.turno = 'dia'
    ) or exists (
      select 1 from public.lecturas_uf l
      join public.turnos_operativos t on t.id = l.turno_id
      where t.area::text = 'calderas' and t.fecha_operativa = fecha_captura and t.turno = 'dia'
        and l.eliminado_en is null
    ) into ocupado;
  end if;
  if ocupado then
    raise exception using errcode = '23505', message = 'Ya hay una lectura registrada para hoy.';
  end if;

  select * into inicio from private.inicio_medicion_admin(p_modulo, fecha_captura, 'dia');
  if inicio.inicial1 is null or inicio.inicial2 is null then
    raise exception using errcode = '22023', message = 'No hay lectura inicial anterior ni base histórica para hoy.';
  end if;
  if p_final1 < inicio.inicial1 or p_final2 < inicio.inicial2 then
    raise exception using errcode = '22023', message = 'La lectura final no puede ser menor que la lectura inicial automática.';
  end if;

  if p_modulo = 'pozos' then
    insert into public.lecturas_pozos_admin
      (id, fecha_operativa, turno, pozo1_ini, pozo1_fin, pozo2_ini, pozo2_fin, notas, creado_por)
    values (p_id, fecha_captura, 'dia', inicio.inicial1, p_final1, inicio.inicial2, p_final2, notas_limpias, cuenta);
  else
    insert into public.lecturas_uf_admin
      (id, fecha_operativa, turno, alim_ini, alim_fin, acep_ini, acep_fin, notas, creado_por)
    values (p_id, fecha_captura, 'dia', inicio.inicial1, p_final1, inicio.inicial2, p_final2, notas_limpias, cuenta);
  end if;
  return p_id;
end;
$function$;

alter function public.consultar_referencia_diaria_medicion_admin(text) owner to postgres;
alter function public.crear_medicion_diaria_admin(text, uuid, numeric, numeric, text) owner to postgres;
revoke all on function public.consultar_referencia_diaria_medicion_admin(text) from public, anon, authenticated, service_role;
revoke all on function public.crear_medicion_diaria_admin(text, uuid, numeric, numeric, text) from public, anon, authenticated, service_role;
grant execute on function public.consultar_referencia_diaria_medicion_admin(text) to authenticated;
grant execute on function public.crear_medicion_diaria_admin(text, uuid, numeric, numeric, text) to authenticated;

-- Retira las RPC editables por fecha/turno; la interfaz usa las funciones diarias nuevas.
revoke all on function public.consultar_referencia_medicion_admin(text, date, public.turno_tipo) from public, anon, authenticated, service_role;
revoke all on function public.crear_medicion_admin(text, uuid, date, public.turno_tipo, numeric, numeric, text) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
