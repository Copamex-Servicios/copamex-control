# Correcciones operativas y cierre técnico por horario

Implementación local del 6 de noviembre de 2026. **Migración remota pendiente de revisión y autorización.** No se ejecutó SQL remoto, no se instalaron dependencias y no se hicieron commits, push ni despliegues.

## Qué existía y qué se reutiliza

- Un reporte técnico por turno, con UNIQUE, comprobante inmutable de creación y reintentos idempotentes.
- Normalizadores y escritores versionados: Calderas v3 y PTAR v2, incluidas las extensiones de comentarios de Pilas, horas del DAF y velocidades de prensas.
- Formularios, validación completa del envío manual, consulta histórica y formatos actuales.
- Corrección administrativa con revisión esperada, snapshots antes/después, responsable, motivo y hora. Auditoría automática de tablas y revisiones.
- Inicio/cambio/cierre manual del turno, índice de un abierto por área y reloj del servidor.

No se encontró un trabajo cron, función de cierre automático por horario ni persistencia de borradores parciales técnicos. Por ello no se añadió un proceso cron paralelo: **el cierre técnico es lógico y se hace efectivo por la hora del servidor en cada escritura y consulta**, aun cuando no haya navegador abierto. No cambia `finalizado_en` automáticamente ni cierra Pozos, UF, Calidad, observaciones o Bitácora administrativa. El cierre manual global existente se conserva.

## Horarios exactos

Zona `America/Mexico_City`. Intervalos con inicio incluido y fin excluido:

| Turno | Inicio | Fin excluido |
|---|---|---|
| Día | 07:01:00 | 15:01:00 |
| Tarde | 15:01:00 | 21:01:00 |
| Noche | 21:01:00 | 07:01:00 del día siguiente |

Así, 15:00:59.999999 sigue siendo Día; 15:01:00 pertenece a Tarde. No quedan huecos entre minutos ni se habilitan dos horarios del área simultáneamente. El índice existente sigue impidiendo dos turnos físicamente abiertos en un área.

Las altas nuevas utilizan el trigger de inicio existente, con fecha del servidor corregida para Noche: una apertura a las 05:00 del día 5 corresponde a la fecha operativa 4. La RPC de parejas conserva identidad, operadores, bloqueos y reintentos, y rechaza seleccionar un tipo distinto al horario actual. No se reclasifican ni actualizan filas históricas. Un turno antiguo cuya fecha/tipo/inicio no coincide con su ventana permanece de solo lectura; no se corrige silenciosamente su identidad.

## Captura y corrección

Con la migración instalada, el contexto autorizado del servidor recupera el turno de la cuenta incluso si ya tuvo cierre manual anticipado. La cuenta operativa puede enviar o pulsar Editar reporte dentro de su ventana, siempre sobre ese turno y área. Una corrección conserva ID, turno, creador e instante originales e incrementa revisión. No modifica reportes ajenos ni ventanas anteriores.

Se conservan los campos obligatorios y las unidades. El nuevo envío valida completitud en SQL; un constraint trigger diferido también protege las RPC técnicas anteriores, comprobando el snapshot cuando ya están escritos sus hijos. Cero sigue siendo un dato explícito. Los opcionales se pueden vaciar expresamente en una corrección sin que el escritor los confunda con un cliente anterior que omitió la clave.

Cada corrección mantiene una solicitud estable. Se verifica revisión esperada bajo bloqueo de fila y se reutiliza el bloqueo transaccional por solicitud/turno. Una confirmación incierta congela los datos y reintenta la misma solicitud. Leer el reporte anterior no descarta una corrección incierta. Un conflicto definitivo carga la revisión vigente e informa al operador. Un reintento idéntico ya confirmado puede devolver su comprobante después del horario; no realiza otra escritura.

Las capturas técnicas existentes guardaban únicamente el envío completo. **No se ha incorporado autoguardado ni un borrador parcial en servidor.** Si el operador nunca envió, el texto local no se convierte en reporte al vencer el horario. Si había un reporte persistido incompleto, se conserva tal cual. La interfaz indica que los cambios sin enviar no se guardaron y no presenta una confirmación ficticia.

## Estados y supervisión

El servidor calcula Sin enviar, Enviado, Cerrado completo o Cerrado con pendientes a partir del turno, la ventana y los datos realmente persistidos. No se escribe un estado histórico artificial ni se rellenan mediciones.

Administración → Capturas → Reportes técnicos añade una consulta paginada de cerrados con pendientes (25 por página, sin límite total). Usa el período/área seleccionados:
- Si existe reporte parcial, Completar reporte abre la corrección administrativa existente, conservando snapshots, motivo y revisión.
- Si no existe reporte, reutiliza el formulario del área y exige un envío completo. Solo el administrador activo puede crear este reporte faltante después del cierre horario. Se conserva el turno/fecha operativa; el creador y hora real de incorporación por supervisión quedan registrados en el reporte y auditoría. No se simula un envío anterior del operador.
- El historial administrativo pasa a llamarse Historial de modificaciones para mostrar también correcciones del operador, con responsable, hora, motivo y antes/después existentes.

No se introduce un rol Supervisor: se reutiliza `private.es_admin()`, que es la autorización de revisión que existe en el código. Calidad y las cuentas operativas no obtienen acceso a la consulta de pendientes ni a su escritura administrativa.

## Archivos y seguridad

Migración nueva: `supabase/migrations/20261106000400_correcciones_horario_tecnico.sql`.

No crea tablas ni cambia políticas RLS o permisos de otros módulos. Añade RPC de contexto, guardado operativo y consulta de pendientes; helpers de horario/completitud y triggers técnicos. Actualiza las protecciones técnicas existentes para admitir exclusivamente la operación controlada del propietario dentro de horario, conservando la protección de identidad/unidades/revisión. Reutiliza `private.solicitudes_bitacora_tecnica`, `public.revisiones_captura` y la auditoría vigente. Los helpers de escritura no son ejecutables por clientes; solo los dos cálculos puros de fecha/intervalo tienen EXECUTE para el trigger/RPC de inicio invocador. No usa service_role en frontend.

Frontend:
- `src/lib/reporteOperativo.ts`: contexto validado, comprobación de cuenta/rol y consulta paginada de pendientes.
- `src/hooks/useVentanaReporte.ts`: permiso del servidor, estimación conservadora con reloj monotónico, caducidad y reconsulta al enfocar/volver y cada 30 segundos.
- `src/hooks/useReporteCalderas.ts` y `useReportePTAR.ts`: reutilizan sus stores y flujos, añadiendo edición, versión esperada, confirmación y recuperación del turno cerrado manualmente.
- `src/lib/bitacoraTecnicaCalderas.ts` y `bitacoraTecnicaPTAR.ts`: extensión del envío existente, comprobación de identidad/revisión y vaciado de opcionales.
- Formularios existentes y `GuardadoReporteTecnico.tsx`: Editar reporte, Guardar corrección, estados y solo lectura, sin rediseño.
- `src/components/administracion/PendientesTecnicos.tsx` y `GestionRegistrosAdministracion.tsx`: consulta/compleción y revisión existentes.
- `tests/correccionesOperativas.test.mjs`: nuevas regresiones de servicio, permisos y límites.

Si la RPC de contexto todavía no existe (PGRST202), el frontend conserva el guardado anterior y no habilita correcciones operativas. No se simula que la migración ya esté aplicada. Ante un error de consulta de horario, la edición falla de forma cerrada hasta revalidar. La aplicación del SQL es necesaria para activar las reglas nuevas.

## Comprobación y límites de lo verificado

- TypeScript mediante `npm.cmd run build`, lint con `npm.cmd run lint` y `node --test tests/*.test.mjs`.
- SQL completo nuevo probado en PGlite/PostgreSQL aislado, sin conexiones remotas: envío completo/incompleto, protección de RPC anterior, autor y roles, corrección/reintento, conflicto de revisión, ausencia de cambios, escritura directa rechazada, cierre manual anticipado, cierre lógico con/sin reporte, compleción y corrección por Administración, auditoría, fecha nocturna y límites exactos. Consulta de 27 pendientes en dos páginas sin duplicados.
- Se cargaron las migraciones de esquema aplicables y los normalizadores/escritores/triggers técnicos reales. Se omitió la publicación Realtime y la parte de autopruebas/ACL defectuosa de la migración antigua 034, conservando sus objetos de esquema necesarios. La función anterior de identificación por empleado no tiene definición en los archivos del repositorio: para la prueba de inicio se usó un sustituto local de consulta de operadores activos. Esto no acredita esa función remota ni altera su definición.
- Navegador con backend simulado a 1400/390 px, ambos formularios reales: reapertura tras cierre manual y recarga, Editar reporte, corrección, misma solicitud tras pérdida de respuesta, bloqueo y solo lectura, rechazo de compleción administrativa vacía y compleción completa. Sin solicitudes externas ni errores JavaScript.
- PGlite serializa sus consultas: se comprobaron conflictos y reintentos, pero no se afirma una prueba de concurrencia entre conexiones de PostgreSQL remoto. Los bloqueos/UNIQUE/revisión esperada protegen ese escenario; requiere comprobación en un entorno autorizado antes de producción.
- Build mantiene el aviso previo de tamaño del generador Word; no se modificó ese exportador en esta mejora.

Respaldo de archivos anteriores y evidencia local: `C:/Users/erick/Documents/Codex/2026-10-01/gu-a-paso-a-paso-chatgpt/work/correcciones-turno-20261106/`. Revertir comparando exclusivamente sus cambios, sin restaurar todo el repositorio ni sobrescribir trabajos anteriores.

## Antes de aplicar remotamente

Revisar el nuevo SQL contra las definiciones reales de los triggers, helpers, ACL y migraciones instaladas. El preflight exige parejas, normalizadores/escritores, comentarios de Pilas y velocidades de prensas. No reejecutar migraciones históricas para resolver dependencias a ciegas. Obtener autorización expresa para la aplicación remota y comprobar después las cuentas de cada perfil y los horarios. El cierre global automático de otras capturas y el autoguardado parcial no forman parte de esta implementación.

