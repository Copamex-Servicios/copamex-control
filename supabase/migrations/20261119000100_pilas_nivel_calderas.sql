-- Nivel obligatorio en las cuatro pilas. Bomba y presión solo se exigen en Pila Calderas.
-- Conserva los datos históricos y los permisos de las funciones existentes.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $pre$
begin
  if to_regprocedure('private.bt_completo(text,jsonb)') is null
    or to_regprocedure('private.bt_snapshot_completo(text,jsonb)') is null then
    raise exception 'Aplicar primero la migración de horario técnico 20261106000400.';
  end if;
end;
$pre$;

create or replace function private.bt_completo(p_area text,d jsonb) returns boolean
language plpgsql immutable set search_path='' as $f$
declare e jsonb; pila text;
begin
 if nullif(btrim(d->>'reporteRelevante'),'') is null then return false; end if;
 if exists(select 1 from jsonb_each(d->'mediciones') where value='null'::jsonb) then return false; end if;
 if p_area='calderas' then
   if d->>'estadoUF' is null then return false; end if;
   foreach pila in array array['pila_1_3','pila_2','pila_calderas','pila_4'] loop
     e:=d->'pilas'->pila;
     if e->>'nivel' is null
       or (pila='pila_calderas' and (e->>'bomba' is null or e->>'presion' is null)) then return false; end if;
   end loop;
   if exists(select 1 from jsonb_each(d->'compresores') where value='null'::jsonb) then return false; end if;
   if exists(select 1 from jsonb_each(d->'equipos') where value->>'estado' is null or (key like 'sulzer_%' and value->>'presion' is null)) then return false; end if;
 else
   if d->>'estadoAgitador' is null or d->>'destinoDescarga' is null
     or d->'horasDescarga'->>'tanque11' is null or d->'horasDescarga'->>'tanques56' is null then return false; end if;
   if exists(select 1 from jsonb_each(d->'bombas') where value='null'::jsonb)
     or exists(select 1 from jsonb_each(d->'prensas') where value='null'::jsonb) then return false; end if;
 end if;
 return true;
end;
$f$;

create or replace function private.bt_snapshot_completo(p_area text,s jsonb) returns boolean
language plpgsql immutable set search_path='' as $f$
declare r jsonb:=s->'registro'; k text;
begin
 if s is null or nullif(btrim(r->>'reporte_relevante'),'') is null then return false; end if;
 if p_area='calderas' then
  foreach k in array array['nivel_condensado','presion_432','presion_433','presion_422','presion_424','flujo_osmosis','flujo_uf','nivel_rotoplas','presion_aire','nivel_agua_potable','estado_uf'] loop
    if r->>k is null then return false; end if;
  end loop;
  if jsonb_array_length(s->'equipos')<>12 or jsonb_array_length(s->'pilas')<>4 then return false; end if;
  if exists(select 1 from jsonb_array_elements(s->'equipos') e where e->>'estado' is null or (e->>'equipo' like 'sulzer_%' and e->>'presion' is null))
   or exists(select 1 from jsonb_array_elements(s->'pilas') e where e->>'nivel' is null
     or (e->>'pila'='pila_calderas' and (e->>'bomba' is null or e->>'presion' is null))) then return false; end if;
 else
  foreach k in array array['flujo_clarificador','nivel_tanque_11','nivel_tanque_300','torque_clarificador','setpoint_b13','flujo_entrada_ptar','flujo_daf_chino','nivel_daf_chino','flujo_daf_huber','flujo_reactor_2','flujo_aimsu','presion_linea','nivel_almacen','estado_agitador_9300','destino_descarga_daf','modo_bomba_9','modo_bomba_13','modo_bomba_9310','estado_prensa_essity','estado_prensa_nalco','horas_descarga_tanque_11','horas_descarga_tanques_5_6'] loop
   if r->>k is null then return false; end if;
  end loop;
 end if;
 return true;
end;
$f$;

commit;
