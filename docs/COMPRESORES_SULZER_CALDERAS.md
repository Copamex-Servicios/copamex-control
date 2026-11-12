# Compresores y bombas Sulzer

Aplicar en Supabase la migración local
`supabase/migrations/20261111000100_compresores_sulzer_calderas.sql`
antes de publicar el formulario nuevo. No ha sido ejecutada remotamente.
Depende de las funciones de reporte relevante y la migración de comentarios de Pilas.

Se agrega un comentario general opcional para Compresores (máximo 4,000 caracteres).
Una nueva captura o corrección del formato actual guarda NA si se deja vacío.
El dato se muestra en el detalle y en los consolidados y exportaciones técnicas.
Los históricos sin comentario conservan NULL; no se rellenan retroactivamente.
Los formatos antiguos conservan sus restricciones y no editan el comentario nuevo.

En nuevas capturas y correcciones del formato actual, las Sulzer en Reserva o
Mantenimiento envían presión cero. El formulario bloquea el campo y al seleccionar
Servicio lo habilita vacío para capturar la presión. La normalización del backend
también fija cero para solicitudes nuevas que incluyen comentariosCompresores.
Las solicitudes antiguas que omiten esa clave conservan su normalización para no
invalidar reintentos ya enviados; los reportes históricos se leen sin transformar.

El orden visual es Sulzer 435, 469, 470 y 456. Se conserva el identificador histórico
sulzer_436 que representa a Sulzer 435: no se cambia la identidad del equipo.
No se modifican roles, políticas RLS, ACL ni la revisión única por corrección.
