-- Amplía la protección instalada por 20261103000100_finalizar_aviso_solo_autor.sql.
-- Solo la cuenta creadora puede editar o finalizar el aviso.
-- No modifica filas, RLS, permisos de tablas ni la RPC existente.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function private.proteger_finalizacion_aviso_autor()
returns trigger language plpgsql security invoker set search_path = '' as $funcion$
declare cuenta uuid := auth.uid();
begin
  if new is not distinct from old then return new; end if;
  if cuenta is null and current_user in ('postgres', 'service_role') then return new; end if;
  if cuenta is null or cuenta is distinct from old.creado_por
    or not coalesce(private.rol_actual()::text in ('admin', 'calidad'), false)
  then
    raise exception using errcode = '42501',
      message = 'Solo la cuenta que creó el aviso puede editarlo o finalizarlo.';
  end if;
  return new;
end;
$funcion$;
alter function private.proteger_finalizacion_aviso_autor() owner to postgres;
revoke all on function private.proteger_finalizacion_aviso_autor() from public, anon, authenticated;

-- Se conserva el trigger ya instalado sobre public.avisos.
commit;
