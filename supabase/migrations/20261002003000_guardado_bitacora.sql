-- Bloque 7: varias notas de Bitácora por turno, Calderas y PTAR.
-- Ejecutar completo como postgres después de 029.
-- No cambia registros, tablas, RLS ni permisos administrativos existentes.
begin;
create or replace function public.guardar_nota_bitacora(
  p_id uuid, p_turno_id uuid, p_texto text, p_original jsonb default null
)
returns setof public.bitacora
language plpgsql volatile security invoker set search_path='' as $$
declare
  cuenta uuid:=auth.uid(); rol public.rol_usuario:=private.rol_actual();
  t public.turnos_operativos%rowtype; nota public.bitacora%rowtype;
  texto_limpio text:=btrim(p_texto); instante timestamptz;
begin
  if cuenta is null or not coalesce(rol in ('calderas','ptar'),false) then
    raise exception using errcode='42501',message='Solo una cuenta de área activa puede guardar Bitácora.';
  end if;
  if p_id is null or p_turno_id is null or texto_limpio is null or texto_limpio !~ '[^[:space:]]' then
    raise exception using errcode='22023',message='Escribe lo relevante del turno antes de guardar la nota.';
  end if;
  if p_original is not null and jsonb_typeof(p_original)<>'object' then
    raise exception using errcode='22023',message='Actualiza la nota antes de corregirla.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('copamex:bitacora:nota:'||p_id::text,0));
  -- El cierre de turno toma un bloqueo incompatible con este FOR SHARE.
  select * into t from public.turnos_operativos where id=p_turno_id for share;
  if not found or t.iniciado_por is distinct from cuenta or t.area::text<>rol::text then
    raise exception using errcode='42501',message='La nota debe pertenecer a un turno de tu cuenta y área.';
  end if;
  -- Sin FOR UPDATE: un reintento exacto también se confirma después del plazo.
  select * into nota from public.bitacora where id=p_id;
  if found then
    if nota.turno_id is distinct from p_turno_id or nota.creado_por is distinct from cuenta
      or nota.eliminado_en is not null or nota.eliminado_por is not null then
      raise exception using errcode='42501',message='Esta nota no está disponible para tu cuenta.';
    end if;
    if nota.texto=texto_limpio then return next nota; return; end if;
    if p_original is null then
      raise exception using errcode='23505',message='La nota ya fue recibida con otro texto. Usa Corregir nota.';
    end if;
    if p_original is distinct from jsonb_build_object('texto',nota.texto) then
      raise exception using errcode='40001',message='La nota cambió desde que la abriste. Actualiza antes de corregir.';
    end if;
    if not private.en_plazo_correccion(nota.capturado_en,nota.recibido_en)
      or not private.puede_capturar_en_turno(p_turno_id,'bitacora',nota.capturado_en) then
      raise exception using errcode='42501',message='Terminó la hora para corregir esta nota. Solicita la corrección al administrador.';
    end if;
    update public.bitacora set texto=texto_limpio
      where id=p_id and jsonb_build_object('texto',texto)=p_original
      returning * into nota;
    if not found then
      raise exception using errcode='40001',message='La nota cambió o terminó el permiso para corregir. Actualiza.';
    end if;
    return next nota; return;
  end if;
  if p_original is not null then
    raise exception using errcode='22023',message='No se encontró la nota que intentas corregir.';
  end if;
  if t.finalizado_en is not null then
    raise exception using errcode='42501',message='El turno está cerrado. Inicia un turno para guardar una nota nueva.';
  end if;
  instante:=clock_timestamp();
  if not private.puede_capturar_en_turno(p_turno_id,'bitacora',instante) then
    raise exception using errcode='42501',message='No se puede guardar Bitácora en el turno seleccionado.';
  end if;
  insert into public.bitacora(id,turno_id,texto,capturado_en,creado_por)
    values(p_id,p_turno_id,texto_limpio,instante,cuenta) returning * into nota;
  return next nota;
end;
$$;
alter function public.guardar_nota_bitacora(uuid,uuid,text,jsonb) owner to postgres;
revoke all on function public.guardar_nota_bitacora(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.guardar_nota_bitacora(uuid,uuid,text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
