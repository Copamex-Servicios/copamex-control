begin;

create table if not exists public.lecturas_pozos (
  id uuid primary key default gen_random_uuid(),
  turno_id uuid not null unique
    references public.turnos_operativos(id),

  pozo1_ini numeric not null,
  pozo1_fin numeric not null,
  consumo_pozo1 numeric
    generated always as (pozo1_fin - pozo1_ini) stored,

  pozo2_ini numeric not null,
  pozo2_fin numeric not null,
  consumo_pozo2 numeric
    generated always as (pozo2_fin - pozo2_ini) stored,

  notas text,
  capturado_en timestamptz not null,
  recibido_en timestamptz not null default now(),
  creado_por uuid not null references auth.users(id),
  eliminado_en timestamptz,
  eliminado_por uuid references auth.users(id),

  constraint pozo1_lecturas_validas
    check (pozo1_fin >= pozo1_ini),

  constraint pozo2_lecturas_validas
    check (pozo2_fin >= pozo2_ini),

  constraint pozos_borrado_consistente
    check (
      (eliminado_en is null and eliminado_por is null)
      or
      (eliminado_en is not null and eliminado_por is not null)
    )
);

alter table public.lecturas_pozos
  enable row level security;

revoke all on table public.lecturas_pozos
  from anon, authenticated;

commit;