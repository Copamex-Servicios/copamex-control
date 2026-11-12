-- Preparada para revisión. No aplicada en Supabase.
-- Conserva la RPC original, las políticas, los permisos y los datos existentes.
begin;

do $$
begin
  if pg_catalog.to_regprocedure('public.obtener_o_crear_papel(uuid,text)') is null
    or pg_catalog.to_regprocedure('private.rol_actual()') is null then
    raise exception using errcode = '42883',
      message = 'Faltan las funciones existentes del catálogo de papeles. Verifica el proyecto antes de aplicar.';
  end if;
end;
$$;

create function public.obtener_o_crear_papel_calidad(
  p_maquina uuid,
  p_nombre text
)
returns public.catalogo_papeles
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or private.rol_actual()::text is distinct from 'calidad' then
    raise exception using errcode = '42501',
      message = 'Solo una cuenta activa de Calidad puede agregar papeles mediante esta operación.';
  end if;

  -- Reutiliza normalización, validaciones, bloqueo concurrente y auditoría.
  -- Solo obtiene o crea el papel; no crea una programación de producción.
  return public.obtener_o_crear_papel(p_maquina, p_nombre);
end;
$$;

alter function public.obtener_o_crear_papel_calidad(uuid, text)
  owner to postgres;
revoke all on function public.obtener_o_crear_papel_calidad(uuid, text)
  from public, anon, authenticated;
grant execute on function public.obtener_o_crear_papel_calidad(uuid, text)
  to authenticated;

commit;
