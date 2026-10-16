-- COPAMEX: almacenamiento técnico v1. ARCHIVO PARA REVISIÓN, NO APLICADO.
-- Destino previsto: proyecto ORIGINAL milvashmtxlqjzevfdcx.
-- La CLI puede continuar vinculada a DEV: NO ejecutar db push a ciegas.
-- Requiere respaldo y autorización antes de ejecutar este archivo completo.
-- No reejecutar las migraciones históricas. No incluye fixtures ni usuarios.
-- Único cambio a tablas existentes: ampliar el CHECK de revisiones_captura.
-- Observaciones, turnos, Pozos, UF, Calidad y lecturas_ptar se conservan.
-- JSON de entrada: forma del borrador actual (nombres camelCase incluidos).
-- Calderas: {mediciones:{...},equipos:{caldera_2:{estado,presion},...},
--   pilas:{pila_1_3:{nivel,bomba,presion},...},compresores:{"1":...},estadoUF,comentariosUF}.
-- PTAR: {mediciones:{...},estadoAgitador,destinoDescarga,
--   bombas:{"9":...,"13":...,"9310":...},prensas:{Essity:...,Nalco:...},comentarioPrensas}.
-- Opcionales omitidos/vacíos -> NULL. Cero explícito se conserva.
-- Sulzer: PSI. Calderas: NO se aceptan presiones hasta confirmar unidades.
-- DAF v1: un destino provisional, como la UI. No se afirma una regla de planta definitiva.
-- Correcciones técnicas: RPC independiente; no cambia revisar_captura_admin.
-- No hay ventana de autocorrección ni escritura directa para authenticated.
-- Contrato de las RPC: p_id debe generarse una sola vez por solicitud y conservarse
-- al reintentar. Mismo identificador + contenido normalizado = confirmación sin escritura.
-- Corrección: enviar el formato completo normalizado y la revisión esperada;
-- NULL explícito borra una medición opcional, nunca se confunde con cero.
-- Pruebas pendientes en copia aislada: vacío/0, área ajena, turno cerrado,
-- duplicado concurrente, reintento tras corrección, conflicto de revisión,
-- motivo obligatorio, ausencia de escritura directa y conservación de notas.
begin;

-- Detenerse ante incompatibilidades; nunca reemplazar silenciosamente objetos.
do $preflight$
declare t text; f text; def text;
begin
  if current_user <> 'postgres' then
    raise exception 'Esta migración requiere ejecutarse como postgres, tras autorización.';
  end if;
  foreach t in array array['perfiles','operadores','turnos_operativos','auditoria','revisiones_captura'] loop
    if to_regclass('public.'||t) is null then raise exception 'Falta la tabla public.%',t; end if;
  end loop;
  foreach f in array array['private.rol_actual()','private.es_admin()','private.registrar_auditoria()'] loop
    if to_regprocedure(f) is null then raise exception 'Falta la función %',f; end if;
  end loop;
  if (select prorettype from pg_proc where oid=to_regprocedure('private.registrar_auditoria()')) <> 'trigger'::regtype then
    raise exception 'registrar_auditoria no tiene la firma de trigger esperada.';
  end if;
  if not exists(select 1 from pg_class where oid='public.revisiones_captura'::regclass and relrowsecurity)
    or has_table_privilege('authenticated','public.revisiones_captura','INSERT')
    or has_table_privilege('authenticated','public.revisiones_captura','UPDATE')
    or has_table_privilege('authenticated','public.revisiones_captura','DELETE') then
    raise exception 'revisiones_captura no conserva la protección confirmada.';
  end if;
  select pg_get_constraintdef(oid) into def from pg_constraint
    where conrelid='public.revisiones_captura'::regclass and conname='revisiones_captura_modulo_check' and contype='c';
  if def is null then raise exception 'Falta revisiones_captura_modulo_check; no se sustituye otra restricción.'; end if;
  if exists(select 1 from public.revisiones_captura where modulo not in('bitacora','pozos','uf','calidad','ptar')) then
    raise exception 'Existen módulos adicionales no revisados en revisiones_captura.';
  end if;
  foreach t in array array['bitacora_calderas','bitacora_calderas_equipos','bitacora_calderas_pilas','bitacora_ptar'] loop
    if to_regclass('public.'||t) is not null then raise exception 'public.% ya existe; revisar antes de instalar.',t; end if;
  end loop;
  if to_regclass('private.solicitudes_bitacora_tecnica') is not null then
    raise exception 'El comprobante técnico ya existe; revisar el historial de migraciones.';
  end if;
end;
$preflight$;

alter table public.revisiones_captura drop constraint revisiones_captura_modulo_check;
alter table public.revisiones_captura add constraint revisiones_captura_modulo_check
  check(modulo in('bitacora','pozos','uf','calidad','ptar','bitacora_calderas','bitacora_ptar'));

create function private.bt_finito_v1(p_valor numeric) returns boolean
language sql immutable set search_path='' as $f$
  select p_valor is null or p_valor::text not in ('NaN','Infinity','-Infinity');
$f$;

create table public.bitacora_calderas (
  id uuid primary key,
  turno_id uuid not null unique references public.turnos_operativos(id),
  creado_por uuid not null references auth.users(id),
  creado_en timestamptz not null,
  version_formato integer not null default 1 check(version_formato=1),
  revision bigint not null default 0 check(revision>=0),
  nivel_condensado numeric check(private.bt_finito_v1(nivel_condensado)),
  presion_432 numeric check(private.bt_finito_v1(presion_432)),
  presion_433 numeric check(private.bt_finito_v1(presion_433)),
  presion_422 numeric check(private.bt_finito_v1(presion_422)),
  presion_424 numeric check(private.bt_finito_v1(presion_424)),
  flujo_osmosis numeric check(private.bt_finito_v1(flujo_osmosis)),
  flujo_uf numeric check(private.bt_finito_v1(flujo_uf)),
  nivel_rotoplas numeric check(private.bt_finito_v1(nivel_rotoplas)),
  presion_aire numeric check(private.bt_finito_v1(presion_aire)),
  nivel_agua_potable numeric check(private.bt_finito_v1(nivel_agua_potable)),
  estado_uf text check(estado_uf in('Servicio','Alarmada (F/S)','Lavado')),
  comentarios_uf text
);
create table public.bitacora_calderas_equipos (
  id uuid primary key default gen_random_uuid(),
  reporte_id uuid not null references public.bitacora_calderas(id),
  equipo text not null check(equipo=any(array['caldera_2','caldera_3','caldera_5','caldera_6','sulzer_436','sulzer_456','sulzer_469','sulzer_470','compresor_1','compresor_2','compresor_3','compresor_4']::text[])),
  estado text,
  presion numeric check(private.bt_finito_v1(presion)),
  presion_unidad text check(presion_unidad in('PSI','kg/cm²')),
  unique(reporte_id,equipo),
  check(estado is null or (equipo like 'compresor_%' and estado in('Servicio','Preparado','Mantenimiento'))
    or (equipo not like 'compresor_%' and estado in('Servicio','Reserva','Mantenimiento'))),
  check(presion is null or presion_unidad is not null),
  check(equipo not like 'sulzer_%' or presion_unidad is not distinct from 'PSI'),
  -- v1 no tiene asignación confirmada para Calderas; no almacenar valores ambiguos.
  check(equipo not like 'caldera_%' or (presion is null and presion_unidad is null)),
  check(equipo not like 'compresor_%' or (presion is null and presion_unidad is null))
);
create table public.bitacora_calderas_pilas (
  id uuid primary key default gen_random_uuid(),
  reporte_id uuid not null references public.bitacora_calderas(id),
  pila text not null check(pila=any(array['pila_1_3','pila_2','pila_calderas','pila_4']::text[])),
  nivel numeric check(private.bt_finito_v1(nivel)),
  bomba text,
  presion numeric check(private.bt_finito_v1(presion)),
  unique(reporte_id,pila)
);
create table public.bitacora_ptar (
  id uuid primary key,
  turno_id uuid not null unique references public.turnos_operativos(id),
  creado_por uuid not null references auth.users(id),
  creado_en timestamptz not null,
  version_formato integer not null default 1 check(version_formato=1),
  revision bigint not null default 0 check(revision>=0),
  flujo_clarificador numeric check(private.bt_finito_v1(flujo_clarificador)),
  nivel_tanque_11 numeric check(private.bt_finito_v1(nivel_tanque_11)),
  nivel_tanque_300 numeric check(private.bt_finito_v1(nivel_tanque_300)),
  torque_clarificador numeric check(private.bt_finito_v1(torque_clarificador)),
  setpoint_b13 numeric check(private.bt_finito_v1(setpoint_b13)),
  flujo_entrada_ptar numeric check(private.bt_finito_v1(flujo_entrada_ptar)),
  flujo_daf_chino numeric check(private.bt_finito_v1(flujo_daf_chino)),
  nivel_daf_chino numeric check(private.bt_finito_v1(nivel_daf_chino)),
  flujo_daf_huber numeric check(private.bt_finito_v1(flujo_daf_huber)),
  flujo_reactor_2 numeric check(private.bt_finito_v1(flujo_reactor_2)),
  flujo_aimsu numeric check(private.bt_finito_v1(flujo_aimsu)),
  presion_linea numeric check(private.bt_finito_v1(presion_linea)),
  nivel_almacen numeric check(private.bt_finito_v1(nivel_almacen)),
  estado_agitador_9300 text check(estado_agitador_9300 in('Servicio','Reserva','Mantenimiento')),
  destino_descarga_daf text check(destino_descarga_daf in('Tanque 11','Tanques 5 y 6')),
  modo_bomba_9 text check(modo_bomba_9 in('A','M')),
  modo_bomba_13 text check(modo_bomba_13 in('A','M')),
  modo_bomba_9310 text check(modo_bomba_9310 in('A','M')),
  estado_prensa_essity text check(estado_prensa_essity in('Servicio','Reserva','Mantenimiento')),
  estado_prensa_nalco text check(estado_prensa_nalco in('Servicio','Reserva','Mantenimiento')),
  comentario_prensas text
);
-- Un campo nullable conserva provisionalmente los radios actuales del DAF.
-- Si planta confirma destinos simultáneos, se necesita una nueva versión/migración.

create table private.solicitudes_bitacora_tecnica (
  id uuid primary key,
  modulo text not null check(modulo in('bitacora_calderas','bitacora_ptar')),
  calderas_id uuid unique references public.bitacora_calderas(id),
  ptar_id uuid unique references public.bitacora_ptar(id),
  turno_id uuid not null references public.turnos_operativos(id),
  creado_por uuid not null references auth.users(id),
  recibido_en timestamptz not null,
  contenido_inicial jsonb not null check(jsonb_typeof(contenido_inicial)='object'),
  unique(modulo,turno_id),
  check((modulo='bitacora_calderas' and calderas_id is not null and calderas_id=id and ptar_id is null)
     or (modulo='bitacora_ptar' and ptar_id is not null and ptar_id=id and calderas_id is null))
);
create index bitacora_calderas_creado_idx on public.bitacora_calderas(creado_en desc,id);
create index bitacora_ptar_creado_idx on public.bitacora_ptar(creado_en desc,id);
-- Los UNIQUE de hijos ya indexan reporte_id; fecha/área/turno usa los índices existentes.

comment on table public.bitacora_calderas is 'Reporte técnico v1 por turno; observaciones libres permanecen en bitacora.';
comment on table public.bitacora_ptar is 'Reporte técnico PTAR v1 por turno; independiente de lecturas_ptar DQO/SST.';
comment on column public.bitacora_calderas.nivel_condensado is '%; NULL indica dato no capturado, cero explícito se conserva.';
comment on column public.bitacora_calderas.presion_432 is 'PSI; NULL indica dato no capturado, cero explícito se conserva.';
comment on column public.bitacora_calderas.presion_433 is 'PSI; NULL indica dato no capturado, cero explícito se conserva.';
comment on column public.bitacora_calderas.presion_422 is 'PSI; NULL indica dato no capturado, cero explícito se conserva.';
comment on column public.bitacora_calderas.presion_424 is 'PSI; NULL indica dato no capturado, cero explícito se conserva.';
comment on column public.bitacora_calderas.flujo_osmosis is 'GPM; NULL indica dato no capturado, cero explícito se conserva.';
comment on column public.bitacora_calderas.flujo_uf is 'm³/h; NULL indica dato no capturado, cero explícito se conserva.';
comment on column public.bitacora_calderas.nivel_rotoplas is '%; NULL indica dato no capturado, cero explícito se conserva.';
comment on column public.bitacora_calderas.presion_aire is 'kg/cm²; NULL indica dato no capturado, cero explícito se conserva.';
comment on column public.bitacora_calderas.nivel_agua_potable is '%; NULL indica dato no capturado, cero explícito se conserva.';
comment on column public.bitacora_ptar.flujo_clarificador is 'L/s; sin conversión automática.';
comment on column public.bitacora_ptar.nivel_tanque_11 is '%; sin conversión automática.';
comment on column public.bitacora_ptar.nivel_tanque_300 is '%; sin conversión automática.';
comment on column public.bitacora_ptar.torque_clarificador is 'LBS; sin conversión automática.';
comment on column public.bitacora_ptar.setpoint_b13 is '%; sin conversión automática.';
comment on column public.bitacora_ptar.flujo_entrada_ptar is 'L/s; sin conversión automática.';
comment on column public.bitacora_ptar.flujo_daf_chino is 'L/s; sin conversión automática.';
comment on column public.bitacora_ptar.nivel_daf_chino is 'm; sin conversión automática.';
comment on column public.bitacora_ptar.flujo_daf_huber is 'm³/h; sin conversión automática.';
comment on column public.bitacora_ptar.flujo_reactor_2 is 'L/s; sin conversión automática.';
comment on column public.bitacora_ptar.flujo_aimsu is 'L/s; sin conversión automática.';
comment on column public.bitacora_ptar.presion_linea is 'kg/cm²; sin conversión automática.';
comment on column public.bitacora_ptar.nivel_almacen is 'm³; sin conversión automática.';

-- Normalización interna v1; nombres nuevos, sin reemplazar funciones actuales.
create function private.bt_objeto_v1(p_valor jsonb,p_claves text[]) returns jsonb
language plpgsql immutable set search_path='' as $f$
begin
  if p_valor is null or p_valor='null'::jsonb then return '{}'::jsonb; end if;
  if jsonb_typeof(p_valor)<>'object' then raise exception using errcode='22023',message='Se esperaba un objeto de campos técnicos.'; end if;
  if exists(select 1 from jsonb_object_keys(p_valor) as k(clave) where not(k.clave=any(p_claves))) then
    raise exception using errcode='22023',message='El reporte contiene campos o equipos no definidos en el formato v1.';
  end if;
  return p_valor;
end;
$f$;
create function private.bt_texto_v1(p_valor jsonb) returns text
language plpgsql immutable set search_path='' as $f$
begin
  if p_valor is null or p_valor='null'::jsonb then return null; end if;
  if jsonb_typeof(p_valor)<>'string' then raise exception using errcode='22023',message='El estado o comentario debe ser texto o NULL.'; end if;
  return nullif(regexp_replace(p_valor #>> '{}','^[[:space:]]+|[[:space:]]+$','','g'),'');
end;
$f$;
create function private.bt_numero_v1(p_valor jsonb) returns numeric
language plpgsql immutable set search_path='' as $f$
declare t text; n numeric;
begin
  if p_valor is null or p_valor='null'::jsonb then return null; end if;
  if jsonb_typeof(p_valor) not in('number','string') then raise exception using errcode='22023',message='La medición debe ser numérica o NULL.'; end if;
  t:=nullif(regexp_replace(p_valor #>> '{}','^[[:space:]]+|[[:space:]]+$','','g'),'');
  if t is null then return null; end if;
  if t !~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$' then
    raise exception using errcode='22023',message='Medición inválida; no se admiten separadores de miles ni números no finitos.';
  end if;
  n:=t::numeric;
  if not private.bt_finito_v1(n) then raise exception using errcode='22023',message='Medición no finita.'; end if;
  return n;
end;
$f$;
create function private.bt_opcion_v1(p_valor jsonb,p_opciones text[]) returns text
language plpgsql immutable set search_path='' as $f$
declare t text:=private.bt_texto_v1(p_valor);
begin
  if t is not null and not(t=any(p_opciones)) then raise exception using errcode='22023',message='Opción operativa no permitida.'; end if;
  return t;
end;
$f$;
create function private.bt_normalizar_v1(p_modulo text,p_datos jsonb) returns jsonb
language plpgsql immutable set search_path='' as $f$
declare d jsonb; m jsonb; med jsonb:='{}'; equipos jsonb:='{}'; pil jsonb:='{}'; comp jsonb:='{}'; bombas jsonb:='{}'; prensas jsonb:='{}'; e jsonb;
  k text; estado text; modo text; presion numeric;
begin
  if p_datos is null or jsonb_typeof(p_datos)<>'object' then raise exception using errcode='22023',message='El reporte técnico requiere un objeto de datos.'; end if;
  if p_modulo='bitacora_calderas' then
    d:=private.bt_objeto_v1(p_datos,array['mediciones','equipos','pilas','compresores','estadoUF','comentariosUF']);
    m:=private.bt_objeto_v1(d->'mediciones',array['nivel_condensado','presion_432','presion_433','presion_422','presion_424','flujo_osmosis','flujo_uf','nivel_rotoplas','presion_aire','nivel_agua_potable']::text[]);
    foreach k in array array['nivel_condensado','presion_432','presion_433','presion_422','presion_424','flujo_osmosis','flujo_uf','nivel_rotoplas','presion_aire','nivel_agua_potable']::text[] loop med:=med||jsonb_build_object(k,private.bt_numero_v1(m->k)); end loop;
    m:=private.bt_objeto_v1(d->'equipos',array['caldera_2','caldera_3','caldera_5','caldera_6','sulzer_436','sulzer_456','sulzer_469','sulzer_470']::text[]);
    foreach k in array array['caldera_2','caldera_3','caldera_5','caldera_6','sulzer_436','sulzer_456','sulzer_469','sulzer_470']::text[] loop
      e:=private.bt_objeto_v1(m->k,array['estado','presion']);
      presion:=private.bt_numero_v1(e->'presion');
      if k like 'caldera_%' and presion is not null then
        raise exception using errcode='22023',message='Las unidades de presión de Calderas están pendientes; conserva ese campo vacío. No se descartó la captura.';
      end if;
      equipos:=equipos||jsonb_build_object(k,jsonb_build_object('estado',private.bt_opcion_v1(e->'estado',array['Servicio','Reserva','Mantenimiento']),'presion',presion));
    end loop;
    m:=private.bt_objeto_v1(d->'pilas',array['pila_1_3','pila_2','pila_calderas','pila_4']::text[]);
    foreach k in array array['pila_1_3','pila_2','pila_calderas','pila_4']::text[] loop
      e:=private.bt_objeto_v1(m->k,array['nivel','bomba','presion']);
      pil:=pil||jsonb_build_object(k,jsonb_build_object('nivel',private.bt_numero_v1(e->'nivel'),'bomba',private.bt_texto_v1(e->'bomba'),'presion',private.bt_numero_v1(e->'presion')));
    end loop;
    m:=private.bt_objeto_v1(d->'compresores',array['1','2','3','4']);
    foreach k in array array['1','2','3','4'] loop comp:=comp||jsonb_build_object(k,private.bt_opcion_v1(m->k,array['Servicio','Preparado','Mantenimiento'])); end loop;
    return jsonb_build_object('mediciones',med,'equipos',equipos,'pilas',pil,'compresores',comp,
      'estadoUF',private.bt_opcion_v1(d->'estadoUF',array['Servicio','Alarmada (F/S)','Lavado']),'comentariosUF',private.bt_texto_v1(d->'comentariosUF'));
  elsif p_modulo='bitacora_ptar' then
    d:=private.bt_objeto_v1(p_datos,array['mediciones','estadoAgitador','destinoDescarga','bombas','prensas','comentarioPrensas']);
    m:=private.bt_objeto_v1(d->'mediciones',array['flujo_clarificador','nivel_tanque_11','nivel_tanque_300','torque_clarificador','setpoint_b13','flujo_entrada_ptar','flujo_daf_chino','nivel_daf_chino','flujo_daf_huber','flujo_reactor_2','flujo_aimsu','presion_linea','nivel_almacen']::text[]);
    foreach k in array array['flujo_clarificador','nivel_tanque_11','nivel_tanque_300','torque_clarificador','setpoint_b13','flujo_entrada_ptar','flujo_daf_chino','nivel_daf_chino','flujo_daf_huber','flujo_reactor_2','flujo_aimsu','presion_linea','nivel_almacen']::text[] loop med:=med||jsonb_build_object(k,private.bt_numero_v1(m->k)); end loop;
    m:=private.bt_objeto_v1(d->'bombas',array['9','13','9310']);
    foreach k in array array['9','13','9310'] loop
      modo:=private.bt_opcion_v1(m->k,array['A','M','Automático (A)','Manual (M)']);
      if modo='Automático (A)' then modo:='A'; elsif modo='Manual (M)' then modo:='M'; end if;
      bombas:=bombas||jsonb_build_object(k,modo);
    end loop;
    m:=private.bt_objeto_v1(d->'prensas',array['Essity','Nalco']);
    foreach k in array array['Essity','Nalco'] loop prensas:=prensas||jsonb_build_object(k,private.bt_opcion_v1(m->k,array['Servicio','Reserva','Mantenimiento'])); end loop;
    return jsonb_build_object('mediciones',med,'bombas',bombas,'prensas',prensas,
      'estadoAgitador',private.bt_opcion_v1(d->'estadoAgitador',array['Servicio','Reserva','Mantenimiento']),
      'destinoDescarga',private.bt_opcion_v1(d->'destinoDescarga',array['Tanque 11','Tanques 5 y 6']),
      'comentarioPrensas',private.bt_texto_v1(d->'comentarioPrensas'));
  end if;
  raise exception using errcode='22023',message='Módulo técnico inválido.';
end;
$f$;

-- Solo un contexto elevado de estas RPC puede escribir, además de sus verificaciones Auth.
-- El GUC por sí solo NO concede permiso: se exige current_user=postgres, ACL y rol real.
create function private.bt_proteger_v1() returns trigger
language plpgsql set search_path='' as $f$
declare modulo text:=tg_argv[0]; reporte uuid; t public.turnos_operativos%rowtype;
begin
  if tg_op in('DELETE','TRUNCATE') then raise exception using errcode='42501',message='Los reportes técnicos no se borran físicamente.'; end if;
  if tg_argv[1]='cabecera' then reporte:=new.id; else reporte:=new.reporte_id; end if;
  if current_user<>'postgres' or auth.uid() is null
    or current_setting('copamex.bt_escritura',true) is distinct from modulo||':'||reporte::text then
    raise exception using errcode='42501',message='La escritura técnica requiere la operación controlada.';
  end if;
  if tg_op='UPDATE' then
    if not coalesce(private.es_admin(),false) then raise exception using errcode='42501',message='Solo Administración puede corregir reportes técnicos.'; end if;
    if tg_argv[1]='cabecera' then
      if row(new.id,new.turno_id,new.creado_por,new.creado_en,new.version_formato)
        is distinct from row(old.id,old.turno_id,old.creado_por,old.creado_en,old.version_formato) then
        raise exception using errcode='42501',message='La identidad y los datos originales del turno se conservan.';
      end if;
      new.revision:=old.revision+1;
    else
      if new.id is distinct from old.id or new.reporte_id is distinct from old.reporte_id
        or (to_jsonb(new)->tg_argv[1]) is distinct from (to_jsonb(old)->tg_argv[1]) then
        raise exception using errcode='42501',message='La identidad del equipo o pila se conserva.';
      end if;
    end if;
  elsif tg_argv[1]='cabecera' then
    select * into t from public.turnos_operativos where id=new.turno_id for share;
    if not found or t.finalizado_en is not null or t.iniciado_por is distinct from auth.uid()
      or t.area::text is distinct from (case modulo when 'bitacora_calderas' then 'calderas' else 'ptar' end)
      or private.rol_actual()::text is distinct from t.area::text then
      raise exception using errcode='42501',message='El reporte requiere tu turno activo en el área correspondiente.';
    end if;
    new.creado_por:=auth.uid(); new.creado_en:=clock_timestamp(); new.version_formato:=1; new.revision:=0;
  else
    if private.rol_actual()::text is distinct from 'calderas' then raise exception using errcode='42501',message='La creación de equipos requiere Calderas.'; end if;
  end if;
  return new;
end;
$f$;
create function private.bt_conservar_comprobante_v1() returns trigger
language plpgsql set search_path='' as $f$
declare r record;
begin
  if tg_op<>'INSERT' then raise exception using errcode='42501',message='El comprobante de creación es inmutable.'; end if;
  if current_user<>'postgres' or auth.uid() is null or new.creado_por is distinct from auth.uid() then
    raise exception using errcode='42501',message='Comprobante no autorizado.';
  end if;
  if new.modulo='bitacora_calderas' then select id,turno_id,creado_por into r from public.bitacora_calderas where id=new.calderas_id;
  else select id,turno_id,creado_por into r from public.bitacora_ptar where id=new.ptar_id; end if;
  if not found or row(r.id,r.turno_id,r.creado_por) is distinct from row(new.id,new.turno_id,new.creado_por)
    or current_setting('copamex.bt_escritura',true) is distinct from new.modulo||':'||new.id::text then
    raise exception using errcode='42501',message='El comprobante no corresponde al reporte creado.';
  end if;
  new.recibido_en:=clock_timestamp(); return new;
end;
$f$;

-- Snapshot completo en una sola sentencia: evita mezclar versiones durante una consulta.
create function private.bt_snapshot_v1(p_modulo text,p_id uuid) returns jsonb
language sql stable set search_path='' as $f$
  select case p_modulo
    when 'bitacora_calderas' then (
      select jsonb_build_object('registro',to_jsonb(r),
        'equipos',coalesce((select jsonb_agg(to_jsonb(e) order by e.equipo) from public.bitacora_calderas_equipos e where e.reporte_id=r.id),'[]'::jsonb),
        'pilas',coalesce((select jsonb_agg(to_jsonb(p) order by p.pila) from public.bitacora_calderas_pilas p where p.reporte_id=r.id),'[]'::jsonb))
      from public.bitacora_calderas r where r.id=p_id)
    when 'bitacora_ptar' then (select jsonb_build_object('registro',to_jsonb(r),'equipos','[]'::jsonb,'pilas','[]'::jsonb) from public.bitacora_ptar r where r.id=p_id)
  end;
$f$;

-- Escritura interna: recibe exclusivamente el JSON ya normalizado.
create function private.bt_escribir_v1(p_modulo text,p_id uuid,p_turno uuid,p_datos jsonb,p_crear boolean) returns void
language plpgsql set search_path='' as $f$
declare c public.bitacora_calderas%rowtype; t public.bitacora_ptar%rowtype;
  k text; e jsonb; v_estado text; v_presion numeric; v_unidad text;
begin
  if p_modulo='bitacora_calderas' then
    c:=jsonb_populate_record(null::public.bitacora_calderas,p_datos->'mediciones');
    if p_crear then
      insert into public.bitacora_calderas(id,turno_id,creado_por,creado_en,nivel_condensado,presion_432,presion_433,presion_422,presion_424,flujo_osmosis,flujo_uf,nivel_rotoplas,presion_aire,nivel_agua_potable,estado_uf,comentarios_uf)
      values(p_id,p_turno,auth.uid(),clock_timestamp(),c.nivel_condensado,c.presion_432,c.presion_433,c.presion_422,c.presion_424,c.flujo_osmosis,c.flujo_uf,c.nivel_rotoplas,c.presion_aire,c.nivel_agua_potable,p_datos->>'estadoUF',p_datos->>'comentariosUF');
    end if;
    foreach k in array array['caldera_2','caldera_3','caldera_5','caldera_6','sulzer_436','sulzer_456','sulzer_469','sulzer_470','compresor_1','compresor_2','compresor_3','compresor_4']::text[] loop
      if k like 'compresor_%' then v_estado:=p_datos->'compresores'->>right(k,1);v_presion:=null;v_unidad:=null;
      else e:=p_datos->'equipos'->k;v_estado:=e->>'estado';v_presion:=(e->>'presion')::numeric;v_unidad:=case when k like 'sulzer_%' then 'PSI' else null end; end if;
      if p_crear then insert into public.bitacora_calderas_equipos(reporte_id,equipo,estado,presion,presion_unidad) values(p_id,k,v_estado,v_presion,v_unidad);
      else update public.bitacora_calderas_equipos set estado=v_estado,presion=v_presion,presion_unidad=v_unidad where reporte_id=p_id and equipo=k;
        if not found then raise exception using errcode='22023',message='Falta un equipo estructural del reporte.'; end if;
      end if;
    end loop;
    foreach k in array array['pila_1_3','pila_2','pila_calderas','pila_4']::text[] loop
      e:=p_datos->'pilas'->k;
      if p_crear then insert into public.bitacora_calderas_pilas(reporte_id,pila,nivel,bomba,presion) values(p_id,k,(e->>'nivel')::numeric,e->>'bomba',(e->>'presion')::numeric);
      else update public.bitacora_calderas_pilas set nivel=(e->>'nivel')::numeric,bomba=e->>'bomba',presion=(e->>'presion')::numeric where reporte_id=p_id and pila=k;
        if not found then raise exception using errcode='22023',message='Falta una pila estructural del reporte.'; end if;
      end if;
    end loop;
    if not p_crear then
      update public.bitacora_calderas set nivel_condensado=c.nivel_condensado,presion_432=c.presion_432,presion_433=c.presion_433,presion_422=c.presion_422,presion_424=c.presion_424,flujo_osmosis=c.flujo_osmosis,flujo_uf=c.flujo_uf,nivel_rotoplas=c.nivel_rotoplas,presion_aire=c.presion_aire,nivel_agua_potable=c.nivel_agua_potable,estado_uf=p_datos->>'estadoUF',comentarios_uf=p_datos->>'comentariosUF' where id=p_id;
      if not found then raise exception using errcode='22023',message='Reporte no encontrado.'; end if;
    end if;
  elsif p_modulo='bitacora_ptar' then
    t:=jsonb_populate_record(null::public.bitacora_ptar,p_datos->'mediciones');
    if p_crear then
      insert into public.bitacora_ptar(id,turno_id,creado_por,creado_en,flujo_clarificador,nivel_tanque_11,nivel_tanque_300,torque_clarificador,setpoint_b13,flujo_entrada_ptar,flujo_daf_chino,nivel_daf_chino,flujo_daf_huber,flujo_reactor_2,flujo_aimsu,presion_linea,nivel_almacen,estado_agitador_9300,destino_descarga_daf,modo_bomba_9,modo_bomba_13,modo_bomba_9310,estado_prensa_essity,estado_prensa_nalco,comentario_prensas)
      values(p_id,p_turno,auth.uid(),clock_timestamp(),t.flujo_clarificador,t.nivel_tanque_11,t.nivel_tanque_300,t.torque_clarificador,t.setpoint_b13,t.flujo_entrada_ptar,t.flujo_daf_chino,t.nivel_daf_chino,t.flujo_daf_huber,t.flujo_reactor_2,t.flujo_aimsu,t.presion_linea,t.nivel_almacen,p_datos->>'estadoAgitador',p_datos->>'destinoDescarga',p_datos->'bombas'->>'9',p_datos->'bombas'->>'13',p_datos->'bombas'->>'9310',p_datos->'prensas'->>'Essity',p_datos->'prensas'->>'Nalco',p_datos->>'comentarioPrensas');
    else
      update public.bitacora_ptar set flujo_clarificador=t.flujo_clarificador,nivel_tanque_11=t.nivel_tanque_11,nivel_tanque_300=t.nivel_tanque_300,torque_clarificador=t.torque_clarificador,setpoint_b13=t.setpoint_b13,flujo_entrada_ptar=t.flujo_entrada_ptar,flujo_daf_chino=t.flujo_daf_chino,nivel_daf_chino=t.nivel_daf_chino,flujo_daf_huber=t.flujo_daf_huber,flujo_reactor_2=t.flujo_reactor_2,flujo_aimsu=t.flujo_aimsu,presion_linea=t.presion_linea,nivel_almacen=t.nivel_almacen,
        estado_agitador_9300=p_datos->>'estadoAgitador',destino_descarga_daf=p_datos->>'destinoDescarga',
        modo_bomba_9=p_datos->'bombas'->>'9',modo_bomba_13=p_datos->'bombas'->>'13',modo_bomba_9310=p_datos->'bombas'->>'9310',
        estado_prensa_essity=p_datos->'prensas'->>'Essity',estado_prensa_nalco=p_datos->'prensas'->>'Nalco',comentario_prensas=p_datos->>'comentarioPrensas' where id=p_id;
      if not found then raise exception using errcode='22023',message='Reporte no encontrado.'; end if;
    end if;
  else raise exception using errcode='22023',message='Módulo técnico inválido.'; end if;
end;
$f$;

create function private.bt_guardar_v1(p_modulo text,p_id uuid,p_turno_id uuid,p_datos jsonb) returns jsonb
language plpgsql set search_path='' as $f$
declare cuenta uuid:=auth.uid(); area text; d jsonb; t public.turnos_operativos%rowtype;
  recibo private.solicitudes_bitacora_tecnica%rowtype; anterior text; existente uuid;
begin
  area:=case p_modulo when 'bitacora_calderas' then 'calderas' when 'bitacora_ptar' then 'ptar' end;
  if cuenta is null or area is null or private.rol_actual()::text is distinct from area then
    raise exception using errcode='42501',message='Se requiere una cuenta activa del área del reporte.';
  end if;
  if p_id is null or p_turno_id is null then raise exception using errcode='22023',message='Se requiere identificador estable y turno.'; end if;
  d:=private.bt_normalizar_v1(p_modulo,p_datos);
  perform pg_advisory_xact_lock(hashtextextended('copamex.bt.operacion:'||p_id::text,0));
  select * into recibo from private.solicitudes_bitacora_tecnica where id=p_id;
  if found then
    if recibo.modulo is distinct from p_modulo or recibo.turno_id is distinct from p_turno_id
      or recibo.creado_por is distinct from cuenta or recibo.contenido_inicial is distinct from d then
      raise exception using errcode='23505',message='El identificador ya pertenece a otra solicitud; no se sobrescribió el reporte.';
    end if;
    return jsonb_build_object('id',p_id,'reintento',true,'confirmado',true,'snapshot',private.bt_snapshot_v1(p_modulo,p_id));
  end if;
  perform pg_advisory_xact_lock(hashtextextended('copamex.bt.turno:'||p_modulo||':'||p_turno_id::text,0));
  select * into t from public.turnos_operativos where id=p_turno_id for share;
  if not found or t.area::text is distinct from area or t.iniciado_por is distinct from cuenta or t.finalizado_en is not null then
    raise exception using errcode='42501',message='El reporte requiere tu turno activo del área autorizada.';
  end if;
  if p_modulo='bitacora_calderas' then select id into existente from public.bitacora_calderas where turno_id=p_turno_id or id=p_id;
  else select id into existente from public.bitacora_ptar where turno_id=p_turno_id or id=p_id; end if;
  if found then raise exception using errcode='23505',message='Ya existe un reporte técnico para ese turno o identificador. Consulta el registro; solo Administración puede corregirlo.'; end if;
  anterior:=current_setting('copamex.bt_escritura',true);
  perform set_config('copamex.bt_escritura',p_modulo||':'||p_id::text,true);
  perform private.bt_escribir_v1(p_modulo,p_id,p_turno_id,d,true);
  insert into private.solicitudes_bitacora_tecnica(id,modulo,calderas_id,ptar_id,turno_id,creado_por,recibido_en,contenido_inicial)
    values(p_id,p_modulo,case when p_modulo='bitacora_calderas' then p_id end,case when p_modulo='bitacora_ptar' then p_id end,p_turno_id,cuenta,clock_timestamp(),d);
  perform set_config('copamex.bt_escritura',coalesce(anterior,''),true);
  return jsonb_build_object('id',p_id,'reintento',false,'confirmado',true,'snapshot',private.bt_snapshot_v1(p_modulo,p_id));
end;
$f$;
create function public.guardar_bitacora_tecnica_calderas(p_id uuid,p_turno_id uuid,p_datos jsonb) returns jsonb
language sql volatile security definer set search_path='' as $f$
  select private.bt_guardar_v1('bitacora_calderas',p_id,p_turno_id,p_datos);
$f$;
create function public.guardar_bitacora_tecnica_ptar(p_id uuid,p_turno_id uuid,p_datos jsonb) returns jsonb
language sql volatile security definer set search_path='' as $f$
  select private.bt_guardar_v1('bitacora_ptar',p_id,p_turno_id,p_datos);
$f$;

-- RPC independiente; nunca llama ni reemplaza revisar_captura_admin.
create function public.corregir_bitacora_tecnica_admin(
  p_id uuid,p_modulo text,p_reporte_id uuid,p_revision_esperada bigint,p_datos jsonb,p_motivo text
) returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare cuenta uuid:=auth.uid(); d jsonb; antes jsonb; despues jsonb; nombre text; motivo text;
  previa public.revisiones_captura%rowtype; revision_actual bigint; turno_id uuid; contexto text;
begin
  if cuenta is null or not coalesce(private.es_admin(),false) then raise exception using errcode='42501',message='Solo un administrador activo puede corregir reportes técnicos.'; end if;
  motivo:=nullif(regexp_replace(p_motivo,'^[[:space:]]+|[[:space:]]+$','','g'),'');
  if p_id is null or p_reporte_id is null or p_revision_esperada is null or p_revision_esperada<0
    or p_modulo is null or p_modulo not in('bitacora_calderas','bitacora_ptar')
    or motivo is null or length(motivo)>4000 then raise exception using errcode='22023',message='Indica reporte, revisión y motivo obligatorio (hasta 4000 caracteres).'; end if;
  d:=private.bt_normalizar_v1(p_modulo,p_datos);
  -- Corrección completa y normalizada: evita borrar campos por omisiones accidentales.
  if p_datos is distinct from d then raise exception using errcode='22023',message='La corrección requiere todos los campos del formato normalizado; los opcionales pueden ser NULL.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('copamex.bt.operacion:'||p_id::text,0));
  if p_modulo='bitacora_calderas' then select r.revision,r.turno_id into revision_actual,turno_id from public.bitacora_calderas r where r.id=p_reporte_id for update;
  else select r.revision,r.turno_id into revision_actual,turno_id from public.bitacora_ptar r where r.id=p_reporte_id for update; end if;
  if not found then raise exception using errcode='22023',message='Reporte técnico no encontrado.'; end if;
  select * into previa from public.revisiones_captura where id=p_id;
  if found then
    if previa.modulo=p_modulo and previa.registro_id=p_reporte_id and previa.accion='corregir'
      and previa.creado_por=cuenta and previa.motivo=motivo and previa.datos_solicitados=d
      and (previa.antes->'registro'->>'revision')::bigint=p_revision_esperada then
      return jsonb_build_object('id',p_id,'reintento',true,'confirmado',true,'snapshot',private.bt_snapshot_v1(p_modulo,p_reporte_id));
    end if;
    raise exception using errcode='23505',message='El identificador corresponde a otra revisión.';
  end if;
  if revision_actual<>p_revision_esperada then raise exception using errcode='40001',message='El reporte cambió. Actualiza y revisa antes de corregir.'; end if;
  antes:=private.bt_snapshot_v1(p_modulo,p_reporte_id);
  contexto:=current_setting('copamex.bt_escritura',true);
  perform set_config('copamex.bt_escritura',p_modulo||':'||p_reporte_id::text,true);
  perform private.bt_escribir_v1(p_modulo,p_reporte_id,turno_id,d,false);
  perform set_config('copamex.bt_escritura',coalesce(contexto,''),true);
  despues:=private.bt_snapshot_v1(p_modulo,p_reporte_id);
  if ((antes->'registro')-'revision')=((despues->'registro')-'revision')
    and (antes->'equipos')=(despues->'equipos') and (antes->'pilas')=(despues->'pilas') then
    raise exception using errcode='22023',message='No hay cambios técnicos para registrar.';
  end if;
  select p.nombre into strict nombre from public.perfiles p where p.id=cuenta and p.activo;
  insert into public.revisiones_captura(id,modulo,registro_id,accion,motivo,creado_por,responsable_nombre,creado_en,antes,despues,datos_solicitados)
    values(p_id,p_modulo,p_reporte_id,'corregir',motivo,cuenta,nombre,clock_timestamp(),antes,despues,d);
  return jsonb_build_object('id',p_id,'reintento',false,'confirmado',true,'snapshot',despues);
end;
$f$;

-- Detalle autorizado para operadores de la propia área y Administración.
-- No lee ni copia notas de bitacora: el frontend conserva su consulta independiente por turno_id.
create function public.consultar_bitacora_tecnica(p_modulo text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $f$
declare s jsonb; area text; t public.turnos_operativos%rowtype; operador text;
begin
  area:=case p_modulo when 'bitacora_calderas' then 'calderas' when 'bitacora_ptar' then 'ptar' end;
  if auth.uid() is null or area is null or (not coalesce(private.es_admin(),false) and private.rol_actual()::text is distinct from area) then
    raise exception using errcode='42501',message='No tienes acceso al área del reporte técnico.';
  end if;
  s:=private.bt_snapshot_v1(p_modulo,p_id); if s is null then return null; end if;
  select * into t from public.turnos_operativos where id=(s->'registro'->>'turno_id')::uuid;
  if not found or t.area::text<>area then raise exception using errcode='22023',message='Relación de turno técnico inconsistente.'; end if;
  select nombre into strict operador from public.operadores where id=t.operador_id;
  return jsonb_build_object('modulo',p_modulo,'snapshot',s,'turno',to_jsonb(t),'operador',operador);
end;
$f$;
create function public.consultar_bitacoras_tecnicas_admin(
  p_desde date,p_hasta date,p_area text default 'todas',p_turno text default 'todos',p_limite integer default 25,p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare salida jsonb;
begin
  if auth.uid() is null or not coalesce(private.es_admin(),false) then raise exception using errcode='42501',message='Solo Administración puede consultar ambos módulos técnicos.'; end if;
  if p_desde is null or p_hasta is null or p_hasta<p_desde or p_area is null or p_area not in('todas','calderas','ptar')
    or p_turno is null or p_turno not in('todos','dia','tarde','noche') or p_limite is null or p_limite not between 1 and 100
    or p_offset is null or p_offset<0 then raise exception using errcode='22023',message='Filtros o paginación inválidos.'; end if;
  with reportes as (
    select 'bitacora_calderas'::text modulo,r.id,r.turno_id,r.creado_en,r.creado_por,r.revision from public.bitacora_calderas r
    union all select 'bitacora_ptar',r.id,r.turno_id,r.creado_en,r.creado_por,r.revision from public.bitacora_ptar r
  ), elegidos as (
    select r.*,t.fecha_operativa,t.area,t.turno,t.operador_id,o.nombre as operador
    from reportes r join public.turnos_operativos t on t.id=r.turno_id join public.operadores o on o.id=t.operador_id
    where t.fecha_operativa between p_desde and p_hasta and (p_area='todas' or t.area::text=p_area) and (p_turno='todos' or t.turno::text=p_turno)
    order by t.fecha_operativa desc,r.creado_en desc,r.modulo,r.id limit p_limite+1 offset p_offset
  ), numerados as (select e.*,row_number() over(order by e.fecha_operativa desc,e.creado_en desc,e.modulo,e.id) n from elegidos e)
  select jsonb_build_object('filas',coalesce(jsonb_agg(to_jsonb(numerados)-'n' order by n) filter(where n<=p_limite),'[]'::jsonb),'mas',count(*)>p_limite)
    into salida from numerados;
  return salida;
end;
$f$;
create function public.consultar_revisiones_bitacora_tecnica_admin(p_modulo text,p_reporte_id uuid,p_limite integer default 25,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare salida jsonb;
begin
  if auth.uid() is null or not coalesce(private.es_admin(),false) then raise exception using errcode='42501',message='Solo Administración puede consultar revisiones técnicas.'; end if;
  if p_modulo is null or p_modulo not in('bitacora_calderas','bitacora_ptar') or p_reporte_id is null
    or p_limite is null or p_limite not between 1 and 100 or p_offset is null or p_offset<0 then raise exception using errcode='22023',message='Consulta de revisiones inválida.'; end if;
  with elegidas as (
    select r.* from public.revisiones_captura r where r.modulo=p_modulo and r.registro_id=p_reporte_id
    order by r.creado_en desc,r.id limit p_limite+1 offset p_offset
  ), numeradas as (select e.*,row_number() over(order by e.creado_en desc,e.id) n from elegidas e)
  select jsonb_build_object('filas',coalesce(jsonb_agg(to_jsonb(numeradas)-'n' order by n) filter(where n<=p_limite),'[]'::jsonb),'mas',count(*)>p_limite)
    into salida from numeradas;
  return salida;
end;
$f$;

-- ACL de funciones nuevas: no se tocan funciones anteriores ni defaults globales.
do $acl$
declare firma text;
begin
  foreach firma in array array[
    'private.bt_finito_v1(numeric)','private.bt_objeto_v1(jsonb,text[])','private.bt_texto_v1(jsonb)',
    'private.bt_numero_v1(jsonb)','private.bt_opcion_v1(jsonb,text[])','private.bt_normalizar_v1(text,jsonb)',
    'private.bt_proteger_v1()','private.bt_conservar_comprobante_v1()','private.bt_snapshot_v1(text,uuid)',
    'private.bt_escribir_v1(text,uuid,uuid,jsonb,boolean)','private.bt_guardar_v1(text,uuid,uuid,jsonb)'
  ] loop
    execute 'alter function '||firma||' owner to postgres';
    execute 'revoke all on function '||firma||' from public,anon,authenticated';
  end loop;
  foreach firma in array array[
    'public.guardar_bitacora_tecnica_calderas(uuid,uuid,jsonb)','public.guardar_bitacora_tecnica_ptar(uuid,uuid,jsonb)',
    'public.corregir_bitacora_tecnica_admin(uuid,text,uuid,bigint,jsonb,text)',
    'public.consultar_bitacora_tecnica(text,uuid)',
    'public.consultar_bitacoras_tecnicas_admin(date,date,text,text,integer,integer)',
    'public.consultar_revisiones_bitacora_tecnica_admin(text,uuid,integer,integer)'
  ] loop
    execute 'alter function '||firma||' owner to postgres';
    execute 'revoke all on function '||firma||' from public,anon,authenticated';
    execute 'grant execute on function '||firma||' to authenticated';
  end loop;
end;
$acl$;

-- Triggers nuevos; registrar_auditoria se reutiliza sin reemplazar su definición.
do $triggers$
declare tabla text; modulo text; clase text;
begin
  foreach tabla in array array['bitacora_calderas','bitacora_calderas_equipos','bitacora_calderas_pilas','bitacora_ptar'] loop
    modulo:=case when tabla='bitacora_ptar' then 'bitacora_ptar' else 'bitacora_calderas' end;
    clase:=case tabla when 'bitacora_calderas_equipos' then 'equipo' when 'bitacora_calderas_pilas' then 'pila' else 'cabecera' end;
    execute format('create trigger proteger_tecnico before insert or update or delete on public.%I for each row execute function private.bt_proteger_v1(%L,%L)',tabla,modulo,clase);
    execute format('create trigger conservar_tecnico before truncate on public.%I for each statement execute function private.bt_proteger_v1(%L,%L)',tabla,modulo,clase);
    execute format('create trigger registrar_auditoria after insert or update or delete on public.%I for each row execute function private.registrar_auditoria()',tabla);
  end loop;
end;
$triggers$;
create trigger conservar_comprobante before insert or update or delete on private.solicitudes_bitacora_tecnica for each row execute function private.bt_conservar_comprobante_v1();
create trigger conservar_comprobante_truncate before truncate on private.solicitudes_bitacora_tecnica for each statement execute function private.bt_conservar_comprobante_v1();

alter table public.bitacora_calderas enable row level security;
alter table public.bitacora_calderas_equipos enable row level security;
alter table public.bitacora_calderas_pilas enable row level security;
alter table public.bitacora_ptar enable row level security;
alter table private.solicitudes_bitacora_tecnica enable row level security;
revoke all on public.bitacora_calderas,public.bitacora_calderas_equipos,public.bitacora_calderas_pilas,public.bitacora_ptar,private.solicitudes_bitacora_tecnica from public,anon,authenticated;
grant select on public.bitacora_calderas,public.bitacora_calderas_equipos,public.bitacora_calderas_pilas,public.bitacora_ptar to authenticated;
create policy lectura_tecnica_calderas on public.bitacora_calderas for select to authenticated
  using((select private.es_admin()) or (select private.rol_actual())::text='calderas');
create policy lectura_tecnica_ptar on public.bitacora_ptar for select to authenticated
  using((select private.es_admin()) or (select private.rol_actual())::text='ptar');
create policy lectura_tecnica_equipos on public.bitacora_calderas_equipos for select to authenticated
  using(exists(select 1 from public.bitacora_calderas r where r.id=reporte_id));
create policy lectura_tecnica_pilas on public.bitacora_calderas_pilas for select to authenticated
  using(exists(select 1 from public.bitacora_calderas r where r.id=reporte_id));
-- No políticas INSERT/UPDATE/DELETE de cliente. La cuenta admin tampoco escribe directamente.
notify pgrst,'reload schema';
commit;
