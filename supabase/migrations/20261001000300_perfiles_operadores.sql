begin;

create table if not exists public.perfiles (
  id uuid primary key references auth.users(id),
  nombre text not null check (length(trim(nombre)) > 0),
  rol public.rol_usuario not null,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

create table if not exists public.operadores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(trim(nombre)) > 0),
  numero_empleado text,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

alter table public.perfiles enable row level security;
alter table public.operadores enable row level security;

revoke all on table public.perfiles
  from anon, authenticated;

revoke all on table public.operadores
  from anon, authenticated;

commit;