# Bitácora administrativa

Implementación local del 5 de noviembre de 2026. **Migración remota pendiente de autorización.** No se ejecutó SQL remoto, no se instalaron dependencias y no se modificaron permisos de otros módulos.

## Integración

- Perfil Administración → **Bitácora en la barra superior, inmediatamente después de Inicio**, ruta `/bitacora-administrativa`: crear y corregir actividades, consultar por mes/año y área; paginación de 25 registros mediante cursor `(creado_en,id)` descendente, sin límite total de páginas. Ya no está anidada como pestaña dentro de Administración.
- Barra superior de Calderas, PTAR y Calidad: **Novedades**, última opción de navegación, ruta protegida `/novedades`. Abre el historial con mes/año y área; permite alternar a cinco actividades recientes. Solo lectura de Calderas y PTAR, sin crear, editar o eliminar. No hay sección ni tarjeta duplicada en Inicio, ni se creó un menú lateral. La captura administrativa conserva su funcionamiento y permisos.
- La pestaña administrativa conserva el formulario al navegar. Los cambios de cuenta desmontan las vistas desde el contenedor existente.
- Inter, colores y controles existentes de COPAMEX. Exportación mensual a Word disponible únicamente para Administración.

## Archivos

- `src/components/administracion/PanelAdministracion.tsx`: retirada la pestaña interna; permanecen Dashboard, Catálogos y avisos, y Capturas.
- `src/App.tsx` y `src/pages/Inicio.tsx`: rutas y accesos de Bitácora administrativa (tras Inicio, solo Admin) y Novedades (al final, perfiles operativos).
- `src/components/diseno/Topbar.tsx`: conserva los accesos del área al visitar Novedades y cierra el menú móvil al elegirla.
- `src/components/diseno/InicioDashboard.tsx`: Inicio sin sección ni tarjeta de novedades.
- `src/components/bitacoraAdministrativa/BitacoraAdministrativa.tsx`: formulario, corrección, estados, filtros y consulta compartida.
- `src/components/bitacoraAdministrativa/bitacoraAdministrativa.css`: estilos limitados al nuevo módulo; ajuste de cuatro pestañas a dos columnas en celular.
- `src/lib/bitacoraAdministrativa.ts`: tipos, validación, consultas, cursor, caché por cuenta, confirmación, reintentos y preparación mensual.
- `supabase/migrations/20261105000100_bitacora_administrativa.sql`: tabla, índices, RLS, auditoría y RPC nuevas.
- `tests/bitacoraAdministrativa.test.mjs`: pruebas sin servicios remotos.

Respaldo anterior a la modificación de los dos archivos existentes: `C:/Users/erick/Documents/Codex/2026-10-01/gu-a-paso-a-paso-chatgpt/work/bitacora-administrativa-20261105/respaldo/`. Para revertir, comparar esos dos archivos y retirar solo las incorporaciones de esta mejora; no restaurar todo el repositorio ni borrar cambios posteriores.

## Base de datos y seguridad

Requiere las migraciones existentes, en particular `private.rol_actual()`, `private.es_admin()`, `public.auditoria` y `private.registrar_auditoria()`.

La nueva tabla `public.bitacora_administrativa` contiene ID, área (`ptar`, `calderas`, `obra_civil`), actividad, fecha de México asignada al crear, instantes de creación/modificación, cuentas responsables y revisión entera. La corrección conserva fecha, autor e instante originales. Cada INSERT/UPDATE/DELETE del nuevo registro utiliza el trigger de auditoría existente para conservar antes/después y usuario; no se alteró ese mecanismo compartido.

RLS concede lectura completa de las tres áreas a Administración y solo PTAR/Calderas a cuentas activas de los otros tres roles. Las identidades de auditoría no tienen privilegio de SELECT para `authenticated`: la consulta pública devuelve únicamente los campos de presentación y revisión. `auditoria` conserva sus políticas existentes, exclusivas de Administración.

No se conceden INSERT, UPDATE, DELETE o TRUNCATE directos a cuentas de aplicación. La RPC `guardar_bitacora_administrativa` es SECURITY DEFINER con `search_path` vacío, verifica `auth.uid()` y administrador activo, valida parámetros, asigna metadatos del servidor y controla la revisión esperada. Los lectores usan `consultar_bitacora_administrativa`, SECURITY INVOKER, sometida a RLS y privilegios de columnas. No se usa `service_role` en frontend.

## Confirmación y reintentos

La creación genera IDs diferentes para registro y solicitud. La solicitud queda inmovilizada antes de enviarla, en memoria y `sessionStorage` de la cuenta, para recuperarla al recargar la pestaña. No almacena credenciales. Al cambiar de cuenta/rol o cerrar sesión se descartan los pendientes de la cuenta anterior. Los registros confirmados y la auditoría permanecen en PostgreSQL.

`private.bitacora_administrativa_solicitudes` guarda cuenta, parámetros y respuesta de cada operación confirmada, sin privilegios de lectura para la aplicación. El bloqueo transaccional por solicitud y la clave primaria impiden duplicados concurrentes: repetir el UUID con los mismos datos devuelve la misma respuesta; reutilizarlo con otros datos se rechaza. La escritura, auditoría y confirmación son atómicas. El formulario bloquea el doble clic y los cambios en solicitudes inciertas. Un conflicto de revisión no sobrescribe la corrección de otro administrador.

No existe eliminación en la interfaz. No se programó limpieza de solicitudes, para mantener la idempotencia de reintentos antiguos. Una futura política de retención requerirá definir explícitamente este comportamiento.

## Consultas y exportación mensual a Word

El mes predeterminado procede del servidor, en `America/Mexico_City`. La fecha original se conserva al corregir. Los cursores preservan los microsegundos de PostgreSQL; no se convierten a milisegundos al enviarlos.

`recuperarMesAdministrativo(mes, area, signal)` exige Administración, recorre todas las páginas sin depender de la pantalla ni del caché, comprueba IDs y versión del conjunto, y devuelve `{mes, areas: [{area,nombre,actividades}]}` con actividades ascendentes dentro de cada área. Si el conjunto cambia entre páginas, rechaza el resultado en lugar de presentar un mes completo inconsistente. La recuperación de datos permanece separada de la generación del archivo.

Las consultas se cachean dos minutos por identidad y filtros usando el mecanismo existente. Actualizar fuerza consulta; un guardado confirmado invalida la versión de caché y notifica a las consultas montadas. No se incorporó una suscripción Realtime nueva: los cambios de otras cuentas se obtienen al actualizar o caducar la caché.

## Verificación

- `npm.cmd run lint`
- `npm.cmd run build` (incluye `tsc -b`)
- `node --test tests/*.test.mjs`
- Pruebas nuevas: campos, áreas, meses inválidos, varios registros el mismo día, permisos de interfaces/servicio, sesión inactiva/cambio de cuenta, doble envío, recuperación de pendiente, reintento con el mismo UUID, conflicto de corrección, 58 registros y tres páginas, cambio diciembre/enero y rechazo de páginas incompletas/conjuntos modificados.
- SQL probado en PostgreSQL 18.6 aislado en memoria mediante PGlite ya disponible como herramienta de trabajo: migración completa con los helpers y auditoría originales, RLS por rol, Obra Civil privada, metadatos no públicos, escritura/anulación directa bloqueadas, idempotencia, auditoría, corrección optimista y paginación de 28 filas. No sustituye la comprobación del esquema de producción antes de una futura aplicación autorizada.
- Navegador con backend simulado y sin solicitudes externas: cuatro perfiles, 1400/390 px, navegación, consulta mensual, filtros, cambio de año, paginación, creación, confirmación perdida y corrección. Capturas y scripts están en el directorio de trabajo de esta mejora (`qa.cjs`, `verificar-sql.cjs`, `output/`).
- Detector de Impeccable sobre la nueva superficie: sin hallazgos mecánicos.

No se aplicó esta migración a Supabase. Hasta aplicarla con autorización, la nueva consulta informa que requiere la migración y no simula datos ni confirmaciones. Antes de habilitarla en producción: revisar el archivo contra el esquema remoto real y, tras autorización, aplicar una vez y comprobar los cuatro perfiles con cuentas de prueba autorizadas.

## Word mensual (6 de noviembre de 2026)

El botón **Word**, junto a Actualizar en el historial administrativo, descarga el mes y área seleccionados. Todas incluye PTAR, Calderas y Obra Civil, separadas y ordenadas por fecha ascendente. Recupera todas las páginas; no exporta únicamente los registros visibles. No cambia consultas SQL, permisos, auditoría ni guardado.

El documento `.docx` es editable: logo COPAMEX, título, mes, secciones por área y actividades con viñetas: «El día 02, actividad registrada». Conserva textos completos y saltos de línea; no muestra horas ni cuentas. Las áreas vacías indican Sin actividades. Usa tamaño carta, numeración de páginas y Arial de 11 puntos como en el documento de referencia. El mes y año aparecen arriba; las entradas muestran solo el día, sin fecha completa ni hora.

Archivos añadidos: `src/lib/paqueteOffice.ts` (contenedor ZIP), `src/lib/docxBitacoraAdministrativa.ts` (formato OOXML), `src/lib/exportarBitacoraAdministrativa.ts` (orquestación y descarga), `tests/wordBitacoraAdministrativa.test.mjs`. Integración limitada al componente y CSS del módulo. Sin nuevas dependencias ni cambios en exportadores generales. Comprueba administrador activo y cambio de identidad antes de descargar; bloquea doble clic y cancela al desmontar.

Verificación: lint, TypeScript/build y 96 pruebas aprobadas. Pruebas de descarga con backend simulado en 1400 y 390 px: 65 actividades exportadas frente a 25 visibles, tres áreas, sin solicitudes externas y sin botones para los otros roles. Validación mediante Open XML SDK sin errores para documento de ejemplo y documento de 38 registros con texto extenso. La revisión inicial no pudo abrir Word; en la adaptación posterior al formato adjunto se completó la apertura y repaginación en Word, exportación PDF local e inspección de todas las páginas de ejemplo.

Respaldo de los archivos existentes previo a la exportación: `work/word-bitacora-20261105/respaldo/` en el espacio de trabajo de Codex. Scripts y muestras ficticias de validación en ese mismo directorio. No se aplicó SQL remoto, no se hicieron commits, push ni despliegues.
### Formato con viñetas de la hoja original

Referencia revisada: `formato de relevantes.doc`, facilitada por el usuario. Se convirtió una copia a DOCX para lectura y se inspeccionaron sus dos páginas. La adaptación inicial afectó solo las entradas; quedó sustituida por la reproducción completa de la plantilla descrita a continuación. Varias actividades históricas del mismo día permanecen como registros independientes. Los saltos de línea siguen dentro de una sola viñeta por registro.

Archivos afectados: `src/lib/docxBitacoraAdministrativa.ts`, pruebas Word y esta documentación. Se añaden las partes OOXML de numeración y compatibilidad de saltos manuales. Arial sustituye a Inter en el documento Word para coincidir con la referencia y evitar sustituciones de fuente en equipos sin Inter; la tipografía de la aplicación no cambia.

Verificación posterior: 102 pruebas, lint, TypeScript/build, esquema OOXML sin errores y revisión visual de un documento corto y uno de cuatro páginas en Microsoft Word. Copia de referencia intacta, respaldos, scripts y muestras ficticias en `work/formato-relevantes-20261106/` del espacio de trabajo de Codex. Sin cambios SQL ni dependencias nuevas.

### Encabezado original y presentación del texto

La revisión final del 6 de noviembre utiliza `src/assets/plantillas/relevantes.json`, extraído del DOCX convertido de la referencia, y su logo original `logo-relevantes.png`. Conserva el título RELEVANTES SERVICIOS-ENERGETICOS, logo a la derecha, franja gris, mes centrado, doble línea azul, subtítulo subrayado, encabezado COINSA Mes-Año y pies de página. Conserva los estilos, márgenes y espacios originales, con encabezados PTAR, Calderas y compresores y Obra Civil. El mes y año proceden del mes seleccionado. El original y la copia de referencia no se modifican; no se exportan Lorem ipsum ni cuentas administrativas.

`docxBitacoraAdministrativa.ts` rellena únicamente los espacios de mes, encabezado y actividades de la plantilla. `formatoTextoBitacora.ts` ajusta la caja exclusivamente en el Word: minúscula tras «El día DD, » y mayúscula después de fin de oración. Mantiene números, decimales, saltos y puntuación, y protege las siglas, unidades, códigos de equipo y nombres operativos catalogados (por ejemplo PTAR, DAF, B-13, Sulzer, Essity y m/min). No cambia la actividad guardada, no corrige ortografía ni reconoce automáticamente nombres propios desconocidos: ampliar el catálogo cuando se necesite preservar otro nombre. Las consultas, validaciones, guardado y exportadores de otros módulos permanecen sin cambios.

La plantilla conserva sus 19 partes OOXML. Se retiraron atributos de configuración incompatibles del conversor de Word y la caché redundante `o:gfxdata` de una línea; se conservaron las propiedades visibles de esa línea. Se normalizan autor/último editor de la plantilla a COPAMEX y se añade la compatibilidad de saltos manuales para evitar que se estire la última línea de una actividad. La plantilla completa se carga con el generador diferido: build advierte de un fragmento de aproximadamente 1,1 MB (96 KB gzip), sin impedir la compilación; no se carga al abrir las otras vistas.

Verificación final: TypeScript/build, lint y 110 pruebas aprobadas; esquema Open XML SDK sin errores para muestras corta y extensa; apertura y revisión visual de todas las páginas mediante Word (una y tres páginas). La conversión PDF de trabajo mostró inconsistencias en su rasterizado, por lo que también se inspeccionaron las imágenes nativas de las páginas de Word. Descarga con backend simulado en 1400/390 px: 65 actividades frente a 25 visibles, tres áreas y autorización de interfaz/servicio existente, sin solicitudes externas. Respaldos y evidencia en `work/relevantes-fiel-20261106/` del espacio de trabajo de Codex. No se ejecutó SQL remoto ni se añadieron dependencias.

## Un registro diario por área (6 de noviembre de 2026)

Nueva regla: una creación por fecha del servidor en México y área (PTAR, Calderas, Obra Civil), compartida por todas las cuentas administrativas. Para agregar o modificar contenido del día se utiliza Corregir en el historial. La fecha original de la actividad se conserva. Los duplicados anteriores se mantienen y pueden corregirse; no se fusionan ni borran para ocultarlos en Word.

Migración local pendiente: `supabase/migrations/20261106000300_bitacora_administrativa_diaria.sql`. No aplicar otra vez la migración de creación original. La nueva migración bloquea temporalmente escrituras de la tabla al preparar un control privado de ocupación `(area,fecha)`, inicializado con los recuentos existentes. El trigger mantiene el control de manera atómica mediante PK y ON CONFLICT, impidiendo nuevas duplicaciones aunque distintas solicitudes compitan. La corrección en la misma fecha/área no ocupa otro lugar; mover a un área ya ocupada se rechaza, y mover a una libre actualiza ambos recuentos. Eliminar mediante mantenimiento autorizado también actualiza el control; la aplicación sigue sin ofrecer eliminación.

El control privado tiene RLS sin políticas de cliente y privilegios revocados. Solo su trigger SECURITY DEFINER, propiedad de postgres y con search_path vacío, accede al control. No se cambian los permisos, las RPC ni la auditoría de otros módulos ni los textos/fechas existentes. Un fallo revierte también la reserva; los UUID de solicitudes y las confirmaciones idempotentes existentes se conservan.

El formulario consulta la disponibilidad del área mediante la consulta existente de recientes, con la fecha de la respuesta del servidor en America/Mexico_City. Es una comprobación de existencia, no un historial completo. Si ya hay registro, se deshabilitan nueva descripción/Guardar y se indica utilizar Corregir; el selector permite ir a otra área. Se actualiza tras guardar, al enfocar la ventana y cada minuto mientras está visible para reflejar cambio de día. Si otro administrador gana la captura o falla la consulta informativa, el servidor sigue aplicando la regla al guardar. El rechazo definitivo limpia la solicitud pendiente y conserva el texto que estaba escribiéndose. Una solicitud con confirmación incierta mantiene su reintento original aunque el registro ya exista.

Archivos de esta mejora: componente y servicio de Bitácora administrativa, pruebas `bitacoraAdministrativa.test.mjs`, migración diaria y este documento. Respaldos, prueba SQL aislada y prueba de navegador en `work/bitacora-diaria-20261106/` del espacio de trabajo de Codex.

Validación local: conservación de duplicados previos, una captura por cada área, nuevas fechas y cambio de año, corrección, traslado a área ocupada/libre, reintentos, control privado, roles y auditoría en PostgreSQL PGlite. Las solicitudes competidoras se ejecutaron serializadas por el motor local; no se probó concurrencia entre conexiones de un PostgreSQL remoto. Navegador con backend simulado a 1400/390 px: bloqueo, cambio de área, corrección, confirmación perdida, reintento y día siguiente, sin solicitudes externas. La migración queda pendiente de revisión contra el esquema real y aplicación autorizada; no se ejecutó SQL remoto.
