-- Solo lectura. Ejecutar en el mismo proyecto de Supabase ya verificado.
-- Devuelve una sola tabla para compartir todas las definiciones juntas.
-- No llama a las funciones ni modifica registros.
select p.oid::regprocedure::text as firma,
       pg_get_userbyid(p.proowner) as propietario,
       p.prosecdef as security_definer,
       p.proacl::text as permisos,
       p.proconfig as configuracion,
       pg_get_functiondef(p.oid) as definicion
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'private'
  and p.proname in (
    'rol_actual',
    'es_admin',
    'proteger_creacion_catalogo',
    'proteger_identidad_catalogo',
    'registrar_auditoria'
  )
order by p.proname, p.oid::regprocedure::text;
