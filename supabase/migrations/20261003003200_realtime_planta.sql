-- Vista Planta: notificar cambios a cuentas con permiso de lectura existente.
-- No cambia registros, políticas RLS ni privilegios de las cuentas.
-- Ejecutar una vez, completo, en SQL Editor; también puede repetirse.
begin;
do $$
declare
  nombre text;
  tablas text[] := array['turnos_operativos', 'operadores', 'bitacora', 'lecturas_pozos',
    'lecturas_uf', 'lecturas_ptar', 'muestras_calidad', 'resultados_calidad', 'puntos_muestreo', 'parametros_calidad'];
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'No existe la publicación supabase_realtime. Revisa Realtime en tu proyecto.';
  end if;
  foreach nombre in array tablas loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = nombre and c.relkind = 'r' and c.relrowsecurity) then
      raise exception 'La tabla public.% no existe o no tiene RLS activado.', nombre;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = nombre) then
      execute format('alter publication supabase_realtime add table public.%I', nombre);
    end if;
  end loop;
end $$;
commit;

select tablename as tabla, true as cambios_en_vivo
from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public'
  and tablename = any (array['turnos_operativos', 'operadores', 'bitacora', 'lecturas_pozos',
    'lecturas_uf', 'lecturas_ptar', 'muestras_calidad', 'resultados_calidad', 'puntos_muestreo', 'parametros_calidad'])
order by tablename;
