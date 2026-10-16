# COPAMEX — Instrucciones de trabajo

## Alcance y eficiencia
- Lee y modifica solo los archivos relevantes para la tarea; usa búsquedas dirigidas con `rg`.
- Reutiliza el contexto y los hallazgos comprobados. Evita releer archivos, repetir análisis o ejecutar comprobaciones sin una razón nueva.
- Realiza cambios mínimos y reutiliza componentes existentes. Evita refactorizaciones, dependencias y mejoras ajenas a lo solicitado.
- Pregunta solo cuando falte información que impida avanzar con seguridad; resuelve las decisiones rutinarias con el contexto disponible.

## Seguridad y funcionamiento
- Conserva los cambios existentes del usuario. No borres datos ni expongas credenciales.
- Mantén permisos, validaciones y lógica de guardado; respeta la separación entre administrador y operadores.
- No modifiques SQL, Supabase, políticas RLS ni funciones RPC sin autorización explícita para la tarea.
- Verifica el comportamiento afectado y las regresiones relevantes. Distingue las pruebas con datos simulados de las realizadas contra servicios reales.

## Verificaciones
- Para cambios en React o TypeScript, ejecuta TypeScript (`tsc -b`), lint y build mediante los comandos del proyecto; en PowerShell usa `npm.cmd` cuando sea necesario.
- Ajusta las pruebas al riesgo y alcance del cambio. Para documentación solamente, revisa el contenido y el diff.
- No repitas verificaciones aprobadas salvo que haya cambios posteriores, fallos o dudas pendientes. Informa cualquier comprobación que no puedas completar.

## Entrega
- Responde brevemente en español: resultado, archivos modificados, verificaciones y limitaciones relevantes. Evita repetir el proceso o el contexto.
- No hagas commits, push ni despliegues sin autorización explícita.
