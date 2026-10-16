# Lectura cruzada de Reportes técnicos de Planta

Resultado: funcionamiento confirmado en localhost tras recargar. No se aplicó SQL ni se cambiaron permisos de Supabase. Sin commit, push ni despliegue.

## Fuentes y alcance

Las tarjetas usan public.bitacora_calderas y public.bitacora_ptar, con turnos_operativos y operadores. El detalle de Calderas incluye bitacora_calderas_equipos y bitacora_calderas_pilas.

ReportesTecnicosPlanta pasa compartido=true a ambos historiales. La lista llama consultar_bitacoras_tecnicas_planta y el detalle consultar_bitacora_tecnica_planta. El área del filtro no se sustituye por el rol.

Actividad y registros utiliza lecturas_pozos, lecturas_uf, lecturas_ptar, muestras_calidad y resultados_calidad. No se modificó esa sección en esta intervención. public.bitacora contiene observaciones antiguas y no es la fuente de las tarjetas.

## Causa y comprobación real

La vista conservada por el navegador estaba desactualizada. Tras recargar, el usuario confirmó que su cuenta PTAR muestra los tres reportes de Calderas. No se determinó si el estado anterior residía en módulos cargados previamente o en el resultado conservado por React.

Se comprobó el proceso Vite y los módulos servidos por localhost:5173 desde la carpeta indicada: ambos historiales recibían compartido=true y usaban las RPC compartidas.

Un diagnóstico temporal, ya retirado, registró exclusivamente rol, proyecto, área, cantidad y código de error. En el proyecto original milvashmtxlqjzevfdcx:

| Sesión real | Calderas | PTAR | Error |
| --- | ---: | ---: | --- |
| PTAR | 3 | 2 | Ninguno |
| Calderas | 3 | 2 | Ninguno |

También se confirmó que las consultas que alimentan las tarjetas devolvían tres filas al seleccionar Calderas y dos al seleccionar PTAR. No se recogieron tokens, contraseñas, identificadores de usuario ni contenido de los reportes.

La RLS de lectura directa sigue limitada al área propia. Las RPC compartidas ya permiten lectura cruzada a Calderas, PTAR y Administración activos. No hace falta ampliar SELECT de tablas ni permisos de escritura.

## Limpieza

Se retiraron el efecto React, el registro temporal del helper y el middleware Vite. La configuración Vite volvió a su contenido anterior. No hicieron falta cambios funcionales adicionales en React, diseño, pestañas o filtros.

La propuesta 20261015000300_lectura_cruzada_planta.sql se retiró de las migraciones activas al comprobar que no era necesaria. Solo se conserva archivada como work/validacion-sql/lectura_cruzada_planta_propuesta_no_aplicada.sql, sin ejecución remota. Las migraciones anteriores permanecen intactas.

## Validación

- TypeScript, lint y build: aprobados.
- work/qa-planta-lectura-cruzada.cjs: nueve escenarios en navegador aislado con API simulada; Calderas/PTAR/admin, alternancia 3/2/3, detalle solo lectura, ninguna consulta directa de tablas y cero peticiones externas.
- work/comprobar-ruta-planta.cjs: contratos de lista/detalle y filtros/paginación conservados.
- Pruebas SQL aisladas: lectura cruzada de ambos roles y Administración; captura cruzada y escrituras directas rechazadas; inactivos/anon sin acceso. Sin cambios de RLS, ACL, funciones de escritura ni datos remotos.