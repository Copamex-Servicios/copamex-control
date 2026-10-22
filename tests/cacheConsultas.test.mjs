// Pruebas aisladas: sin peticiones reales ni escrituras en Supabase.
import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
let servidor, cacheConsultas, store, Pagina, useAdministracion
const id = '00000000-0000-4000-8000-000000000001'
function sesion(rol = 'admin', usuario = id) {
  store.setState({ estado:'autenticado', perfil:{ id:usuario, nombre:'Prueba', activo:true, rol }, sesion:{ user:{ id:usuario } } })
}
before(async () => {
  servidor = await createServer({ configFile:false, envDir:false, optimizeDeps:{ noDiscovery:true }, server:{ middlewareMode:true, hmr:false }, plugins:[{
    name:'sin-supabase', enforce:'pre',
    resolveId(id) { if (id.endsWith('/hooks/useAuth') || id === './useAuth') return '\0auth-doble'; if (/(^|\/)supabase(?:\.ts)?$/.test(id) && !id.startsWith('@')) return '\0supabase-doble' },
    load(id) { if (id === '\0auth-doble') return 'export const useAuth = () => globalThis.__cacheAuthPrueba.getState()'; if (id === '\0supabase-doble') return 'export const supabase = {}' },
  }, react()] })
  cacheConsultas = (await servidor.ssrLoadModule('/src/lib/cacheConsultas.ts')).cacheConsultas
  store = (await servidor.ssrLoadModule('/src/stores/authStore.ts')).useAuthStore
  globalThis.__cacheAuthPrueba = store
  Pagina = (await servidor.ssrLoadModule('/src/components/calidad/PaginaLimitesCalidad.tsx')).PaginaLimitesCalidad
  useAdministracion = (await servidor.ssrLoadModule('/src/hooks/useAdministracion.ts')).useAdministracion
})
after(async () => { await servidor?.close(); delete globalThis.__cacheAuthPrueba })
beforeEach(() => { store.setState({ estado:'sin-sesion',sesion:null,perfil:null }); sesion() })
test('conserva lecturas entre instancias y separa filtros y modulos', () => {
  const a = cacheConsultas('uno'); a.preparar()('calderas:dia', { total:3 })
  assert.deepEqual(cacheConsultas('uno').leer('calderas:dia'), { total:3 })
  assert.equal(a.leer('ptar:dia'), null)
  assert.equal(cacheConsultas('otro').leer('calderas:dia'), null)
})
test('caduca a los dos minutos y limita el numero de entradas', () => {
  const c=cacheConsultas('limite'), reloj=Date.now
  let ahora=reloj(); Date.now=()=>ahora
  try {
    c.preparar()('vencida', 1); ahora+=120000; assert.equal(c.leer('vencida'),null)
    for(let i=0;i<41;i++) c.preparar()(String(i),i)
    assert.equal(c.leer('0'),null); assert.equal(c.leer('40'),40)
  } finally { Date.now=reloj }
})
test('limpia al salir, cambiar usuario, rol o desactivar el perfil', () => {
  const c=cacheConsultas('seguridad')
  c.preparar()('x',1); sesion('admin','00000000-0000-4000-8000-000000000002'); assert.equal(c.leer('x'),null)
  sesion(); assert.equal(c.leer('x'),null)
  c.preparar()('x',2); sesion('calidad'); assert.equal(c.leer('x'),null)
  c.preparar()('x',3); store.setState({ perfil:{ ...store.getState().perfil, activo:false } }); assert.equal(c.leer('x'),null)
  sesion(); c.preparar()('x',4); store.setState({ estado:'sin-sesion',perfil:null,sesion:null }); c.preparar()('x',5); sesion(); assert.equal(c.leer('x'),null)
})
test('revalidar la misma cuenta conserva lecturas sin almacenar la sesion', () => {
  const c=cacheConsultas('revalidacion'); c.preparar()('x',7); sesion(); assert.equal(c.leer('x'),7)
})
test('descarta respuestas pendientes de una sesion anterior aunque el usuario regrese', () => {
  const c=cacheConsultas('pendiente'), guardar=c.preparar()
  store.setState({ estado:'sin-sesion',perfil:null,sesion:null }); sesion()
  guardar('x','respuesta anterior'); assert.equal(c.leer('x'),null)
})
test('Calidad distingue carga inicial de error de catalogos', () => {
  const html=renderToStaticMarkup(createElement(Pagina))
  assert.match(html,/role="status"/)
  assert.doesNotMatch(html,/Actualiza los cat/)
})
test('el hook devuelve el ultimo resultado desde el primer render al regresar', () => {
  cacheConsultas('administracion').preparar()(id, { prueba:'conservado' })
  function Consulta() { const { datos,cargando }=useAdministracion(); return createElement('span',null, datos?.prueba + ':' + cargando) }
  assert.match(renderToStaticMarkup(createElement(Consulta)),/conservado:true/)
})
