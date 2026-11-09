# Propuesta: finalización de Avisos, Producción y Eventos y paros

Estado: implementación reciente cancelada y retirada localmente por solicitud del usuario. La migración pendiente y sus pruebas se retiraron sin ejecutar SQL en Supabase. Se conserva esta propuesta como antecedente; no representa funcionalidad desplegada ni autoriza su aplicación.

## Evidencia remota recibida

Los resultados compartidos confirman las tres tablas y sus columnas originales, sin marcas persistentes de finalización. `finalizar_aviso(uuid,jsonb)` existe: es SECURITY DEFINER, propiedad de postgres y ejecutable por authenticated; comprueba Administración/Calidad, bloquea la fila y compara el original. Actualmente puede cerrar avisos programados y devuelve los expirados sin distinguir un cierre manual. Debe conservarse su firma y corregirse ese comportamiento.

Las políticas desplegadas permiten INSERT y UPDATE tanto a Administración como a Calidad en las tres tablas. SELECT requiere una cuenta activa según `private.rol_actual()`. authenticated tiene SELECT, INSERT y UPDATE, sin DELETE en los permisos compartidos. No cambiar esos accesos.

En las tres tablas están instalados los triggers de protección de creación, identidad y auditoría. Se recibieron y revisaron los cuerpos remotos: los dos primeros son invoker; la auditoría es definer, utiliza auth.uid() y conserva antes/después, omitiendo UPDATE sin cambios. `private.rol_actual()` es definer y solo devuelve el rol de perfiles activos; `private.es_admin()` es invoker y reutiliza esa función. Todas tienen search_path vacío. No requieren modificaciones.

La comprobación previa quedó satisfecha con los resultados compartidos por el usuario. Los apartados siguientes conservan la propuesta original; las observaciones sobre ausencia local de permisos/RPC no describen el estado remoto ya confirmado. El cliente vuelve a utilizar el esquema existente y la RPC original de Avisos, sin las nuevas marcas de cierre.

## Evidencia actual

| Módulo | Modelo versionado | Finalización disponible en el cliente |
| --- | --- | --- |
| Avisos | `permanente`, `inicio`, `fin`; la vigencia determina si se muestra | `src/lib/finalizarAviso.ts` invoca `finalizar_aviso(p_id, p_original)`. El cliente espera `permanente=false` y `fin` pasado. No existe su definición ni la migración `20261005003800_finalizar_aviso.sql` mencionada por el cliente. |
| Producción | `activo` habilita la publicación del programa de una fecha | No existe una operación de finalización en los archivos revisados. Inactivo no equivale a finalizado. |
| Eventos y paros | Fecha, tipo, área, horario y motivo | No hay campo de estado ni operación de finalización en los archivos revisados. |

Fuentes: `20261001001500_tablas_administrativas.sql`, `20261001001800_permisos_lectura.sql`, `20261001001900_auditoria_automatica.sql`, `20261001002200_permisos_administracion.sql`, `src/lib/administracion.ts` y `src/lib/informacionDia.ts`.

Las tres tablas tienen auditoría automática con valores anteriores/posteriores. Las políticas versionadas permiten UPDATE a Administración mediante `private.es_admin()`; no comprueban finalización. Los permisos de DELETE no se conceden al cliente. Los triggers existentes protegen identidad y metadatos de creación, no la finalización.

El cliente `exigirAdmin` también admite Calidad; las políticas locales revisadas no confirman ese mismo acceso de escritura. No ampliar roles ni permisos para resolver esta discrepancia: comprobar primero las políticas desplegadas.

## Comprobación remota previa, solo lectura

Existe una referencia local a un proyecto vinculado, pero esta revisión no dispone de conexión SQL ni herramienta Supabase para consultar su catálogo. La ausencia de una migración local no demuestra ausencia de la RPC desplegada. No probar la RPC llamándola sobre un registro real.

Consultar en el proyecto correcto:

```sql
-- Definición y configuración real; también detecta sobrecargas.
select p.oid::regprocedure as firma,
       pg_get_userbyid(p.proowner) as propietario,
       p.prosecdef as security_definer,
       p.proacl as permisos,
       pg_get_functiondef(p.oid) as definicion
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'finalizar_aviso';

select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('avisos','programa_produccion','eventos_calendario')
order by table_name, ordinal_position;

select * from pg_policies
where schemaname = 'public'
  and tablename in ('avisos','programa_produccion','eventos_calendario');

select c.relname as tabla, t.tgname, pg_get_triggerdef(t.oid)
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and not t.tgisinternal
  and c.relname in ('avisos','programa_produccion','eventos_calendario');

select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('avisos','programa_produccion','eventos_calendario');
```

Comparar asimismo las migraciones desplegadas y la autorización utilizada por las RPC existentes. No sobrescribir una función remota desconocida.

## Migración propuesta, todavía sin aplicar

1. Tras la comprobación remota, versionar una migración nueva y transaccional bajo `supabase/migrations/`. No modificar migraciones históricas.
2. Reutilizar cualquier marca persistente de finalización que ya exista en producción. Si no existe, proponer explícitamente dos campos nuevos: `finalizado_en timestamptz` y `finalizado_por uuid` en cada tabla. Estos nombres son una propuesta, no columnas existentes confirmadas. Serían opcionales para las filas actuales, con consistencia de fecha/autor y valores fijados por el servidor.
3. No hacer backfill basado en fecha ni en `activo=false`; no alterar filas históricas. Mantener el campo Activo y los campos originales de programación. La nueva marca distinguiría un cierre explícito de la mera desactivación o expiración.
4. Reutilizar o adaptar `finalizar_aviso` después de conocer su contrato real. Proponer operaciones equivalentes para Producción y Eventos, con nombres y firmas definidos en la migración para aprobación, no asumidos como existentes.
5. Cada operación comprueba la sesión y la autorización ya vigente, bloquea la fila con `SELECT ... FOR UPDATE`, compara la versión/original, rechaza registros finalizados y registra fecha/autor del servidor. Avisos debe estar activo. No cambiar fechas de programación silenciosamente para forzar una finalización.
6. Proteger las tres tablas con un trigger BEFORE UPDATE OR DELETE: una fila finalizada rechaza cualquier cambio, incluso limpiar su marca de finalización o reactivarla. Proteger también la escritura inicial de las marcas, incluyendo INSERT, para impedir cierres falsificados fuera de la operación autorizada.
7. La RPC controlada puede requerir `SECURITY DEFINER`, propietario y `search_path` restringidos, y comprobación explícita de la autorización equivalente a las políticas actuales. El trigger debe distinguir esa ejecución privilegiada de una escritura directa del cliente; no confiar únicamente en un parámetro o GUC que el cliente pueda falsificar. La implementación exacta depende de los roles remotos comprobados. No conceder acceso a roles que hoy no lo tengan ni ampliar las políticas SELECT.
8. Conservar la auditoría existente: el UPDATE real deja el antes/después y el responsable en `public.auditoria`, dentro de la misma transacción. Una repetición no ejecuta otro UPDATE ni genera otra entrada; informa que el registro ya estaba finalizado.

La expiración automática de Avisos ya se representa como Finalizado en la interfaz. Antes de aplicar, definir explícitamente si esos avisos históricos expirados también deben quedar inmutables. No convertirlos ni crear marcas retroactivas sin autorización.

## Integración del cliente necesaria después de autorizar

- `src/lib/administracion.ts`: consultar/validar las marcas confirmadas como metadatos de solo lectura; no ofrecerlas en el formulario editable.
- `src/lib/finalizarAviso.ts`: alinear la validación con el contrato remoto real. Si se aprueba una marca independiente, no seguir equiparándola exclusivamente a `permanente=false` y `fin` pasado.
- Operación de finalización de Producción/Eventos: reutilizar la estructura de cancelación, comprobación de sesión y errores de Avisos, con las RPC aprobadas.
- `PanelAdministracion.tsx` y `FormularioAdmin.tsx`: reutilizar el diálogo actual, acciones visibles y estado; proteger también formularios abiertos antes de una finalización concurrente.
- `src/lib/informacionDia.ts` y `src/components/operativo/AvisosEntrada.tsx`: excluir las marcas de cierre únicamente en las vistas operativas de registros vigentes. Conservar el historial administrativo completo. Producción seguirá distinguiendo `activo` de la finalización.
- `finalizarAviso.css`: reutilizar el botón azul y el diálogo existentes.

## Validación antes de aplicar en producción

En una base de pruebas con las políticas reales: cancelación sin escritura; finalización única; UPDATE/DELETE directo rechazado después del cierre; intento de borrar la marca rechazado; doble clic y dos sesiones concurrentes; original desactualizado; sesión inválida; permisos por rol sin ampliaciones; historial y auditoría conservados; errores de red sin éxito anticipado; reintento que reconoce el cierre ya guardado; programación y Activo preservados.

No se han ejecutado estas pruebas contra Supabase. Esta entrega solo documenta la propuesta y las verificaciones de catálogo necesarias.
