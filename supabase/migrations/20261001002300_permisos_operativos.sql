-- Fase 1: permisos de turnos, capturas y consulta de Planta.
-- Ejecutar completo como postgres después de las migraciones anteriores.
-- Calderas: Bitácora, Pozos, UF y Calidad. PTAR: Bitácora, PTAR y Calidad.
-- Ambas áreas leen Planta. Los administradores corrigen y hacen borrado lógico.
-- La corrección del operador vence una hora después de capturado_en original.
-- La cuenta de área es compartida; la persona queda vinculada por el turno.
-- RLS distingue cuentas técnicas, no autentica individualmente a cada persona.
--
-- Calidad se inserta con guardar_muestra_calidad: muestra y resultados juntos.
-- Los resultados se guardan en tablas normalizadas; JSONB solo transporta el lote.
-- Las capturas iniciales offline pueden llegar después de una hora.
-- Un reintento no sobrescribe lo recibido ni reinicia el plazo de corrección.
--
-- Referencia: https://supabase.com/docs/guides/database/postgres/row-level-security

begin;

create or replace function private.puede_capturar_en_turno(
  p_turno_id uuid,
  p_modulo text,
  p_fecha_captura timestamptz
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.turnos_operativos t
    where t.id = p_turno_id
      and t.iniciado_por = (select auth.uid())
      and t.area::text = (select private.rol_actual())::text
      and p_fecha_captura >= t.iniciado_en
      and p_fecha_captura <= clock_timestamp()
      and (t.finalizado_en is null or p_fecha_captura <= t.finalizado_en)
      and case
        when p_modulo in ('bitacora', 'calidad') then true
        when p_modulo in ('pozos', 'uf') then t.area = 'calderas'::public.area_planta
        when p_modulo = 'ptar' then t.area = 'ptar'::public.area_planta
        else false
      end
  );
$$;

alter function private.puede_capturar_en_turno(uuid, text, timestamptz)
  owner to postgres;
revoke all on function private.puede_capturar_en_turno(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function private.puede_capturar_en_turno(uuid, text, timestamptz)
  to authenticated;

-- El bloqueo del turno evita que se cierre entre la validación y el INSERT.
create or replace function private.validar_turno_captura()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  turno_captura public.turnos_operativos%rowtype;
begin
  select t.* into turno_captura
  from public.turnos_operativos t where t.id = new.turno_id
  for share;

  if not found then
    raise exception using errcode = '42501',
      message = 'El turno no está disponible para recibir esta captura.';
  end if;

  if new.capturado_en < turno_captura.iniciado_en
    or new.capturado_en > clock_timestamp()
    or (turno_captura.finalizado_en is not null
        and new.capturado_en > turno_captura.finalizado_en)
    or (tg_argv[0] in ('pozos', 'uf') and turno_captura.area <> 'calderas')
    or (tg_argv[0] = 'ptar' and turno_captura.area <> 'ptar')
  then
    raise exception using errcode = '22023',
      message = 'El módulo y la fecha original de captura deben corresponder al turno.';
  end if;
  return new;
end;
$$;

alter function private.validar_turno_captura() owner to postgres;
revoke all on function private.validar_turno_captura()
  from public, anon, authenticated;

do $$
declare
  tabla_captura text;
  modulo_captura text;
begin
  foreach tabla_captura in array array[
    'bitacora', 'lecturas_pozos', 'lecturas_uf',
    'lecturas_ptar', 'muestras_calidad'
  ]
  loop
    modulo_captura := case tabla_captura
      when 'bitacora' then 'bitacora'
      when 'lecturas_pozos' then 'pozos'
      when 'lecturas_uf' then 'uf'
      when 'lecturas_ptar' then 'ptar'
      else 'calidad' end;
    execute format('drop trigger if exists validar_turno_captura on public.%I', tabla_captura);
    execute format(
      'create trigger validar_turno_captura before insert on public.%I '
      'for each row execute function private.validar_turno_captura(%L)',
      tabla_captura, modulo_captura
    );
  end loop;
end;
$$;

create or replace function private.proteger_turno_operativo()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  es_administrador boolean;
  rol_cuenta public.rol_usuario;
  ultima_captura timestamptz;
begin
  es_administrador := current_user in ('postgres', 'service_role');
  if not es_administrador then
    es_administrador := private.es_admin();
  end if;

  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.iniciado_por := auth.uid();
    end if;

    if not es_administrador then
      rol_cuenta := private.rol_actual();
      if not coalesce(rol_cuenta in ('calderas', 'ptar'), false) then
        raise exception using errcode = '42501',
          message = 'Solo una cuenta de área activa puede iniciar un turno.';
      end if;
      new.area := rol_cuenta::text::public.area_planta;
      if not exists (
        select 1 from public.operadores where id = new.operador_id and activo
      ) then
        raise exception using errcode = '22023',
          message = 'Selecciona un operador activo.';
      end if;
    end if;

    if new.iniciado_en > clock_timestamp() then
      raise exception using errcode = '22023',
        message = 'La hora de inicio del turno no puede estar en el futuro.';
    end if;
  else
    if row(new.id, new.fecha_operativa, new.area, new.turno,
           new.iniciado_por, new.iniciado_en)
      is distinct from
       row(old.id, old.fecha_operativa, old.area, old.turno,
           old.iniciado_por, old.iniciado_en)
    then
      raise exception using errcode = '42501',
        message = 'La identidad, fecha, área, tipo, cuenta y hora original del turno se conservan.';
    end if;

    if new is not distinct from old then
      return new;
    end if;

    -- Las cuentas de área conservan el mismo operador durante el turno.
    -- Un administrador puede corregir una selección errónea; queda auditado.
    if not es_administrador then
      if new.operador_id is distinct from old.operador_id then
        raise exception using errcode = '42501',
          message = 'La cuenta de área no puede cambiar el operador de un turno iniciado.';
      end if;
      if old.finalizado_en is not null then
        raise exception using errcode = '42501',
          message = 'Un turno cerrado solo puede ser ajustado por un administrador.';
      end if;
    end if;
  end if;

  if new.finalizado_en is not null then
    if new.finalizado_en > clock_timestamp() then
      raise exception using errcode = '22023',
        message = 'La hora de cierre del turno no puede estar en el futuro.';
    end if;

    if tg_op = 'UPDATE' then
      select max(c.capturado_en) into ultima_captura
      from (
        select capturado_en from public.bitacora
          where turno_id = old.id and eliminado_en is null
        union all
        select capturado_en from public.lecturas_pozos
          where turno_id = old.id and eliminado_en is null
        union all
        select capturado_en from public.lecturas_uf
          where turno_id = old.id and eliminado_en is null
        union all
        select capturado_en from public.lecturas_ptar
          where turno_id = old.id and eliminado_en is null
        union all
        select capturado_en from public.muestras_calidad
          where turno_id = old.id and eliminado_en is null
      ) c;

      if ultima_captura is not null and new.finalizado_en < ultima_captura then
        raise exception using errcode = '22023',
          message = 'El cierre no puede ser anterior a las capturas del turno.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

alter function private.proteger_turno_operativo() owner to postgres;
revoke all on function private.proteger_turno_operativo()
  from public, anon, authenticated;

drop trigger if exists proteger_turno_operativo on public.turnos_operativos;
create trigger proteger_turno_operativo
  before insert or update on public.turnos_operativos
  for each row execute function private.proteger_turno_operativo();

alter table public.turnos_operativos enable row level security;
revoke all on table public.turnos_operativos from public, anon, authenticated;
grant select, insert, update on table public.turnos_operativos to authenticated;

drop policy if exists lectura_planta on public.turnos_operativos;
create policy lectura_planta on public.turnos_operativos
  for select to authenticated
  using ((select private.rol_actual()) is not null);

drop policy if exists alta_turno_area on public.turnos_operativos;
create policy alta_turno_area on public.turnos_operativos
  for insert to authenticated
  with check (
    iniciado_por = (select auth.uid())
    and area::text = (select private.rol_actual())::text
    and exists (select 1 from public.operadores o where o.id = operador_id and o.activo)
  );

drop policy if exists cambio_turno_autorizado on public.turnos_operativos;
create policy cambio_turno_autorizado on public.turnos_operativos
  for update to authenticated
  using (
    (select private.es_admin())
    or (iniciado_por = (select auth.uid())
        and area::text = (select private.rol_actual())::text)
  )
  with check (
    (select private.es_admin())
    or (iniciado_por = (select auth.uid())
        and area::text = (select private.rol_actual())::text)
  );

-- Capturas simples: alta inicial, lectura de Planta y corrección autorizada.
-- No se exige que el turno siga abierto al recibir una captura offline;
-- sí se exige que capturado_en pertenezca a su periodo original.
do $$
declare
  tabla_captura text;
  modulo_captura text;
  regla_correccion text;
begin
  foreach tabla_captura in array array[
    'bitacora', 'lecturas_pozos', 'lecturas_uf', 'lecturas_ptar'
  ]
  loop
    modulo_captura := case tabla_captura
      when 'bitacora' then 'bitacora'
      when 'lecturas_pozos' then 'pozos'
      when 'lecturas_uf' then 'uf'
      else 'ptar' end;

    execute format('alter table public.%I enable row level security', tabla_captura);
    execute format(
      'revoke all on table public.%I from public, anon, authenticated', tabla_captura
    );
    execute format(
      'grant select, insert, update on table public.%I to authenticated', tabla_captura
    );

    execute format('drop policy if exists lectura_planta on public.%I', tabla_captura);
    execute format(
      'create policy lectura_planta on public.%I '
      'for select to authenticated '
      'using ((select private.rol_actual()) is not null '
      'and (eliminado_en is null or (select private.es_admin())))', tabla_captura
    );

    execute format('drop policy if exists alta_captura_area on public.%I', tabla_captura);
    execute format(
      'create policy alta_captura_area on public.%I '
      'for insert to authenticated '
      'with check (creado_por = (select auth.uid()) '
      'and eliminado_en is null and eliminado_por is null '
      'and private.puede_capturar_en_turno(turno_id, %L, capturado_en))',
      tabla_captura, modulo_captura
    );

    regla_correccion := format(
      '((select private.es_admin()) or ('
      'creado_por = (select auth.uid()) and eliminado_en is null '
      'and eliminado_por is null '
      'and private.en_plazo_correccion(capturado_en, recibido_en) '
      'and private.puede_capturar_en_turno(turno_id, %L, capturado_en)))',
      modulo_captura
    );
    execute format('drop policy if exists correccion_autorizada on public.%I', tabla_captura);
    execute format(
      'create policy correccion_autorizada on public.%I '
      'for update to authenticated using (%s) with check (%s)',
      tabla_captura, regla_correccion, regla_correccion
    );
  end loop;
end;
$$;

-- Calidad: INSERT queda reservado a la operación atómica de más abajo.
alter table public.muestras_calidad enable row level security;
alter table public.resultados_calidad enable row level security;
revoke all on table public.muestras_calidad, public.resultados_calidad
  from public, anon, authenticated;
grant select, update on table public.muestras_calidad, public.resultados_calidad
  to authenticated;

drop policy if exists lectura_planta on public.muestras_calidad;
create policy lectura_planta on public.muestras_calidad
  for select to authenticated
  using (
    (select private.rol_actual()) is not null
    and (eliminado_en is null or (select private.es_admin()))
  );

drop policy if exists correccion_autorizada on public.muestras_calidad;
create policy correccion_autorizada on public.muestras_calidad
  for update to authenticated
  using (
    (select private.es_admin())
    or (creado_por = (select auth.uid()) and eliminado_en is null
        and eliminado_por is null
        and private.en_plazo_correccion(capturado_en, recibido_en)
        and private.puede_capturar_en_turno(turno_id, 'calidad', capturado_en))
  )
  with check (
    (select private.es_admin())
    or (creado_por = (select auth.uid()) and eliminado_en is null
        and eliminado_por is null
        and private.en_plazo_correccion(capturado_en, recibido_en)
        and private.puede_capturar_en_turno(turno_id, 'calidad', capturado_en))
  );

drop policy if exists lectura_planta on public.resultados_calidad;
create policy lectura_planta on public.resultados_calidad
  for select to authenticated
  using (
    (select private.rol_actual()) is not null
    and exists (
      select 1 from public.muestras_calidad m where m.id = muestra_id
    )
  );

drop policy if exists correccion_autorizada on public.resultados_calidad;
create policy correccion_autorizada on public.resultados_calidad
  for update to authenticated
  using (
    (select private.es_admin())
    or exists (
      select 1 from public.muestras_calidad m
      where m.id = muestra_id and m.creado_por = (select auth.uid())
        and m.eliminado_en is null
        and private.en_plazo_correccion(m.capturado_en, m.recibido_en)
        and private.puede_capturar_en_turno(m.turno_id, 'calidad', m.capturado_en)
    )
  )
  with check (
    (select private.es_admin())
    or exists (
      select 1 from public.muestras_calidad m
      where m.id = muestra_id and m.creado_por = (select auth.uid())
        and m.eliminado_en is null
        and private.en_plazo_correccion(m.capturado_en, m.recibido_en)
        and private.puede_capturar_en_turno(m.turno_id, 'calidad', m.capturado_en)
    )
  );

create or replace function public.guardar_muestra_calidad(
  p_id uuid,
  p_turno_id uuid,
  p_hora_muestra time,
  p_capturado_en timestamptz,
  p_resultados jsonb,
  p_notas text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  muestra_existente public.muestras_calidad%rowtype;
  area_turno public.area_planta;
begin
  -- Verificación explícita: la función elevada no confía en current_user.
  if auth.uid() is null or not coalesce(
    private.rol_actual() in ('calderas'::public.rol_usuario, 'ptar'::public.rol_usuario),
    false
  ) then
    raise exception using errcode = '42501',
      message = 'Solo una cuenta de área activa puede guardar una muestra.';
  end if;

  if p_id is null or p_turno_id is null or p_hora_muestra is null
    or p_capturado_en is null
  then
    raise exception using errcode = '22023',
      message = 'La muestra requiere UUID, turno, hora y fecha original de captura.';
  end if;
  if p_resultados is null or jsonb_typeof(p_resultados) <> 'array' then
    raise exception using errcode = '22023',
      message = 'Los resultados deben enviarse como una lista.';
  end if;
  if jsonb_array_length(p_resultados) = 0 then
    raise exception using errcode = '22023',
      message = 'La muestra debe contener al menos un resultado.';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_resultados)
      as r(id uuid, punto_id uuid, parametro_id uuid, valor numeric)
    where r.id is null or r.punto_id is null or r.parametro_id is null
      or r.valor is null or r.valor::text in ('NaN', 'Infinity', '-Infinity')
  ) then
    raise exception using errcode = '22023',
      message = 'Cada resultado requiere UUID, punto, parámetro y un valor numérico finito.';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_resultados)
      as r(id uuid, punto_id uuid, parametro_id uuid, valor numeric)
    group by r.id having count(*) > 1
  ) or exists (
    select 1 from jsonb_to_recordset(p_resultados)
      as r(id uuid, punto_id uuid, parametro_id uuid, valor numeric)
    group by r.punto_id, r.parametro_id having count(*) > 1
  ) then
    raise exception using errcode = '22023',
      message = 'La muestra no debe repetir UUID ni la combinación de punto y parámetro.';
  end if;

  -- Serializa reintentos del mismo UUID de muestra.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'copamex.muestras_calidad:' || p_id::text, 0
  ));

  select m.* into muestra_existente
  from public.muestras_calidad m where m.id = p_id
  for update;

  if found then
    if row(muestra_existente.creado_por, muestra_existente.turno_id,
           muestra_existente.hora_muestra, muestra_existente.capturado_en,
           muestra_existente.notas)
      is distinct from
       row(auth.uid(), p_turno_id, p_hora_muestra, p_capturado_en, p_notas)
    then
      raise exception using errcode = '23505',
        message = 'Ese UUID ya identifica otra captura o una versión corregida.';
    end if;

    if exists (
      (select r.id, r.punto_id, r.parametro_id, r.valor
       from jsonb_to_recordset(p_resultados)
         as r(id uuid, punto_id uuid, parametro_id uuid, valor numeric)
       except
       select c.id, c.punto_id, c.parametro_id, c.valor
       from public.resultados_calidad c where c.muestra_id = p_id)
      union all
      (select c.id, c.punto_id, c.parametro_id, c.valor
       from public.resultados_calidad c where c.muestra_id = p_id
       except
       select r.id, r.punto_id, r.parametro_id, r.valor
       from jsonb_to_recordset(p_resultados)
         as r(id uuid, punto_id uuid, parametro_id uuid, valor numeric))
    ) then
      raise exception using errcode = '23505',
        message = 'La muestra ya fue recibida con otros valores; usa la corrección autorizada.';
    end if;

    -- Reintento idéntico: confirma recepción sin actualizar fechas ni valores.
    -- Tampoco restaura una muestra que un administrador haya eliminado.
    return p_id;
  end if;

  select t.area into area_turno
  from public.turnos_operativos t where t.id = p_turno_id
  for share;

  if not found or not private.puede_capturar_en_turno(
    p_turno_id, 'calidad', p_capturado_en
  ) then
    raise exception using errcode = '42501',
      message = 'La cuenta, el área y la fecha de captura deben corresponder al turno.';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_resultados)
      as r(id uuid, punto_id uuid, parametro_id uuid, valor numeric)
    where not exists (
      select 1 from public.puntos_muestreo p
      where p.id = r.punto_id and (p.area is null or p.area = area_turno)
    ) or not exists (
      select 1 from public.parametros_calidad q where q.id = r.parametro_id
    )
  ) then
    raise exception using errcode = '22023',
      message = 'Revisa los puntos, su área y los parámetros de la muestra.';
  end if;

  -- No se rechaza una sincronización antigua solo porque un catálogo haya
  -- sido desactivado después de la captura; sus claves foráneas se conservan.
  insert into public.muestras_calidad (
    id, turno_id, hora_muestra, notas, capturado_en, creado_por
  ) values (
    p_id, p_turno_id, p_hora_muestra, p_notas, p_capturado_en, auth.uid()
  );

  insert into public.resultados_calidad (
    id, muestra_id, punto_id, parametro_id, valor
  )
  select r.id, p_id, r.punto_id, r.parametro_id, r.valor
  from jsonb_to_recordset(p_resultados)
    as r(id uuid, punto_id uuid, parametro_id uuid, valor numeric);

  return p_id;
end;
$$;

alter function public.guardar_muestra_calidad(uuid, uuid, time, timestamptz, jsonb, text)
  owner to postgres;
revoke all on function public.guardar_muestra_calidad(uuid, uuid, time, timestamptz, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.guardar_muestra_calidad(uuid, uuid, time, timestamptz, jsonb, text)
  to authenticated;

-- Lectura de alertas para Planta. Su generación y gestión se preparan aparte.
alter table public.alertas_operativas enable row level security;
revoke all on table public.alertas_operativas from public, anon, authenticated;
grant select on table public.alertas_operativas to authenticated;
drop policy if exists lectura_planta on public.alertas_operativas;
create policy lectura_planta on public.alertas_operativas
  for select to authenticated
  using ((select private.rol_actual()) is not null);

commit;
