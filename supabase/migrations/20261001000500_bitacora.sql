begin;

create table if not exists public.bitacora (
  id uuid primary key default gen_random_uuid(),
  turno_id uuid not null
    references public.turnos_operativos(id),
  texto text not null
    check (length(trim(texto)) > 0),
  capturado_en timestamptz not null,
  recibido_en timestamptz not null default now(),
  creado_por uuid not null
    references auth.users(id),
  eliminado_en timestamptz,
  eliminado_por uuid
    references auth.users(id),

  constraint bitacora_borrado_consistente
    check (
      (eliminado_en is null and eliminado_por is null)
      or
      (eliminado_en is not null and eliminado_por is not null)
    )
);

create index if not exists bitacora_turno_id_idx
  on public.bitacora(turno_id);

create index if not exists bitacora_capturado_en_idx
  on public.bitacora(capturado_en);

alter table public.bitacora
  enable row level security;

revoke all on table public.bitacora
  from anon, authenticated;

commit;