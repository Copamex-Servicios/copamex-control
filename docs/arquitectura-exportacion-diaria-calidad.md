# Exportación diaria completa de Calidad de agua

Estado: exportación diaria PDF y Excel implementada con la fotografía F-TA-03 proporcionada. Los botones están habilitados en Calidad y Administración, con fecha operativa y área independientes de los filtros de consulta. El Excel individual existente no cambia.

## Alcance del futuro acceso

La opción **Exportar día completo** utiliza `SolicitudDiaCompletoCalidad` en `src/lib/reporteDiarioCalidad.ts`:

- `alcance: 'dia-completo'`.
- `fechaOperativa`: fecha operativa elegida.
- `area`: exactamente Calderas o PTAR.

Este acceso será independiente de las casillas, filtros de turno, página y muestras cargadas en pantalla. Para ambas áreas se prepararán dos modelos separados; nunca se mezclarán sus mediciones.

Ejemplo: dos muestras de Día, una de Tarde y cuatro de Noche producen siete muestras independientes. No hay promedios ni sustitución de resultados.

## Modelo común para los futuros formatos

`DiaCompletoCalidad` contiene la solicitud, total de muestras y tres bloques ordenados: `dia`, `tarde`, `noche`. Los bloques sin muestras contienen un arreglo vacío; no se fabrican resultados.

Cada bloque conserva los `RegistroCalidad` completos. Incluyen identificadores de muestra y turno real, operadores, área, fecha operativa, notas, horarios guardados y todos los resultados recibidos: puntos, parámetros, valores, unidades, límites mínimos/máximos aplicados y evaluación histórica. No se consultan límites actuales ni se recalculan o agregan mediciones.

La agrupación utiliza `turno.fecha_operativa` y `turno.turno`, conservando `turno_id` en cada registro. Nunca se deduce el turno o la fecha operativa a partir de la fecha del reloj. Dentro de cada turno se ordena por `capturado_en` y, como desempate, UUID. Noche puede incluir registros del siguiente día calendario.

En la presentación se utilizará **Hora de registro** para `capturado_en`. `hora_muestra` y `recibido_en` se conservan como datos existentes; no se afirma que representen una hora real de toma registrada posteriormente.

## Recuperación independiente de la pantalla

`consultarDiaCompletoCalidad(solicitud, signal)` ejecuta solamente SELECT sobre `muestras_calidad`, con la relación existente a `turnos_operativos`. Filtra fecha operativa y área en el servidor y excluye muestras eliminadas.

Usa la selección y el lector estricto existentes de `calidad.ts`, sin modificar guardado, reintentos ni validaciones. Consulta lotes propios de 200 muestras con resultados relacionados, hasta alcanzar el total exacto. No hay límite global de 20, 200 ni de cantidad de páginas, ni una consulta independiente por resultado.

Comprueba conteos, cantidad recibida por página, UUID repetidos, relación de turno, fecha y área. Vuelve a comprobar el conteo al finalizar. Ante error, cancelación, cambio de cuenta, truncamiento o cambios de total, rechaza toda la preparación; no entrega un reporte parcial como completo.

La sesión autenticada y RLS actuales siguen determinando los datos accesibles. No se usa service role ni se amplían permisos. El total representa las muestras visibles para esa sesión, no registros a los que carece de acceso.

Limitación: varias consultas REST no constituyen una instantánea transaccional. Los controles detectan truncamientos, repetidos y cambios de cantidad, pero no garantizan detectar ediciones concurrentes que conserven el mismo total. Una instantánea atómica requeriría evaluar cambios de servidor por separado y con autorización. Consulta real contra Supabase: no verificada; pruebas realizadas con datos simulados.

## Implementación de los formatos

- `matrizCalidadDiaria.ts`: transformación compartida; puntos y parámetros reales en columnas, muestras cronológicas en filas. Orden de puntos basado en la fotografía. Otros puntos y parámetros guardados se conservan después de los conocidos.
- Límites históricos y unidades en encabezados. Si un parámetro tiene distintos límites durante el día, se crean columnas diferenciadas; no se sustituye un valor por un promedio o un límite actual. No se copian los números de la hoja impresa como configuración.
- `pdfCalidadDiaria.ts`: A4 horizontal, encabezados repetidos, comentarios y operadores por turno; filas y páginas adicionales según las muestras. Referencia F-TA-03.
- `xlsxCalidadDiaria.ts`: libro editable con encabezados agrupados, valores numéricos, comentarios y operadores. Configuración A4 horizontal, ancho de una página y altura variable, encabezados repetidos al imprimir y sin filas congeladas. Números con más de 15 cifras significativas se conservan como texto para evitar el redondeo de Excel.
- Bloques de hasta 12 columnas de mediciones para conservar legibilidad: si hay más, el PDF continúa en páginas y Excel en hojas adicionales. No se limita el total de muestras ni se descartan columnas.
- Turnos sin registros: **Sin muestras**. Una celda vacía significa que no existe un resultado para esa columna; nunca se rellena con cero.
- `exportarDiaCalidad.ts`: coordinación de consulta completa, transformación y generador seleccionado; comprobación de cuenta antes y después de operaciones asíncronas. PDF se carga bajo demanda; no hay nuevas dependencias ni consultas duplicadas por interfaz.
- `ExportacionDiaCalidad.tsx`: control compartido de fecha, área, PDF y Excel; aborta al desmontarse y bloquea descargas simultáneas. Todos los turnos se incluyen aunque la consulta de pantalla esté filtrada.
- Restricción acordada: solamente Calidad y Administración tienen botones y acceso al coordinador de exportación de la aplicación. El backend mantiene sus permisos actuales de consulta; no se afirma impedir copias externas de datos accesibles. No se añadió autorización de exportación en Supabase.

No introducir SQL, RLS, RPC, nuevos roles, promedios, equipos, valores o límites inventados.

## Pruebas

`node --test tests/reporteDiarioCalidad.test.mjs` verifica 2+1+4 muestras, 451 muestras con múltiples páginas, todos los resultados históricos, separación de áreas, cruce de medianoche, turnos vacíos, duplicados, respuestas incompletas, cambio de conteo, cuenta activa y cancelación. El cliente simulado solo admite SELECT; no se conecta a una base real.

Pruebas de formatos: `node --test tests/formatosCalidadDiaria.test.mjs`. Cubren matriz 2+1+4, más de 20 muestras, cero numérico, valores y límites históricos, columnas adicionales, turnos vacíos, comentarios extensos, PDF multipágina y restricción de roles de la aplicación. Navegador aislado a 1400 y 390 px para los cuatro roles; descargas reales con datos simulados.
