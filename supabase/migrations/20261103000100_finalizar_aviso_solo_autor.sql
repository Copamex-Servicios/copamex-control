-- Solo el autor autenticado puede finalizar manualmente su aviso.
-- Protege la RPC existente y el UPDATE directo sin sustituir su definición.
-- No cambia filas, RLS, permisos de tablas, firmas RPC ni la expiración automática.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create function private.proteger_finalizacion_aviso_autor()
returns trigger language plpgsql security invoker set search_path = '' as $funcion$
declare cuenta uuid := auth.uid();
begin
  if new.permanente is false and new.fin is not null and new.fin <= clock_timestamp()
    and (new.permanente is distinct from old.permanente or new.fin is distinct from old.fin)
  then
    -- Conserva las operaciones de mantenimiento sin una sesión de aplicación.
    if cuenta is null and current_user in ('postgres', 'service_role') then return new; end if;
    if cuenta is null or cuenta is distinct from old.creado_por
      or not coalesce(private.rol_actual()::text in ('admin', 'calidad'), false)
    then
      raise exception using errcode = '42501',
        message = 'Solo la cuenta que creó el aviso puede finalizarlo.';
    end if;
  end if;
  return new;
end;
$funcion$;
alter function private.proteger_finalizacion_aviso_autor() owner to postgres;
revoke all on function private.proteger_finalizacion_aviso_autor() from public, anon, authenticated;
create trigger proteger_finalizacion_aviso_autor
  before update on public.avisos
  for each row execute function private.proteger_finalizacion_aviso_autor();

commit;
