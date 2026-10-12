begin;

-- Evita repetir el mismo turno de una misma área y fecha.
create unique index if not exists turnos_fecha_area_tipo_unico
  on public.turnos_operativos(fecha_operativa, area, turno);

-- Facilita consultar los turnos de un área por fecha.
create index if not exists turnos_area_fecha_idx
  on public.turnos_operativos(area, fecha_operativa);

-- Facilita consultar los turnos de cada operador.
create index if not exists turnos_operador_id_idx
  on public.turnos_operativos(operador_id);

commit;