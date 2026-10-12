begin;

create table if not exists public.limites_calidad (
  id uuid primary key default gen_random_uuid(),
  punto_id uuid not null
    references public.puntos_muestreo(id),
  parametro_id uuid not null
    references public.parametros_calidad(id),

  limite_min numeric,
  limite_max numeric,

  vigente_desde timestamptz not null,
  vigente_hasta timestamptz,
  activo boolean not null default true,

  creado_por uuid not null references auth.users(id),
  creado_en timestamptz not null default now(),

  constraint limites_al_menos_un_valor
    check (
      limite_min is not null
      or limite_max is not null
    ),

  constraint limites_orden_validos
    check (limite_min <= limite_max),

  constraint limites_vigencia_valida
    check (
      vigente_hasta is null
      or vigente_hasta > vigente_desde
    )
);

-- Pendiente: impedir vigencias superpuestas para
-- un mismo punto y parámetro antes de habilitar capturas.

alter table public.limites_calidad
  enable row level security;

revoke all on table public.limites_calidad
  from anon, authenticated;

commit;