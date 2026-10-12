begin;

create table if not exists public.puntos_muestreo (
  id uuid primary key default gen_random_uuid(),
  nombre text not null
    check (length(trim(nombre)) > 0),
  area public.area_planta,
  activo boolean not null default true,
  orden integer not null default 0
);

create table if not exists public.parametros_calidad (
  id uuid primary key default gen_random_uuid(),
  nombre text not null
    check (length(trim(nombre)) > 0),
  unidad text,
  activo boolean not null default true
);

alter table public.puntos_muestreo
  enable row level security;

alter table public.parametros_calidad
  enable row level security;

revoke all on table public.puntos_muestreo
  from anon, authenticated;

revoke all on table public.parametros_calidad
  from anon, authenticated;

commit;