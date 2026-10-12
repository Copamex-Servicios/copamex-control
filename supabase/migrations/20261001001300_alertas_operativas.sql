begin;

create table if not exists public.alertas_operativas (
  id uuid primary key default gen_random_uuid(),
  modulo text not null check (length(trim(modulo)) > 0),
  registro_id uuid not null,
  tipo text not null check (length(trim(tipo)) > 0),
  mensaje text not null check (length(trim(mensaje)) > 0),

  valor numeric,
  limite numeric,
  estado public.estado_alerta not null default 'abierta',
  creado_en timestamptz not null default now(),

  reconocido_por uuid references auth.users(id),
  reconocido_en timestamptz,
  comentario text,

  cerrado_por uuid references auth.users(id),
  cerrado_en timestamptz,

  constraint alertas_reconocimiento_consistente
    check (
      (reconocido_por is null and reconocido_en is null)
      or
      (reconocido_por is not null and reconocido_en is not null)
    ),

  constraint alertas_cierre_consistente
    check (
      (cerrado_por is null and cerrado_en is null)
      or
      (cerrado_por is not null and cerrado_en is not null)
    )
);

create index if not exists alertas_operativas_estado_idx
  on public.alertas_operativas(estado);

create index if not exists alertas_operativas_creado_en_idx
  on public.alertas_operativas(creado_en);

-- Pendiente: definir generación, cambios de estado
-- y validación del registro de origen.

alter table public.alertas_operativas
  enable row level security;

revoke all on table public.alertas_operativas
  from anon, authenticated;

commit;