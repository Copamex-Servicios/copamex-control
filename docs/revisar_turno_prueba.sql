-- SOLO LECTURA. Ejecutar en el SQL Editor para identificar el turno de prueba.
-- No cierra, reabre, anula ni elimina registros.
select t.id, t.fecha_operativa, t.area, t.turno,
 o.nombre operador, oa.nombre operador_acompanante,
 t.iniciado_en at time zone 'America/Mexico_City' inicio_mexico,
 t.finalizado_en at time zone 'America/Mexico_City' cierre_mexico,
 (select count(*) from public.bitacora where turno_id=t.id)
 + (select count(*) from public.lecturas_pozos where turno_id=t.id)
 + (select count(*) from public.lecturas_uf where turno_id=t.id)
 + (select count(*) from public.lecturas_ptar where turno_id=t.id)
 + (select count(*) from public.muestras_calidad where turno_id=t.id)
 + (select count(*) from public.bitacora_calderas where turno_id=t.id)
 + (select count(*) from public.bitacora_ptar where turno_id=t.id) capturas_asociadas
from public.turnos_operativos t
join public.operadores o on o.id=t.operador_id
left join public.operadores oa on oa.id=t.operador_acompanante_id
where t.fecha_operativa=(statement_timestamp() at time zone 'America/Mexico_City')::date
 or (t.iniciado_en at time zone 'America/Mexico_City')::date=(statement_timestamp() at time zone 'America/Mexico_City')::date
order by t.iniciado_en desc;
