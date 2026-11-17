-- LOCAL: pendiente de aplicar. Retira Salida TQE de capturas nuevas.
-- Los resultados y límites históricos se conservan.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $pre$
begin
 if not exists(select 1 from public.puntos_muestreo where id='20000000-0000-4000-8000-000000000008') then
  raise exception 'No se encontró el punto original de Salida TQE. Revisar su ID.';
 end if;
end;
$pre$;
update public.puntos_muestreo set activo=false
 where id='20000000-0000-4000-8000-000000000008' and activo;
commit;
