-- Fecha/hora de México para mostrar en el formulario, antes de iniciar.
-- Ejecutar completo después de la migración 025, como postgres.
-- Consulta de solo lectura; no modifica turnos, registros ni permisos de tablas.
-- La fecha del turno sigue siendo asignada al guardar por la migración 025.
-- Referencias:
-- https://supabase.com/docs/guides/database/functions
-- https://www.postgresql.org/docs/current/functions-datetime.html

begin;

create or replace function public.consultar_reloj_operativo()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  instante timestamptz := statement_timestamp();
  hora_mexico timestamp := instante at time zone 'America/Mexico_City';
begin
  if auth.uid() is null
    or not coalesce(private.rol_actual() in ('calderas', 'ptar'), false)
  then
    raise exception using errcode = '42501',
      message = 'Se necesita una cuenta de área activa para consultar el reloj.';
  end if;

  return jsonb_build_object(
    'fecha', to_char(hora_mexico, 'YYYY-MM-DD'),
    'hora', to_char(hora_mexico, 'HH24:MI')
  );
end;
$$;

alter function public.consultar_reloj_operativo() owner to postgres;
revoke all on function public.consultar_reloj_operativo()
  from public, anon, authenticated;
grant execute on function public.consultar_reloj_operativo() to authenticated;

notify pgrst, 'reload schema';
commit;
