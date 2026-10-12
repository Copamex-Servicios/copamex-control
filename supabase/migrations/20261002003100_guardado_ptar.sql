-- Bloque 8: varias lecturas PTAR por turno. Requiere migraciones hasta 030.
-- No modifica lecturas, tablas, RLS ni permisos administrativos existentes.
-- Mediciones DQO/SST en mg/L según el esquema actual; vacíos son NULL.
begin;
create or replace function public.guardar_lectura_ptar(
  p_id uuid, p_turno_id uuid, p_mediciones jsonb,
  p_notas text default null, p_original jsonb default null
)
returns setof public.lecturas_ptar
language plpgsql volatile security invoker set search_path='' as $$
declare
  cuenta uuid:=auth.uid(); t public.turnos_operativos%rowtype;
  lectura public.lecturas_ptar%rowtype; entrada record;
  notas_limpias text:=nullif(btrim(p_notas),''); enviados jsonb; actuales jsonb; instante timestamptz;
begin
  if cuenta is null or private.rol_actual() is distinct from 'ptar'::public.rol_usuario then
    raise exception using errcode='42501',message='Solo una cuenta de PTAR activa puede guardar estas lecturas.';
  end if;
  if p_id is null or p_turno_id is null or p_mediciones is null or jsonb_typeof(p_mediciones)<>'object' then
    raise exception using errcode='22023',message='Selecciona un turno y completa al menos una medición PTAR.';
  end if;
  select * into entrada from jsonb_to_record(p_mediciones) as r(
    dqo_sand_float numeric,dqo_t03_04 numeric,dqo_colector numeric,dqo_pila numeric,
    sst_sand_float numeric,sst_t03_04 numeric,sst_colector numeric,sst_pila numeric);
  enviados:=to_jsonb(entrada)||jsonb_build_object('notas',notas_limpias);
  if not exists(select 1 from jsonb_each(enviados-'notas') f where f.value<>'null'::jsonb)
    or exists(select 1 from jsonb_each_text(enviados-'notas') f where f.value in ('NaN','Infinity','-Infinity')) then
    raise exception using errcode='22023',message='Completa al menos una medición PTAR con un número válido.';
  end if;
  if p_original is not null and jsonb_typeof(p_original)<>'object' then
    raise exception using errcode='22023',message='Actualiza la lectura antes de corregirla.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('copamex:ptar:lectura:'||p_id::text,0));
  select * into t from public.turnos_operativos where id=p_turno_id for share;
  if not found or t.area<>'ptar' or t.iniciado_por is distinct from cuenta then
    raise exception using errcode='42501',message='La lectura debe pertenecer a un turno de tu cuenta en PTAR.';
  end if;
  -- SELECT sin FOR UPDATE permite confirmar reintentos cuando vence UPDATE.
  select * into lectura from public.lecturas_ptar where id=p_id;
  if found then
    if lectura.turno_id is distinct from p_turno_id or lectura.creado_por is distinct from cuenta
      or lectura.eliminado_en is not null or lectura.eliminado_por is not null then
      raise exception using errcode='42501',message='Esta lectura no está disponible para tu cuenta.';
    end if;
    actuales:=jsonb_build_object('dqo_sand_float',lectura.dqo_sand_float,'dqo_t03_04',lectura.dqo_t03_04,
      'dqo_colector',lectura.dqo_colector,'dqo_pila',lectura.dqo_pila,'sst_sand_float',lectura.sst_sand_float,
      'sst_t03_04',lectura.sst_t03_04,'sst_colector',lectura.sst_colector,'sst_pila',lectura.sst_pila,'notas',lectura.notas);
    if enviados=actuales then return next lectura; return; end if;
    if p_original is null then
      raise exception using errcode='23505',message='La lectura ya fue recibida con otros valores. Usa Corregir lectura.';
    end if;
    if p_original is distinct from actuales then
      raise exception using errcode='40001',message='La lectura cambió desde que la abriste. Actualiza antes de corregir.';
    end if;
    if not private.en_plazo_correccion(lectura.capturado_en,lectura.recibido_en)
      or not private.puede_capturar_en_turno(p_turno_id,'ptar',lectura.capturado_en) then
      raise exception using errcode='42501',message='Terminó la hora para corregir esta lectura. Solicita la corrección al administrador.';
    end if;
    update public.lecturas_ptar set dqo_sand_float=entrada.dqo_sand_float,dqo_t03_04=entrada.dqo_t03_04,
      dqo_colector=entrada.dqo_colector,dqo_pila=entrada.dqo_pila,sst_sand_float=entrada.sst_sand_float,
      sst_t03_04=entrada.sst_t03_04,sst_colector=entrada.sst_colector,sst_pila=entrada.sst_pila,notas=notas_limpias
      where id=p_id and jsonb_build_object('dqo_sand_float',dqo_sand_float,'dqo_t03_04',dqo_t03_04,
        'dqo_colector',dqo_colector,'dqo_pila',dqo_pila,'sst_sand_float',sst_sand_float,
        'sst_t03_04',sst_t03_04,'sst_colector',sst_colector,'sst_pila',sst_pila,'notas',notas)=p_original
      returning * into lectura;
    if not found then
      raise exception using errcode='40001',message='La lectura cambió o terminó el permiso para corregir. Actualiza.';
    end if;
    return next lectura; return;
  end if;
  if p_original is not null then
    raise exception using errcode='22023',message='No se encontró la lectura que intentas corregir.';
  end if;
  if t.finalizado_en is not null then
    raise exception using errcode='42501',message='El turno está cerrado. Inicia tu turno para guardar lecturas PTAR.';
  end if;
  instante:=clock_timestamp();
  if not private.puede_capturar_en_turno(p_turno_id,'ptar',instante) then
    raise exception using errcode='42501',message='No se puede guardar PTAR en el turno seleccionado.';
  end if;
  insert into public.lecturas_ptar(id,turno_id,dqo_sand_float,dqo_t03_04,dqo_colector,dqo_pila,
    sst_sand_float,sst_t03_04,sst_colector,sst_pila,notas,capturado_en,creado_por)
    values(p_id,p_turno_id,entrada.dqo_sand_float,entrada.dqo_t03_04,entrada.dqo_colector,entrada.dqo_pila,
      entrada.sst_sand_float,entrada.sst_t03_04,entrada.sst_colector,entrada.sst_pila,notas_limpias,instante,cuenta)
    returning * into lectura;
  return next lectura;
end;
$$;
alter function public.guardar_lectura_ptar(uuid,uuid,jsonb,text,jsonb) owner to postgres;
revoke all on function public.guardar_lectura_ptar(uuid,uuid,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.guardar_lectura_ptar(uuid,uuid,jsonb,text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
