# SST en Calidad de agua

Aplicar manualmente la migración local 20261112000100_sst_m2_m4_calidad.sql antes de publicar el frontend. No reejecutarla. No se aplicó remotamente desde Codex.

El formulario obtiene del catálogo las áreas de captura, IDs de puntos permitidos y evaluación de límites. SST aparece junto a Color en las tarjetas existentes de Pila M-2 y Pila M-4, si el punto está activo y habilitado para el área de la cuenta. No se exige completar otros resultados para guardar; se conserva la validación numérica existente.

SST no tiene umbral mínimo o máximo de norma. El servidor fuerza ambos límites aplicados a NULL, incluso si existen límites SST configurados; la columna generada fuera_norma resulta NULL. El formulario no muestra explicaciones de evaluación para resultados sin límites; la consulta y las exportaciones de Calidad presentan “—”. Esto no elimina la validación de números válidos ni cambia las muestras históricas.

No se asignó una unidad nueva porque no fue confirmada. Si ya había SST, se reutiliza su parámetro y unidad. Si no existía, se crea con unidad NULL.

## Extensión por configuración

- areas_captura: áreas habilitadas (calderas, ptar).
- puntos_permitidos: IDs de puntos; NULL habilita todos los puntos compatibles del área.
- evaluar_limites: true aplica límites versionados; false registra la medición sin evaluación.

Las reglas se administran en la base con permisos administrativos existentes. No se agregó una pantalla de edición de estas reglas. Los parámetros nuevos tienen por defecto el comportamiento anterior para PTAR; para habilitar otras combinaciones se configuran estas columnas. Los IDs permitidos deben corresponder a puntos existentes.

El trigger de INSERT valida las mismas reglas de área/punto del formulario. Las correcciones conservan los límites originales mediante la protección ya instalada.

Color y Turbidez mantienen su alcance anterior. Esta ampliación no implementa el seguimiento de lecturas adicionales de color M4 ni su vinculación con Avisos.
