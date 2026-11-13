# Seguimiento adicional de color M4

Estado: código local y migración 20261112000200_seguimiento_color_m4.sql. No aplicada remotamente. Aplicar completa como postgres antes de publicar el frontend. Requiere las migraciones previas de Calidad y horario de turnos; mantener también la migración de SST ya aplicada.

## Uso

1. Administración → Dashboard → Seguimiento de color M4. Escribir instrucciones (por ejemplo, “TOMAR COLOR M4 CADA DOS HORAS”) y activar.
2. La transacción publica un aviso permanente y crea el seguimiento vinculado por ID. No interpreta palabras clave. Solo admite un seguimiento activo de cada tipo.
3. Los operadores de Calderas ven el aviso en su apartado existente. Calidad de agua muestra “Tomar color M4” después de registrar la muestra habitual del turno.
4. Cada guardado crea una muestra independiente con un solo resultado de Color/Pila M-4 y hora del servidor. Conserva turno, cuenta y pareja de operadores del turno; no autentica por separado a cada persona ni inventa quién de los dos hizo la medición.
5. La consulta del turno conserva las muestras habituales e integra las adicionales como filas al final de la tabla de resultados del último registro habitual. Cada fila conserva su valor, límites y evaluación propios y muestra “Adicional” con su hora. No se crea otro desplegable ni se reemplaza el color original. Se consulta el último registro habitual y se recuperan todas las adicionales mediante páginas independientes para no omitirlas por la página visible del historial.
6. La exportación individual de la última hoja incorpora esas mismas filas y su hora. Las exportaciones diarias siguen recorriendo las muestras reales por separado, incluyendo las adicionales una sola vez. Los permisos de exportación se conservan.
7. La cuenta administradora creadora finaliza el seguimiento desde el Dashboard. También puede finalizar/editar el aviso en su gestión existente: se sincronizan la instrucción y el cierre. Se conserva la protección actual de autoría de Avisos.

El aviso y el botón se consultan automáticamente cada minuto mientras la página está visible y al recuperar foco. Las pestañas del mismo navegador reciben además el evento local. No son notificaciones push fuera de la aplicación. La frecuencia indicada en el aviso es una instrucción operativa: no genera alarmas horarias ni bloquea lecturas entre intervalos.

Finalizar o dejar expirar el aviso cierra la disponibilidad. Volver a mostrar un aviso ya finalizado no reabre el seguimiento; debe crearse uno nuevo. Un aviso con inicio futuro no habilita la captura antes de su inicio.

## Integridad

- Activación/cierre reservados a Administración en el servidor; lecturas reservadas a la cuenta de Calderas, con turno propio abierto y dentro de horario del servidor.
- Se exige una muestra habitual vigente del turno. Las adicionales no sustituyen la muestra habitual que consulta useCalidad.
- Muestra y resultado se insertan en una transacción. Los límites se aplican por el trigger existente y se conserva la generación de alertas si Color sale de norma.
- Los reintentos mantienen UUID, turno, seguimiento y valor inicial. El servidor confirma solicitudes recibidas incluso después de finalizar el seguimiento/cerrar el turno, sin generar otra lectura. La comparación usa el valor original, aunque después se corrija el resultado.
- La solicitud sin confirmar se conserva por cuenta en memoria y sessionStorage. No se permite cambiar sus valores hasta confirmar/rechazar el envío.
- No se otorgan escrituras directas en seguimientos; se preservan las reglas de capturas habituales, corrección, anulación y permisos existentes.
- Los nuevos registros generan auditoría. Las muestras históricas quedan con seguimiento_id NULL.
- El catálogo interno private.tipos_seguimiento_calidad contiene área, punto y parámetro; permite ampliar otros seguimientos mediante futuras migraciones sin depender del texto visible del aviso.

## Verificación

Pruebas automatizadas con Supabase simulado: permisos del cliente, cambio de cuenta, confirmación, rechazos, reintentos y conservación de muestras adicionales en la exportación diaria. TypeScript, lint y build.

La migración no se ejecutó contra una base desde Codex. En una copia de pruebas, verificar antes de usar: activación/aviso, lectura con turno y muestra habitual, rechazo de cuenta ajena/turno vencido/seguimiento cerrado, reintento del mismo UUID (una sola fila), cierre desde Avisos y Dashboard, paginación/exportación diaria y valores fuera de norma. No registrar pruebas ficticias en producción.
