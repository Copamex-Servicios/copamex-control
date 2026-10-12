-- Fase 6. Guardado online atómico de muestras y resultados de calidad.
-- Ejecutar completo como postgres, después de la migración 028.
-- La RPC original de 023 se conserva para su futuro flujo de sincronización.
-- Esta función no recibe fechas, autoría ni límites del navegador.
begin;

create or replace function private.resumen_muestra_calidad_online(p_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select to_jsonb(m) || jsonb_build_object(
    'turno', to_jsonb(t) || jsonb_build_object('operador', jsonb_build_object('id',o.id,'nombre',o.nombre)),
    'resultados', coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object(
      'punto',jsonb_build_object('id',p.id,'nombre',p.nombre,'area',p.area),
      'parametro',jsonb_build_object('id',q.id,'nombre',q.nombre,'unidad',q.unidad)
    ) order by r.id)
      from public.resultados_calidad r join public.puntos_muestreo p on p.id=r.punto_id
      join public.parametros_calidad q on q.id=r.parametro_id where r.muestra_id=m.id), '[]'::jsonb)
  ) from public.muestras_calidad m join public.turnos_operativos t on t.id=m.turno_id
    join public.operadores o on o.id=t.operador_id where m.id=p_id;
$$;
alter function private.resumen_muestra_calidad_online(uuid) owner to postgres;
revoke all on function private.resumen_muestra_calidad_online(uuid) from public, anon, authenticated;

create or replace function public.guardar_muestra_calidad_online(
  p_id uuid, p_turno_id uuid, p_resultados jsonb,
  p_notas text default null, p_original jsonb default null
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  cuenta uuid := auth.uid();
  rol public.rol_usuario := private.rol_actual();
  t public.turnos_operativos%rowtype;
  m public.muestras_calidad%rowtype;
  enviados jsonb;
  actuales jsonb;
  anterior jsonb;
  notas_limpias text := nullif(btrim(p_notas),'');
  instante timestamptz;
begin
  -- INSERT de calidad está reservado a una operación completa; esta RPC es
  -- elevada y valida explícitamente cuenta, área, turno y plazo en cada caso.
  if cuenta is null or not coalesce(rol in ('calderas','ptar'),false) then
    raise exception using errcode='42501', message='Solo una cuenta de área activa puede guardar Calidad.';
  end if;
  if p_id is null or p_turno_id is null or p_resultados is null
    or jsonb_typeof(p_resultados) <> 'array' then
    raise exception using errcode='22023', message='La muestra necesita un turno y una lista de resultados.';
  end if;
  if jsonb_array_length(p_resultados)=0 then
    raise exception using errcode='22023', message='Escribe al menos un resultado de Calidad.';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_resultados)
    as r(id uuid,punto_id uuid,parametro_id uuid,valor numeric)
    where r.id is null or r.punto_id is null or r.parametro_id is null or r.valor is null
      or r.valor::text in ('NaN','Infinity','-Infinity')) then
    raise exception using errcode='22023', message='Revisa los puntos, parámetros y valores numéricos de Calidad.';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_resultados)
    as r(id uuid,punto_id uuid,parametro_id uuid,valor numeric) group by r.id having count(*)>1)
    or exists (select 1 from jsonb_to_recordset(p_resultados)
    as r(id uuid,punto_id uuid,parametro_id uuid,valor numeric) group by r.punto_id,r.parametro_id having count(*)>1) then
    raise exception using errcode='22023', message='No repitas un punto y parámetro dentro de la misma muestra.';
  end if;
  if p_original is not null and jsonb_typeof(p_original)<>'object' then
    raise exception using errcode='22023', message='Actualiza la muestra antes de corregirla.';
  end if;
  select jsonb_agg(jsonb_build_object('id',r.id,'punto_id',r.punto_id,
    'parametro_id',r.parametro_id,'valor',r.valor) order by r.id) into enviados
  from jsonb_to_recordset(p_resultados) as r(id uuid,punto_id uuid,parametro_id uuid,valor numeric);

  -- Comparte la llave con la RPC original para serializar el mismo UUID.
  perform pg_advisory_xact_lock(hashtextextended('copamex.muestras_calidad:' || p_id::text,0));
  select * into t from public.turnos_operativos where id=p_turno_id for share;
  if not found or t.iniciado_por is distinct from cuenta or t.area::text<>rol::text then
    raise exception using errcode='42501', message='La muestra debe pertenecer a un turno de tu cuenta y área.';
  end if;
  -- Bloquear resultados antes que muestra coincide con las correcciones
  -- directas permitidas por RLS y evita invertir ese orden de bloqueo.
  perform 1 from public.resultados_calidad where muestra_id=p_id order by id for update;
  select * into m from public.muestras_calidad where id=p_id for update;
  if found then
    if m.turno_id is distinct from p_turno_id or m.creado_por is distinct from cuenta
      or m.eliminado_en is not null or m.eliminado_por is not null then
      raise exception using errcode='42501', message='Esta muestra no está disponible para tu cuenta.';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'punto_id',r.punto_id,
      'parametro_id',r.parametro_id,'valor',r.valor) order by r.id),'[]'::jsonb) into actuales
    from public.resultados_calidad r where r.muestra_id=p_id;
    if actuales=enviados and m.notas is not distinct from notas_limpias then
      -- Confirmación sin escritura, incluso después de cerrar o vencer la hora.
      return private.resumen_muestra_calidad_online(p_id);
    end if;
    if p_original is null then
      raise exception using errcode='23505', message='La muestra ya fue recibida con otros valores. Usa Corregir muestra.';
    end if;
    anterior := jsonb_build_object('hora_muestra',m.hora_muestra,'notas',m.notas,'resultados',actuales);
    if p_original is distinct from anterior then
      raise exception using errcode='40001', message='La muestra cambió desde que la abriste. Actualiza antes de corregir.';
    end if;
    -- Al corregir solo cambian valores/notas; no se agregan ni quitan resultados.
    if exists (
      (select r.id,r.punto_id,r.parametro_id from jsonb_to_recordset(enviados)
        as r(id uuid,punto_id uuid,parametro_id uuid,valor numeric)
       except select r.id,r.punto_id,r.parametro_id from public.resultados_calidad r where r.muestra_id=p_id)
      union all
      (select r.id,r.punto_id,r.parametro_id from public.resultados_calidad r where r.muestra_id=p_id
       except select r.id,r.punto_id,r.parametro_id from jsonb_to_recordset(enviados)
        as r(id uuid,punto_id uuid,parametro_id uuid,valor numeric))
    ) then
      raise exception using errcode='22023', message='La corrección conserva los puntos y parámetros originales de la muestra.';
    end if;
    if not private.en_plazo_correccion(m.capturado_en,m.recibido_en)
      or not private.puede_capturar_en_turno(p_turno_id,'calidad',m.capturado_en) then
      raise exception using errcode='42501', message='Terminó la hora para corregir esta muestra. Solicita la corrección al administrador.';
    end if;
    update public.resultados_calidad r set valor=e.valor
    from jsonb_to_recordset(enviados) as e(id uuid,punto_id uuid,parametro_id uuid,valor numeric)
    where r.id=e.id and r.muestra_id=p_id and r.valor is distinct from e.valor;
    if m.notas is distinct from notas_limpias then
      update public.muestras_calidad set notas=notas_limpias where id=p_id;
    end if;
    return private.resumen_muestra_calidad_online(p_id);
  end if;
  if p_original is not null then
    raise exception using errcode='22023', message='No se encontró la muestra que quieres corregir.';
  end if;
  if t.finalizado_en is not null then
    raise exception using errcode='42501', message='El turno está cerrado. Inicia un turno para capturar Calidad.';
  end if;
  if exists (select 1 from jsonb_to_recordset(enviados)
    as r(id uuid,punto_id uuid,parametro_id uuid,valor numeric)
    where exists (select 1 from public.resultados_calidad where id=r.id)
      or not exists (select 1 from public.puntos_muestreo p where p.id=r.punto_id
        and p.activo and (p.area is null or p.area=t.area))
      or not exists (select 1 from public.parametros_calidad q where q.id=r.parametro_id and q.activo)) then
    raise exception using errcode='22023', message='Selecciona puntos y parámetros activos del área y resultados nuevos.';
  end if;
  instante := clock_timestamp();
  if not private.puede_capturar_en_turno(p_turno_id,'calidad',instante) then
    raise exception using errcode='42501', message='No se puede guardar Calidad en el turno seleccionado.';
  end if;
  insert into public.muestras_calidad(id,turno_id,hora_muestra,notas,capturado_en,creado_por)
  values(p_id,p_turno_id,(instante at time zone 'America/Mexico_City')::time,notas_limpias,instante,cuenta);
  insert into public.resultados_calidad(id,muestra_id,punto_id,parametro_id,valor)
  select r.id,p_id,r.punto_id,r.parametro_id,r.valor from jsonb_to_recordset(enviados)
    as r(id uuid,punto_id uuid,parametro_id uuid,valor numeric);
  return private.resumen_muestra_calidad_online(p_id);
end;
$$;
alter function public.guardar_muestra_calidad_online(uuid,uuid,jsonb,text,jsonb) owner to postgres;
revoke all on function public.guardar_muestra_calidad_online(uuid,uuid,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.guardar_muestra_calidad_online(uuid,uuid,jsonb,text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;

