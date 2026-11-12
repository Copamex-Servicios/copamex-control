# Reportes relevantes por operador

Aplicar `supabase/migrations/20261111000200_reportes_por_operador.sql` después de
`20261111000100_compresores_sulzer_calderas.sql` y antes de publicar la web.
No se han ejecutado remotamente por el agente.

Calderas y PTAR muestran dos cuadros verticales con los nombres del operador
principal y acompañante. Ambos comentarios son obligatorios; comparten el límite
actual de 4,000 caracteres, incluyendo los encabezados. Se capturan con la cuenta
del área: los cuadros identifican la participación y no son firmas de autenticación
individual ni sesiones independientes para cada operador.

El servidor obtiene los nombres e identificadores del turno, no del navegador.
Los guarda junto a los comentarios en reportes_operadores y conserva un resumen
en reporte_relevante para compatibilidad con los controles de envío existentes.
Los históricos y reintentos anteriores que omiten reportesOperadores mantienen
su representación. No se atribuye un reporte histórico a uno de los operadores.

La asignación se hace mediante trigger en la misma escritura de la cabecera,
siguiendo el patrón existente de velocidades de prensas: no añade una segunda
revisión ni una escritura posterior a la auditoría. Los roles y RLS se conservan.
Los detalles y las exportaciones muestran los nombres con sus comentarios.

Se retira de la web el cierre manual de turno y su confirmación. La RPC existente
no cambia para conservar compatibilidad y reintentos previos; el cierre automático
requiere la migración 20261110000100_cierre_automatico_turnos ya instalada.

Para un turno de prueba cerrado por error, primero ejecutar la consulta de solo
lectura docs/revisar_turno_prueba.sql y confirmar el ID y las capturas asociadas.
Esta mejora no elimina ni anula turnos existentes automáticamente.
