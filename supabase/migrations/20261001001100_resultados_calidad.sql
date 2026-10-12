begin;

create table if not exists public.resultados_calidad (
  id uuid primary key default gen_random_uuid(),
  muestra_id uuid not null
    references public.muestras_calidad(id),
  punto_id uuid not null
    references public.puntos_muestreo(id),
  parametro_id uuid not null
    references public.parametros_calidad(id),

  valor numeric not null,
  limite_min_aplicado numeric,
  limite_max_aplicado numeric,

  fuera_norma boolean generated always as (
    case
      when limite_min_aplicado is null
        and limite_max_aplicado is null
      then null
      else
        (limite_min_aplicado is not null
          and valor < limite_min_aplicado)
        or
        (limite_max_aplicado is not null
          and valor > limite_max_aplicado)
    end
  ) stored,

  constraint resultados_punto_parametro_unico
    unique (muestra_id, punto_id, parametro_id),

  constraint resultados_limites_validos
    check (limite_min_aplicado <= limite_max_aplicado)
);

create index if not exists resultados_calidad_punto_parametro_idx
  on public.resultados_calidad(punto_id, parametro_id);

-- Pendiente: asignar automáticamente los límites aplicados
-- y protegerlos antes de habilitar capturas.

alter table public.resultados_calidad
  enable row level security;

revoke all on table public.resultados_calidad
  from anon, authenticated;

commit;