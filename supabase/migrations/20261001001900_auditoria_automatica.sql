-- Fase 1: auditoría automática antes de habilitar permisos de escritura.
-- Ejecutar como postgres después de las migraciones anteriores.
-- Las cargas iniciales ya realizadas no se registran retroactivamente.

begin;

create or replace function private.registrar_auditoria()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  datos_antes jsonb;
  datos_despues jsonb;
  identificador text;
begin
  if tg_op = 'INSERT' then
    datos_despues := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    datos_antes := to_jsonb(old);
    datos_despues := to_jsonb(new);

    -- Una actualización que deja todo igual no genera una entrada adicional.
    if datos_antes is not distinct from datos_despues then
      return null;
    end if;
  elsif tg_op = 'DELETE' then
    datos_antes := to_jsonb(old);
  end if;

  identificador := coalesce(
    datos_despues ->> 'id',
    datos_antes ->> 'id',
    datos_despues ->> 'clave',
    datos_antes ->> 'clave'
  );

  insert into public.auditoria (
    creado_en,
    usuario,
    accion,
    tabla,
    registro_id,
    antes,
    despues
  )
  values (
    clock_timestamp(),
    auth.uid(),
    tg_op,
    tg_table_schema || '.' || tg_table_name,
    identificador,
    datos_antes,
    datos_despues
  );

  -- Los triggers AFTER ignoran este valor de retorno.
  return null;
end;
$$;

alter function private.registrar_auditoria() owner to postgres;
revoke all on function private.registrar_auditoria()
  from public, anon, authenticated;

-- El usuario autenticado se identifica por auth.uid(). En operaciones de
-- instalación desde el SQL Editor puede ser NULL, pues no existe sesión Auth.
do $$
declare
  tabla_auditada text;
begin
  foreach tabla_auditada in array array[
    'perfiles',
    'operadores',
    'turnos_operativos',
    'bitacora',
    'lecturas_pozos',
    'lecturas_uf',
    'puntos_muestreo',
    'parametros_calidad',
    'limites_calidad',
    'muestras_calidad',
    'resultados_calidad',
    'lecturas_ptar',
    'alertas_operativas',
    'maquinas',
    'catalogo_papeles',
    'programa_produccion',
    'avisos',
    'eventos_calendario',
    'parametros'
  ]
  loop
    execute format(
      'drop trigger if exists registrar_auditoria on public.%I',
      tabla_auditada
    );

    execute format(
      'create trigger registrar_auditoria '
      'after insert or update or delete on public.%I '
      'for each row execute function private.registrar_auditoria()',
      tabla_auditada
    );
  end loop;
end;
$$;

-- Las entradas de auditoría se conservan sin modificaciones ni borrados.
create or replace function private.impedir_modificar_auditoria()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '42501',
    message = 'Las entradas de auditoría no se pueden modificar ni borrar.';
end;
$$;

alter function private.impedir_modificar_auditoria() owner to postgres;
revoke all on function private.impedir_modificar_auditoria()
  from public, anon, authenticated;

drop trigger if exists auditoria_inmutable on public.auditoria;
create trigger auditoria_inmutable
  before update or delete on public.auditoria
  for each row execute function private.impedir_modificar_auditoria();

drop trigger if exists auditoria_no_truncate on public.auditoria;
create trigger auditoria_no_truncate
  before truncate on public.auditoria
  for each statement execute function private.impedir_modificar_auditoria();

alter table public.auditoria enable row level security;
revoke all on table public.auditoria from public, anon, authenticated;
revoke all on sequence public.auditoria_id_seq
  from public, anon, authenticated;

drop policy if exists lectura_admin_auditoria on public.auditoria;
create policy lectura_admin_auditoria
  on public.auditoria
  for select
  to authenticated
  using ((select private.es_admin()));

grant select on table public.auditoria to authenticated;

commit;
