begin;

create table if not exists public.turnos_operativos (
  id uuid primary key default gen_random_uuid(),
  fecha_operativa date not null,
  area public.area_planta not null,
  turno public.turno_tipo not null,
  operador_id uuid not null
    references public.operadores(id),
  iniciado_por uuid not null
    references auth.users(id),
  iniciado_en timestamptz not null default now(),
  finalizado_en timestamptz,
  notas_cierre text,

  constraint turnos_fechas_validas
    check (
      finalizado_en is null
      or finalizado_en >= iniciado_en
    )
);

-- Pendiente: definir reglas de duplicados y relevos
-- de operador antes de habilitar el inicio de turnos.

alter table public.turnos_operativos
  enable row level security;

revoke all on table public.turnos_operativos
  from anon, authenticated;

commit;