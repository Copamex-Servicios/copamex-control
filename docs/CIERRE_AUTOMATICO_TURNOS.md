# Cierre automático de turnos

Aplicar por separado, como postgres, la migración local
`supabase/migrations/20261110000100_cierre_automatico_turnos.sql`.
Depende de `20261106000400_correcciones_horario_tecnico.sql` y habilita pg_cron.
No fue ejecutada remotamente por este cambio.

El cierre se registra en `turnos_operativos.finalizado_en`:

- Día: 15:01 de la fecha operativa.
- Tarde: 21:01 de la fecha operativa.
- Noche: 07:01 del día siguiente.

Todos los horarios corresponden a America/Mexico_City. El trabajo se ejecuta
en el minuto 01 de cada hora (24 ejecuciones SQL internas diarias, sin HTTP).
La escritura puede aparecer unos segundos después del límite, según el planificador.
Opera aunque no haya navegadores abiertos. Si el servidor estuvo detenido, recoge
los turnos vencidos en la siguiente ejecución. Los bloqueos de acciones en curso
se respetan; los turnos omitidos por bloqueo se recogen en la siguiente ejecución.

La pantalla vuelve a consultar el turno al llegar al fin programado y, mientras
siga abierto, reintenta una vez por minuto. El reloj del navegador únicamente
programa lecturas: no decide ni autoriza cierres. Solo muestra el cierre confirmado.

Al instalar, también cierra turnos abiertos ya vencidos. No altera turnos previamente
cerrados, operadores, fecha operativa, notas ni capturas. Si un turno antiguo
contiene capturas posteriores al fin programado, conserva los datos y registra el
cierre en la última captura o inicio, lo que sea posterior, para respetar los
triggers existentes. No cambia la clasificación histórica de los turnos nocturnos.
El trigger de auditoría existente registra la actualización con usuario nulo
(operación del servidor). Los reportes incompletos continúan pendientes.

La función interna no tiene permisos de ejecución para usuarios de la aplicación.
El cierre manual sigue disponible antes del fin del horario.

Consulta de comprobación (solo lectura) tras instalar:

```sql
select jobname, schedule, active from cron.job
where jobname = 'copamex-cerrar-turnos-vencidos';

select t.id, t.area, t.fecha_operativa, t.turno, t.finalizado_en, v.fin
from public.turnos_operativos t
cross join lateral private.bt_intervalo(t.fecha_operativa,t.turno) v
where t.finalizado_en is null and v.fin <= now();
```

Referencia: https://supabase.com/docs/guides/cron
