-- Tablas restantes de la Fase 1.
-- Ejecutar después de las migraciones 00100 a 01400.
-- Las políticas, funciones, triggers y semillas se agregan después.

begin;

-- El papel seleccionado debe pertenecer a la máquina indicada.
create table if not exists public.programa_produccion (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  maquina_id uuid not null references public.maquinas(id),
  papel_id uuid not null,
  color_objetivo text,
  consumo_objetivo text,
  activo boolean not null default true,
  creado_por uuid not null references auth.users(id),
  creado_en timestamptz not null default now(),

  constraint produccion_papel_maquina_valido
    foreign key (papel_id, maquina_id)
    references public.catalogo_papeles(id, maquina_id)
);

-- La lógica que decide cuáles avisos mostrar se agregará después.
create table if not exists public.avisos (
  id uuid primary key default gen_random_uuid(),
  mensaje text not null check (length(trim(mensaje)) > 0),
  permanente boolean not null default false,
  inicio timestamptz,
  fin timestamptz,
  creado_por uuid not null references auth.users(id),
  creado_en timestamptz not null default now(),

  constraint avisos_fechas_validas
    check (fin is null or inicio is null or fin > inicio)
);

create table if not exists public.eventos_calendario (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  tipo text not null check (length(trim(tipo)) > 0),
  area text not null check (length(trim(area)) > 0),
  horario text,
  motivo text,
  creado_por uuid not null references auth.users(id),
  creado_en timestamptz not null default now()
);

create table if not exists public.parametros (
  clave text primary key check (length(trim(clave)) > 0),
  valor text not null,
  descripcion text,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references auth.users(id)
);

-- Los triggers que registran acciones administrativas se agregan después.
create table if not exists public.auditoria (
  id bigint generated always as identity primary key,
  creado_en timestamptz not null default now(),
  usuario uuid references auth.users(id),
  accion text not null check (length(trim(accion)) > 0),
  tabla text not null check (length(trim(tabla)) > 0),
  registro_id text,
  antes jsonb,
  despues jsonb
);

create index if not exists auditoria_creado_en_idx
  on public.auditoria(creado_en);

alter table public.programa_produccion enable row level security;
alter table public.avisos enable row level security;
alter table public.eventos_calendario enable row level security;
alter table public.parametros enable row level security;
alter table public.auditoria enable row level security;

revoke all on table
  public.programa_produccion,
  public.avisos,
  public.eventos_calendario,
  public.parametros,
  public.auditoria
from anon, authenticated;

revoke all on sequence public.auditoria_id_seq
  from anon, authenticated;

commit;
