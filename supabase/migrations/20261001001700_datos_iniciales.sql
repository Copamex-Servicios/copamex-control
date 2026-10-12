-- Datos iniciales definidos en REQUERIMIENTOS.md.
-- Ejecutar después de las migraciones anteriores.
-- Los IDs fijos permiten repetir esta carga sin duplicar sus filas.
-- ON CONFLICT evita sobrescribir datos ya existentes.

begin;

insert into public.maquinas (id, codigo, nombre)
values
  ('10000000-0000-4000-8000-000000000001', 'M2', 'M2'),
  ('10000000-0000-4000-8000-000000000002', 'M4', 'M4')
on conflict do nothing;

-- La asignación de puntos a áreas sigue pendiente de confirmación.
insert into public.puntos_muestreo (id, nombre, area, orden)
values
  ('20000000-0000-4000-8000-000000000001', 'AIMSU', null, 1),
  ('20000000-0000-4000-8000-000000000002', 'Pozo', null, 2),
  ('20000000-0000-4000-8000-000000000003', 'Pila M-2', null, 3),
  ('20000000-0000-4000-8000-000000000004', 'Pila M-4', null, 4),
  ('20000000-0000-4000-8000-000000000005', 'Pila Calderas', null, 5),
  ('20000000-0000-4000-8000-000000000006', 'PEMEX', null, 6),
  ('20000000-0000-4000-8000-000000000007', 'Retorno TQE', null, 7),
  ('20000000-0000-4000-8000-000000000008', 'Salida TQE', null, 8)
on conflict (id) do nothing;

-- Las unidades reales de Color y Turbidez siguen pendientes.
insert into public.parametros_calidad (id, nombre, unidad)
values
  ('30000000-0000-4000-8000-000000000001', 'Color', null),
  ('30000000-0000-4000-8000-000000000002', 'Turbidez', null)
on conflict (id) do nothing;

insert into public.parametros (clave, valor, descripcion)
values
  (
    'concesion_anual_m3',
    '277000',
    'Concesión anual de extracción de agua, expresada en m³.'
  ),
  (
    'uf_rendimiento_verde',
    '85',
    'Rendimiento de UF desde el que se muestra verde, en porcentaje.'
  ),
  (
    'uf_rendimiento_ambar',
    '70',
    'Rendimiento de UF desde el que se muestra ámbar, en porcentaje.'
  )
on conflict (clave) do nothing;

commit;
