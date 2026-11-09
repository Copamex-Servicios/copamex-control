# Comentarios de Pilas de suministro

Preparado localmente el 6 de noviembre de 2026. No se ejecutó SQL remoto.

- Campo opcional, hasta 4,000 caracteres, bajo las mediciones de Pilas; reutiliza el estilo de comentarios de Ultrafiltración.
- Se conserva al cambiar pestaña y se muestra en historial, Planta, detalle administrativo y exportaciones técnicas PDF/Excel mediante los componentes y la matriz compartidos.
- Migración pendiente: `supabase/migrations/20261106000100_comentarios_pilas_calderas.sql`. Añade `comentarios_pilas` nullable y actualiza exclusivamente la normalización/escritura internas de las RPC v3 existentes. No cambia roles, RLS, firmas RPC ni el mecanismo de auditoría. No reescribe históricos.
- La clave ausente se conserva ausente al normalizar para mantener los reintentos anteriores. En correcciones nuevas, NULL explícito permite borrar el comentario; omitir la clave conserva el valor previo.
- Los formatos antiguos (formato 1 o sin reporte relevante), que utilizan otras RPC, conservan su edición original y tienen este nuevo campo deshabilitado para evitar pérdidas silenciosas.
- Aplicar la migración revisada antes de usar el campo con contenido. Antes de aplicarla, los envíos sin comentario conservan su estructura anterior; el servidor anterior rechazará el nuevo campo si se llena.

Verificación: 97 pruebas, TypeScript/build y lint; navegador con formulario real y datos locales a 1400/390 px; PGlite aislado con normalizadores originales y tablas de prueba para validar creación, corrección, borrado explícito, límite, tipo y compatibilidad de solicitudes anteriores. Esto no sustituye verificar el esquema remoto real antes de aplicar.

Respaldo y scripts: `work/comentarios-pilas-20261106/` en el espacio de trabajo de Codex. Sin dependencias nuevas, commits, push ni despliegues.
