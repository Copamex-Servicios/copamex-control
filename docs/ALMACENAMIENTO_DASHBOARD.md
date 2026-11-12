# Almacenamiento del dashboard

La tarjeta de Administración consulta el tamaño real de la base PostgreSQL mediante
`public.consultar_almacenamiento_dashboard()`. Solo permite la consulta a cuentas
administrativas activas, según `private.es_admin()`. No requiere claves privadas en el navegador.

Para habilitarla, aplicar por separado en Supabase la migración local
`supabase/migrations/20261109000100_almacenamiento_dashboard.sql`.
No ha sido ejecutada remotamente por este cambio.

El límite de referencia es 500 MB, según la capacidad mostrada por el proyecto.
Se puede cambiar con `VITE_DATABASE_LIMIT_MB` en el entorno de build y volver a publicar.
Este límite no se consulta al proveedor; debe ajustarse cuando cambie el plan.
MB se presenta como 1,000,000 bytes.

Se consulta al cargar el dashboard y al usar su botón Actualizar, con espera máxima
de 10 segundos, sin consultas periódicas. Si la RPC no está instalada o falla,
la tarjeta indica «Consumo no disponible» y no muestra un porcentaje ficticio.

La medición corresponde al tamaño de la base de datos, no al almacenamiento de
archivos, tráfico, usuarios, logs ni todo el disco provisionado. Puede diferir del
panel de Supabase por el momento de actualización de sus métricas.
Referencia: https://supabase.com/docs/guides/platform/database-size
