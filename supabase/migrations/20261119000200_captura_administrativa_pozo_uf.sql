-- Captura de Pozos y UF por Administración, vinculada a un turno de Calderas.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function public.consultar_medicion_admin(p_modulo text, p_fecha date, p_turno public.turno_tipo)
returns jsonb language plpgsql stable security definer set search_path = ''
as $func$
declare
  t public.turnos_operativos%rowtype;
  tabla regclass;
  tabla_base regclass;
  finales text[];
  columnas_base text[];
  corte date;
  inicial1 numeric;
  inicial2 numeric;
  lectura_id uuid;
  operador text;
begin
  if auth.uid() is null or not coalesce(private.es_admin(), false) then
    raise exception using errcode = '42501', message = 'Solo Administración puede gestionar estas lecturas.';
  end if;
  case p_modulo
    when 'pozos' then
      tabla := 'public.lecturas_pozos'::regclass;
      tabla_base := to_regclass('private.base_historica_pozos');
      finales := array['pozo1_fin', 'pozo2_fin'];
      columnas_base := array['pozo1_lectura_inicial', 'pozo2_lectura_inicial'];
    when 'uf' then
      tabla := 'public.lecturas_uf'::regclass;
      tabla_base := to_regclass('private.base_historica_uf');
      finales := array['alim_fin', 'acep_fin'];
      columnas_base := array['alimentacion_lectura_inicial', 'aceptacion_lectura_inicial'];
    else raise exception using errcode = '22023', message = 'Módulo inválido.';
  end case;

  select * into t from public.turnos_operativos
  where area = 'calderas' and fecha_operativa = p_fecha and turno = p_turno;
  if not found then return null; end if;

  select concat_ws(' · ', o.nombre, a.nombre) into operador from public.operadores o
  left join public.operadores a on a.id = t.operador_acompanante_id
  where o.id = t.operador_id;

  execute format('select id from %s where turno_id = $1', tabla) into lectura_id using t.id;
  if lectura_id is null then
    if tabla_base is not null then
      execute format('select fecha_corte, %I, %I from %s
        where anio = extract(year from $1::date) and fecha_corte <= $1', columnas_base[1], columnas_base[2], tabla_base)
        into corte, inicial1, inicial2 using p_fecha;
    end if;
    declare
      anterior1 numeric;
      anterior2 numeric;
    begin
      execute format('select l.%I, l.%I from %s l
        join public.turnos_operativos anterior on anterior.id = l.turno_id
        where anterior.area = ''calderas'' and anterior.iniciado_en < $1 and l.eliminado_en is null
          and ($2::date is null or anterior.fecha_operativa >= $2)
        order by anterior.iniciado_en desc, l.capturado_en desc, l.id desc limit 1',
        finales[1], finales[2], tabla)
        into anterior1, anterior2 using t.iniciado_en, corte;
      inicial1 := coalesce(anterior1, inicial1);
      inicial2 := coalesce(anterior2, inicial2);
    end;
  end if;
  return jsonb_build_object('turno', jsonb_build_object('id', t.id, 'area', t.area,
    'turno', t.turno, 'fecha_operativa', t.fecha_operativa), 'operador', operador,
    'inicial1', inicial1, 'inicial2', inicial2, 'lectura', case when lectura_id is null
      then null else private.snapshot_revision_captura(p_modulo, lectura_id) end);
end;
$func$;

create function public.crear_medicion_admin(p_modulo text, p_id uuid, p_turno_id uuid,
  p_inicial1 numeric, p_final1 numeric, p_inicial2 numeric, p_final2 numeric, p_notas text)
returns uuid language plpgsql volatile security definer set search_path = ''
as $func$
declare
  cuenta uuid := auth.uid();
  t public.turnos_operativos%rowtype;
  referencia jsonb;
  original jsonb;
  valores jsonb;
  instante timestamptz;
begin
  if cuenta is null or not coalesce(private.es_admin(), false) then
    raise exception using errcode = '42501', message = 'Solo Administración puede capturar estas lecturas.';
  end if;
  if p_modulo is null or p_modulo not in ('pozos', 'uf') or p_id is null or p_turno_id is null
    or exists (select 1 from unnest(array[p_inicial1,p_final1,p_inicial2,p_final2]) v
      where v is null or v < 0 or v > 9007199254740991 or v::text = 'NaN')
    or p_final1 < p_inicial1 or p_final2 < p_inicial2
    or length(p_notas) > 20000 then
    raise exception using errcode = '22023', message = 'Revisa las lecturas y las notas.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('copamex:' || p_modulo || ':turno:' || p_turno_id::text, 0));
  select * into t from public.turnos_operativos where id = p_turno_id and area = 'calderas' for share;
  if not found then
    raise exception using errcode = '22023', message = 'Selecciona un turno de Calderas registrado.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('copamex:' || p_modulo || ':lectura_inicial:calderas', 0));
  p_notas := nullif(btrim(p_notas), '');
  referencia := public.consultar_medicion_admin(p_modulo, t.fecha_operativa, t.turno);
  original := referencia->'lectura'->'registro';
  if p_modulo = 'pozos' then
    valores := jsonb_build_object('pozo1_ini', p_inicial1, 'pozo1_fin', p_final1,
      'pozo2_ini', p_inicial2, 'pozo2_fin', p_final2, 'notas', p_notas);
  else
    valores := jsonb_build_object('alim_ini', p_inicial1, 'alim_fin', p_final1,
      'acep_ini', p_inicial2, 'acep_fin', p_final2, 'notas', p_notas);
  end if;
  if original is not null then
    if original->>'id' = p_id::text and original->>'creado_por' = cuenta::text
      and original->>'eliminado_en' is null and original @> valores then
      return p_id;
    end if;
    raise exception using errcode = '23505', message = 'El turno ya tiene una lectura. Actualiza la consulta.';
  end if;
  if (referencia->>'inicial1' is not null and p_inicial1 is distinct from (referencia->>'inicial1')::numeric)
    or (referencia->>'inicial2' is not null and p_inicial2 is distinct from (referencia->>'inicial2')::numeric) then
    raise exception using errcode = '40001', message = 'La referencia inicial cambió. Vuelve a consultar el turno.';
  end if;

  -- En un turno cerrado, la lectura se asigna al cierre y el trigger registra la recepción real.
  instante := coalesce(t.finalizado_en, clock_timestamp());
  if p_modulo = 'pozos' then
    insert into public.lecturas_pozos(id, turno_id, pozo1_ini, pozo1_fin, pozo2_ini, pozo2_fin, notas, capturado_en, creado_por)
    values (p_id, t.id, p_inicial1, p_final1, p_inicial2, p_final2, p_notas, instante, cuenta);
  else
    insert into public.lecturas_uf(id, turno_id, alim_ini, alim_fin, acep_ini, acep_fin, notas, capturado_en, creado_por)
    values (p_id, t.id, p_inicial1, p_final1, p_inicial2, p_final2, p_notas, instante, cuenta);
  end if;
  return p_id;
end;
$func$;

alter function public.consultar_medicion_admin(text,date,public.turno_tipo) owner to postgres;
alter function public.crear_medicion_admin(text,uuid,uuid,numeric,numeric,numeric,numeric,text) owner to postgres;
revoke all on function public.consultar_medicion_admin(text,date,public.turno_tipo) from public, anon, authenticated, service_role;
revoke all on function public.crear_medicion_admin(text,uuid,uuid,numeric,numeric,numeric,numeric,text) from public, anon, authenticated, service_role;
grant execute on function public.consultar_medicion_admin(text,date,public.turno_tipo) to authenticated;
grant execute on function public.crear_medicion_admin(text,uuid,uuid,numeric,numeric,numeric,numeric,text) to authenticated;

-- Las correcciones administrativas pasan por revisar_captura_admin y conservan auditoría y revisión.
revoke insert, update on public.lecturas_pozos, public.lecturas_uf from public, anon, authenticated;
revoke execute on function public.guardar_lectura_pozos(uuid,uuid,numeric,numeric,numeric,numeric,text,jsonb) from public, anon, authenticated;
revoke execute on function public.guardar_lectura_uf(uuid,uuid,numeric,numeric,numeric,numeric,text,jsonb) from public, anon, authenticated;
create policy escritura_solo_rpc on public.lecturas_pozos as restrictive for all to authenticated
  using (true) with check (false);
create policy escritura_solo_rpc on public.lecturas_uf as restrictive for all to authenticated
  using (true) with check (false);

notify pgrst, 'reload schema';
commit;
