// Pruebas con Supabase simulado: no leen ni modifican datos remotos.
import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const cuenta = id(1), otraCuenta = id(2)
const aviso = autor => ({ id: id(3), mensaje: 'Aviso de prueba', permanente: true, inicio: null, fin: null,
  creado_por: autor, creado_en: '2026-11-03T10:00:00Z' })
let server, store, permisos, servicio, administracion, Panel, llamadas, resultado, filaEditable
function sesion(rol = 'admin', usuario = cuenta, activo = true) {
  store.setState({ estado: 'autenticado', perfil: { id: usuario, nombre: 'Prueba', rol, activo }, sesion: { user: { id: usuario } } })
}
before(async () => {
  globalThis.__avisosAutorSupabase = {
    rpc(nombre, parametros) { llamadas.push({ nombre, parametros }); return { abortSignal: async () => resultado() } },
    from(tabla) {
      assert.equal(tabla, 'avisos')
      if (!filaEditable) throw new Error('No debe consultar ni escribir tablas para rechazar una edición ajena.')
      const consulta = {
        select() { return consulta }, eq() { return consulta }, is() { return consulta },
        abortSignal(signal) { signal.throwIfAborted(); return consulta },
        update(valores) { filaEditable = { ...filaEditable, ...valores }; return consulta },
        async maybeSingle() { return { data: { ...filaEditable }, error: null } },
      }
      return consulta
    },
  }
  server = await createServer({ configFile: false, envDir: false, cacheDir: '.tmp/vite-tests/avisos-autor', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false }, plugins: [{
    name: 'avisos-autor-aislados', enforce: 'pre',
    resolveId(nombre) {
      if (/(^|\/)supabase(?:\.ts)?$/.test(nombre) && !nombre.startsWith('@')) return '\0avisos-supabase'
      if (nombre.endsWith('/hooks/useAdministracion')) return '\0avisos-administracion'
    },
    load(nombre) {
      if (nombre === '\0avisos-supabase') return 'export const supabase = globalThis.__avisosAutorSupabase'
      if (nombre === '\0avisos-administracion') return 'export const useAdministracion = () => globalThis.__avisosAutorVista'
    },
  }, react()] })
  store = (await server.ssrLoadModule('/src/stores/authStore.ts')).useAuthStore
  permisos = await server.ssrLoadModule('/src/lib/permisosAvisos.ts')
  servicio = await server.ssrLoadModule('/src/lib/finalizarAviso.ts')
  administracion = await server.ssrLoadModule('/src/lib/administracion.ts')
  Panel = (await server.ssrLoadModule('/src/components/administracion/PanelAdministracion.tsx')).PanelAdministracion
})
after(async () => { await server?.close(); delete globalThis.__avisosAutorSupabase; delete globalThis.__avisosAutorVista })
beforeEach(() => {
  llamadas = []; filaEditable = null; sesion()
  resultado = () => ({ data: { ...aviso(cuenta), permanente: false, fin: '2026-11-03T00:00:00Z' }, error: null })
})
test('Administración y Calidad pueden finalizar exclusivamente el aviso de su cuenta', async () => {
  for (const rol of ['admin', 'calidad']) {
    sesion(rol)
    assert.equal((await servicio.finalizarAviso(cuenta, aviso(cuenta))).creado_por, cuenta)
    await assert.rejects(servicio.finalizarAviso(cuenta, aviso(otraCuenta)), /Solo la cuenta que creó/)
  }
  assert.equal(llamadas.length, 2)
})
test('otra cuenta del mismo rol tampoco puede finalizarlo', async () => {
  for (const rol of ['admin', 'calidad']) {
    sesion(rol, otraCuenta)
    await assert.rejects(servicio.finalizarAviso(otraCuenta, aviso(cuenta)), /Solo la cuenta que creó/)
  }
  assert.equal(llamadas.length, 0)
})
test('rechaza perfiles inactivos, otros roles y el cambio de cuenta durante la respuesta', async () => {
  for (const rol of ['calderas', 'ptar']) { sesion(rol); await assert.rejects(servicio.finalizarAviso(cuenta, aviso(cuenta))) }
  sesion('admin', cuenta, false); await assert.rejects(servicio.finalizarAviso(cuenta, aviso(cuenta)))
  assert.equal(llamadas.length, 0)
  sesion(); resultado = () => { sesion('admin', otraCuenta); return { data: aviso(cuenta), error: null } }
  await assert.rejects(servicio.finalizarAviso(cuenta, aviso(cuenta)))
})
test('no acepta una respuesta que cambie el autor', async () => {
  resultado = () => ({ data: { ...aviso(otraCuenta), permanente: false, fin: '2026-11-03T00:00:00Z' }, error: null })
  await assert.rejects(servicio.finalizarAviso(cuenta, aviso(cuenta)), /no confirmó/)
})
test('tampoco permite cerrar un aviso ajeno cambiando su fecha de fin', async () => {
  const original = aviso(otraCuenta), valores = { mensaje: original.mensaje, permanente: false, inicio: null, fin: '2026-11-03T00:00:00Z' }
  await assert.rejects(administracion.guardarAdministracion({ cuenta, tabla: 'avisos', id: original.id, original, valores }), /Solo la cuenta que creó/)
  assert.equal(llamadas.length, 0)
})
test('bloquea cualquier edición ajena, incluso el mensaje y una vigencia futura', async () => {
  for (const rol of ['admin', 'calidad']) {
    sesion(rol)
    const original = aviso(otraCuenta)
    assert.equal(permisos.esAutorAviso(cuenta, original), false)
    for (const valores of [
      { mensaje: 'Texto actualizado', permanente: true, inicio: null, fin: null },
      { mensaje: original.mensaje, permanente: false, inicio: null, fin: '2099-01-01T00:00:00Z' },
    ]) await assert.rejects(administracion.guardarAdministracion({ cuenta, tabla: 'avisos', id: original.id, original, valores }), /Solo la cuenta que creó/)
  }
})
test('cada creador activo de Administración o Calidad conserva la edición de su mensaje', async () => {
  for (const rol of ['admin', 'calidad']) {
    sesion(rol); filaEditable = aviso(cuenta)
    const original = { ...filaEditable }
    const valores = { mensaje: 'Actualización propia', permanente: true, inicio: null, fin: null }
    const guardado = await administracion.guardarAdministracion({ cuenta, tabla: 'avisos', id: original.id, original, valores })
    assert.equal(guardado.mensaje, valores.mensaje)
    assert.equal(guardado.creado_por, cuenta)
  }
})
test('la tabla muestra Editar y Finalizar únicamente en el aviso de la cuenta creadora', () => {
  const propio = aviso(cuenta), ajeno = { ...aviso(otraCuenta), id: id(4) }
  const datos = Object.fromEntries(administracion.seccionesAdmin.map(c => [c.tabla, { filas: [], error: false, limitada: false }]))
  datos.avisos.filas = [propio, ajeno]
  globalThis.__avisosAutorVista = { cuenta, datos, cargando: false, guardando: false, pendiente: null,
    error: null, mensaje: null, guardar() {}, reintentar() {}, actualizar() {} }
  const html = renderToStaticMarkup(createElement(Panel, { soloGestion: true }))
  assert.equal((html.match(/>Finalizar<\/button>/g) ?? []).length, 1)
  assert.equal((html.match(/>Editar<\/button>/g) ?? []).length, 1)
  globalThis.__avisosAutorVista.cuenta = id(99)
  assert.doesNotMatch(renderToStaticMarkup(createElement(Panel, { soloGestion: true })), />Finalizar<\/button>/)
  assert.doesNotMatch(renderToStaticMarkup(createElement(Panel, { soloGestion: true })), />Editar<\/button>/)
})
