begin;

create table if not exists public.muestras_calidad (
  id uuid primary key default gen_random_uuid(),
  turno_id uuid not null
    references public.turnos_operativos(id),
  hora_muestra time not null,
  notas text,

  capturado_en timestamptz not null,
  recibido_en timestamptz not null default now(),
  creado_por uuid not null references auth.users(id),
  eliminado_en timestamptz,
  eliminado_por uuid references auth.users(id),

  constraint muestras_borrado_consistente
    check (
      (eliminado_en is null and eliminado_por is null)
      or
      (eliminado_en is not null and eliminado_por is not null)
    )
);

create index if not exists muestras_calidad_turno_id_idx
  on public.muestras_calidad(turno_id);

create index if not exists muestras_calidad_capturado_en_idx
  on public.muestras_calidad(capturado_en);

alter table public.muestras_calidad
  enable row level security;

revoke all on table public.muestras_calidad
  from anon, authenticated;

commit;