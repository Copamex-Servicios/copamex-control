begin;

create table if not exists public.maquinas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique
    check (length(trim(codigo)) > 0),
  nombre text not null
    check (length(trim(nombre)) > 0),
  activo boolean not null default true
);

create table if not exists public.catalogo_papeles (
  id uuid primary key default gen_random_uuid(),
  maquina_id uuid not null references public.maquinas(id),
  nombre text not null
    check (length(trim(nombre)) > 0),
  activo boolean not null default true,

  constraint papeles_maquina_nombre_unico
    unique (maquina_id, nombre),

  constraint papeles_id_maquina_unico
    unique (id, maquina_id)
);

alter table public.maquinas
  enable row level security;

alter table public.catalogo_papeles
  enable row level security;

revoke all on table public.maquinas
  from anon, authenticated;

revoke all on table public.catalogo_papeles
  from anon, authenticated;

commit;