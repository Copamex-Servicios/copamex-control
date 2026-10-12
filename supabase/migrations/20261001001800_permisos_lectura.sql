-- Fase 1: identificación del rol y lectura de perfiles y configuración.
-- Ejecutar como postgres en el SQL Editor, después de las migraciones previas.
-- Mantener el esquema private fuera de los esquemas expuestos por la Data API.
-- Este archivo otorga SELECT; los permisos de escritura se agregan después.

begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

-- Devuelve exclusivamente el rol del usuario autenticado si su perfil está activo.
-- SECURITY DEFINER evita recursión al consultar perfiles desde sus propias políticas.
create or replace function private.rol_actual()
returns public.rol_usuario
language sql
stable
security definer
set search_path = ''
as $$
  select p.rol
  from public.perfiles p
  where p.id = (select auth.uid())
    and p.activo;
$$;

alter function private.rol_actual() owner to postgres;

create or replace function private.es_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    private.rol_actual() = 'admin'::public.rol_usuario,
    false
  );
$$;

alter function private.es_admin() owner to postgres;

revoke all on function private.rol_actual(), private.es_admin()
  from public, anon, authenticated;

grant execute on function private.rol_actual(), private.es_admin()
  to authenticated;

-- Cada cuenta puede leer su perfil, incluso para mostrar que fue desactivada.
-- Solo administradores activos pueden consultar los perfiles de otras cuentas.
alter table public.perfiles enable row level security;
drop policy if exists lectura_perfil on public.perfiles;
create policy lectura_perfil
  on public.perfiles
  for select
  to authenticated
  using (
    id = (select auth.uid())
    or (select private.es_admin())
  );

grant select on table public.perfiles to authenticated;

-- Las cuentas con perfil activo pueden leer catálogos y configuración.
-- El listado de tablas es fijo y todos sus nombres se escapan con %I.
do $$
declare
  tabla_configuracion text;
begin
  foreach tabla_configuracion in array array[
    'operadores',
    'puntos_muestreo',
    'parametros_calidad',
    'limites_calidad',
    'maquinas',
    'catalogo_papeles',
    'parametros',
    'avisos',
    'eventos_calendario',
    'programa_produccion'
  ]
  loop
    execute format(
      'alter table public.%I enable row level security',
      tabla_configuracion
    );

    execute format(
      'drop policy if exists lectura_cuentas_activas on public.%I',
      tabla_configuracion
    );

    execute format(
      'create policy lectura_cuentas_activas on public.%I '
      'for select to authenticated '
      'using ((select private.rol_actual()) is not null)',
      tabla_configuracion
    );

    execute format(
      'grant select on table public.%I to authenticated',
      tabla_configuracion
    );
  end loop;
end;
$$;

commit;
