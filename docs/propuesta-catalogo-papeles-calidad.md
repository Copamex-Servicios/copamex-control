# Catálogo de papeles: alta desde Calidad

Estado: migración local no aplicada en Supabase. Integración React preparada por autorización del usuario, con pruebas simuladas; ninguna llamada de prueba a Supabase real.

## Cambio preparado

Migración nueva: `supabase/migrations/20261019000200_catalogo_papeles_calidad.sql`.

Agrega únicamente `public.obtener_o_crear_papel_calidad(p_maquina uuid, p_nombre text)`, con retorno `public.catalogo_papeles`. La función comprueba sesión y rol activo `calidad` en el servidor antes de delegar en `public.obtener_o_crear_papel(uuid,text)`, cuya definición remota compartida es la referencia de esta propuesta.

La RPC original normaliza mayúsculas y espacios, valida nombre de 1 a 200 caracteres y máquina activa, reutiliza el papel existente y rechaza el papel inactivo sin reactivarlo. Su bloqueo transaccional serializa las llamadas para la misma máquina y nombre normalizado. El catálogo continúa separado por máquina.

La nueva función usa `SECURITY DEFINER`, propietario `postgres`, `search_path` vacío y referencias calificadas. Se revoca EXECUTE de PUBLIC y anon; authenticated puede invocarla, pero la comprobación interna rechaza Administración, Calderas, PTAR y perfiles inactivos. No requiere service_role en el cliente.

No modifica la RPC original, tablas, políticas RLS, permisos de tablas, registros ni triggers. Los INSERT siguen el camino existente y sus triggers de auditoría. No inserta ni modifica `programa_produccion`.

## Alcance de la restricción

La exclusividad corresponde a esta nueva operación de Calidad. Administración conserva sus accesos anteriores a la tabla y a la RPC original; no se revocan permisos de otros perfiles. No equivale a prohibir globalmente a Administración gestionar el catálogo.

El índice actual sigue siendo único por `(maquina_id, nombre)` exacto. La prevención de variantes normalizadas y concurrencia se reutiliza de la RPC, no se agrega un índice global ni se corrigen duplicados históricos. Las escrituras administrativas directas conservan su comportamiento anterior.

## Verificación pendiente en desarrollo

Solo después de autorizar y aplicar la migración en desarrollo, comprobar con sesiones reales:

| Caso | Resultado esperado |
| --- | --- |
| Calidad activa, máquina activa y nombre nuevo | Devuelve papel persistido; ningún programa creado. |
| Mismo nombre con otras mayúsculas, espacios exteriores o espacios internos repetidos | Devuelve el mismo ID, sin INSERT adicional. |
| Dos sesiones de Calidad guardan simultáneamente variantes del mismo nombre | Ambas reciben el mismo ID; una sola alta. |
| Nombre vacío, solo espacios, mayor de 200 caracteres o máquina inactiva | Error `22023`; sin altas. |
| Papel existente inactivo | Error `22023`; no lo modifica ni reactiva. |
| Administración, Calderas, PTAR o perfil inactivo llaman directamente a la nueva RPC | Error `42501`; sin altas. |
| Sin sesión / anon | Operación rechazada. |
| Alta real con Calidad | Auditoría de INSERT atribuida a su auth.uid(); no cambia auditoría histórica. |
| Recarga o nueva sesión de Calidad en otro dispositivo | El papel sigue disponible en la consulta del catálogo de su máquina. |
| Operaciones previas de Administración | Conservan accesos y funcionamiento. |

Usar una base de desarrollo con datos de prueba y sesiones autenticadas de cada rol; no simular resultados como si fueran pruebas remotas. Comparar las filas de producción antes y después de agregar solamente un papel.

## Integración React preparada

En Producción de Calidad, el selector muestra `+ AGREGAR OTRO...`, nombre, Guardar y Cancelar. La acción separada está conectada exclusivamente con la RPC propuesta y selecciona el ID confirmado. Un duplicado activo consultado se selecciona sin invocar la RPC. Si esta aún no existe, se informa el error y se conserva el nombre; no hay INSERT directo, fallback a la RPC original ni confirmación simulada. Guardar la programación con un papel existente no necesita esta nueva RPC. Administración conserva su comportamiento anterior.

La consulta recorre todas las páginas del catálogo, se actualiza al volver a la ventana y respeta la relación papel/máquina. Se verificaron con dobles de Supabase la normalización, duplicados, fallos, comprobaciones de sesión y paginación; además, el flujo de formulario en navegador a 1280 y 390 píxeles. No constituyen pruebas reales de RLS, concurrencia o persistencia entre dispositivos.

La aplicación remota y las pruebas reales de permisos, concurrencia y persistencia quedan pendientes de autorización. No se ejecutó SQL ni se modificó Supabase.
