-- LOCAL: pendiente de aplicar en Supabase. Consulta de tamaño solo para Administración.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function public.consultar_almacenamiento_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not coalesce(private.es_admin(), false) then
    raise exception using errcode = '42501', message = 'Solo Administración puede consultar el almacenamiento.';
  end if;
  return pg_catalog.jsonb_build_object(
    'bytes_usados', pg_catalog.pg_database_size(pg_catalog.current_database()),
    'consultado_en', pg_catalog.statement_timestamp()
  );
end;
$function$;

alter function public.consultar_almacenamiento_dashboard() owner to postgres;
revoke all on function public.consultar_almacenamiento_dashboard() from public, anon, authenticated, service_role;
grant execute on function public.consultar_almacenamiento_dashboard() to authenticated;
notify pgrst, 'reload schema';
commit;
