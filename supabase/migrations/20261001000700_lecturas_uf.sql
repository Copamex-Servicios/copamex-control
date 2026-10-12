begin;

create table if not exists public.lecturas_uf (
  id uuid primary key default gen_random_uuid(),
  turno_id uuid not null unique
    references public.turnos_operativos(id),

  alim_ini numeric not null,
  alim_fin numeric not null,
  acep_ini numeric not null,
  acep_fin numeric not null,

  alimentado numeric generated always as (
    alim_fin - alim_ini
  ) stored,

  aceptado numeric generated always as (
    acep_fin - acep_ini
  ) stored,

  rechazo numeric generated always as (
    (alim_fin - alim_ini) - (acep_fin - acep_ini)
  ) stored,

  rendimiento numeric generated always as (
    (acep_fin - acep_ini) * 100
    / nullif(alim_fin - alim_ini, 0)
  ) stored,

  notas text,
  capturado_en timestamptz not null,
  recibido_en timestamptz not null default now(),
  creado_por uuid not null references auth.users(id),
  eliminado_en timestamptz,
  eliminado_por uuid references auth.users(id),

  constraint uf_alimentacion_valida
    check (alim_fin >= alim_ini),

  constraint uf_aceptacion_valida
    check (acep_fin >= acep_ini),

  constraint uf_borrado_consistente
    check (
      (eliminado_en is null and eliminado_por is null)
      or
      (eliminado_en is not null and eliminado_por is not null)
    )
);

alter table public.lecturas_uf
  enable row level security;

revoke all on table public.lecturas_uf
  from anon, authenticated;

commit;