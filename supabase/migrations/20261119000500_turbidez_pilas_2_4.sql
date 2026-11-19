-- LOCAL: pendiente de ejecutar en Supabase.
-- Habilita Turbidez para Pila M-2 y Pila M-4. No asigna límites ni cambia históricos.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $pre$
begin
  if to_regclass('public.parametros_calidad') is null
    or to_regclass('public.puntos_muestreo') is null then
    raise exception 'Faltan los catálogos de Calidad.';
  end if;
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.parametros_calidad'::regclass
      and attname = 'puntos_permitidos' and not attisdropped
  ) then
    raise exception 'Aplicar primero la migración de configuración de parámetros de Calidad.';
  end if;
  if (select count(*) from public.parametros_calidad
      where id = '30000000-0000-4000-8000-000000000002' and lower(btrim(nombre)) = 'turbidez') <> 1 then
    raise exception 'No coincide el parámetro Turbidez esperado.';
  end if;
  if (select count(*) from public.puntos_muestreo
      where id in ('20000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000004')) <> 2 then
    raise exception 'No coinciden los puntos Pila M-2 y Pila M-4 esperados.';
  end if;
end;
$pre$;

update public.parametros_calidad q
set puntos_permitidos = case
  -- NULL ya permite todos los puntos del área; conservar esa configuración.
  when q.puntos_permitidos is null then null
  else (
    select array_agg(punto_id order by punto_id)
    from (
      select distinct unnest(q.puntos_permitidos || array[
        '20000000-0000-4000-8000-000000000003'::uuid,
        '20000000-0000-4000-8000-000000000004'::uuid
      ]) as punto_id
    ) permitidos
  )
end
where q.id = '30000000-0000-4000-8000-000000000002'
  and lower(btrim(q.nombre)) = 'turbidez';

comment on column public.parametros_calidad.puntos_permitidos is
  'IDs habilitados. NULL permite todos los puntos del área. Turbidez incluye AIMSU, Pila M-2 y Pila M-4.';

notify pgrst, 'reload schema';
commit;
