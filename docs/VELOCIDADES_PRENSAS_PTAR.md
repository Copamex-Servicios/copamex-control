# Velocidades de prensas PTAR

Implementación local del 6 de noviembre de 2026. Migración remota pendiente; no se ejecutó SQL remoto ni se instalaron dependencias.

## Funcionamiento

En Prensas de fin de turno, cada prensa (Essity/Nalco) conserva su selector de estado y agrega debajo Velocidad, en m/min. Dos columnas en escritorio y una en celular, con los controles y fuente existentes. Los campos son opcionales: vacío indica sin registrar; cero explícito se conserva. No se deduce la velocidad del estado ni se impone un máximo operativo no confirmado. Se admiten decimales finitos no negativos.

Se conservan las velocidades en el borrador al cambiar pestaña, el guardado/reintento por UUID y las correcciones administrativas con revisión y motivo existentes. Lectura compartida en historial, Planta y Administración; exportación PDF/Excel por la matriz técnica compartida. Los históricos sin velocidades no muestran valores inventados ni se rellenan con cero. Los reportes antiguos sin reporte relevante mantienen su RPC original y no permiten editar las nuevas velocidades.

## Archivos

- `src/lib/tiposBitacoraPTAR.ts`: modelo, borrador y validación común.
- `src/lib/bitacoraTecnicaPTAR.ts`: preparación del envío y lectura de campos opcionales.
- `src/lib/revisionTecnica.ts`: corrección, incluido borrado explícito mediante NULL y conservación de precisión.
- `src/components/bitacora/FormularioBitacoraPTAR.tsx`, `bitacoraPTAR.css`: dos grupos estado/velocidad.
- `src/components/planta/DetalleReportePTARPlanta.tsx`, `src/lib/consolidadoTecnico.ts`: consulta y exportadores existentes.
- `tests/velocidadesPrensas.test.mjs`, `tests/consolidadoTecnico.test.mjs`: regresiones con datos simulados.
- `supabase/migrations/20261106000200_velocidades_prensas_ptar.sql`: migración local pendiente.

## Migración

Requiere la actualización de horas del DAF `20261030000200_horas_descarga_daf_ptar.sql`. Añade `velocidad_prensa_essity` y `velocidad_prensa_nalco` numeric nullable con restricciones de finitud y no negatividad. Actualiza los normalizadores/escritores internos existentes y asigna los campos mediante trigger en la misma escritura, siguiendo el patrón del DAF. Conserva firmas RPC, permisos, RLS, auditoría, revisión y horas de descarga.

La clave `velocidadesPrensas` ausente se mantiene ausente en el normalizador para no alterar solicitudes antiguas. Un cliente antiguo que omita el campo no borra velocidades ya registradas. Una corrección nueva puede enviarlo con NULL explícito para borrar ambas. No reescribe históricos ni transforma unidades.

Revisar el archivo frente al esquema real y aplicar con autorización antes de guardar velocidades. Sin la migración, los envíos sin velocidades conservan su contrato previo y el servidor anterior rechazará el nuevo campo si se llena.

## Verificación

- TypeScript/build y lint aprobados; 102 pruebas aprobadas.
- Formulario real, datos locales, navegador a 1400 y 390 px: estados independientes de velocidades, decimal/0 conservados al cambiar pestañas, dos columnas/una columna y sin errores JavaScript ni desbordamiento.
- PGlite aislado: migración completa con normalizadores/escritor históricos reales, tablas de prueba; decimal/cero/NULL, rechazo de negativos/no finitos/claves desconocidas, DAF conservado, contexto restaurado y solicitudes antiguas compatibles. Sin comprobar servicios remotos.
- Respaldos, scripts y capturas en `work/velocidades-prensas-20261106/` del espacio de trabajo de Codex. Sin commits, push ni despliegues.
