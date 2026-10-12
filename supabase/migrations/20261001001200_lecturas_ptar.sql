begin;

create table if not exists public.lecturas_ptar (
  id uuid primary key default gen_random_uuid(),
  turno_id uuid not null
    references public.turnos_operativos(id),

  -- Mediciones expresadas en mg/L.
  dqo_sand_float numeric,
  dqo_t03_04 numeric,
  dqo_colector numeric,
  dqo_pila numeric,

  sst_sand_float numeric,
  sst_t03_04 numeric,
  sst_colector numeric,
  sst_pila numeric,

  notas text,
  capturado_en timestamptz not null,
  recibido_en timestamptz not null default now(),
  creado_por uuid not null references auth.users(id),
  eliminado_en timestamptz,
  eliminado_por uuid references auth.users(id),

  constraint ptar_al_menos_una_medicion
    check (
      dqo_sand_float is not null
      or dqo_t03_04 is not null
      or dqo_colector is not null
      or dqo_pila is not null
      or sst_sand_float is not null
      or sst_t03_04 is not null
      or sst_colector is not null
      or sst_pila is not null
    ),

  constraint ptar_borrado_consistente
    check (
      (eliminado_en is null and eliminado_por is null)
      or
      (eliminado_en is not null and eliminado_por is not null)
    )
);

create index if not exists lecturas_ptar_turno_id_idx
  on public.lecturas_ptar(turno_id);

alter table public.lecturas_ptar
  enable row level security;

revoke all on table public.lecturas_ptar
  from anon, authenticated;

commit;