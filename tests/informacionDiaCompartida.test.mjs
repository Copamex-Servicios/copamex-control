// Pruebas aisladas de la consulta compartida; no realizan peticiones reales a Supabase.
import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

let servidor, informacion, llamadas, pendientes
const cuenta = '00000000-0000-4000-8000-000000000001'

before(async () => {
  globalThis.__informacionDiaSupabase = {
    from(tabla) {
      assert.equal(tabla, 'avisos')
      const consulta = {
        select() { return consulta }, or() { return consulta }, order() { return consulta }, limit() { return consulta },
        abortSignal(signal) {
          llamadas += 1
          return new Promise((resolve, reject) => {
            pendientes.push({ resolve, signal })
            signal.addEventListener('abort', () => reject(new Error('abortado')), { once: true })
          })
        },
      }
      return consulta
    },
  }
  servidor = await createServer({ configFile: false, envDir: false, cacheDir: '.tmp/vite-tests/informacion-dia',
    optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false }, plugins: [{
      name: 'informacion-dia-supabase-simulado', enforce: 'pre',
      resolveId(id) { if (/(^|\/)supabase(?:\.ts)?$/.test(id) && !id.startsWith('@')) return '\0informacion-dia-supabase' },
      load(id) { if (id === '\0informacion-dia-supabase') return 'export const supabase = globalThis.__informacionDiaSupabase' },
    }, react()] })
  informacion = await servidor.ssrLoadModule('/src/lib/informacionDia.ts')
})

after(async () => {
  await servidor?.close()
  delete globalThis.__informacionDiaSupabase
})

beforeEach(() => { llamadas = 0; pendientes = [] })

test('comparte una consulta en curso y reutiliza brevemente su resultado', async () => {
  const a = new AbortController(), b = new AbortController()
  const primera = informacion.consultarAvisosActivos('sesion:calderas', a.signal)
  const segunda = informacion.consultarAvisosActivos('sesion:calderas', b.signal)
  assert.equal(llamadas, 1)
  pendientes[0].resolve({ data: [{ id: 'aviso-1', mensaje: 'Prueba' }], error: null })
  const esperado = { elementos: [{ id: 'aviso-1', mensaje: 'Prueba' }], error: false }
  assert.deepEqual(await primera, esperado)
  assert.deepEqual(await segunda, esperado)
  assert.deepEqual(await informacion.consultarAvisosActivos('sesion:calderas', new AbortController().signal), esperado)
  assert.equal(llamadas, 1)
})

test('separa la caché por cuenta, sesión, rol y área', () => {
  const token = payload => `cabecera.${btoa(JSON.stringify(payload)).replace(/=/g, '')}.firma`
  const mismaSesion = token({ session_id: 'sesion-1' })
  const base = informacion.claveCacheAvisos(cuenta, mismaSesion, undefined, 'calderas', 'calderas')
  assert.notEqual(base, informacion.claveCacheAvisos('otra-cuenta', mismaSesion, undefined, 'calderas', 'calderas'))
  assert.notEqual(base, informacion.claveCacheAvisos(cuenta, token({ session_id: 'sesion-2' }), undefined, 'calderas', 'calderas'))
  assert.notEqual(base, informacion.claveCacheAvisos(cuenta, mismaSesion, undefined, 'admin', 'todas'))
})

test('una invalidación fuerza una consulta nueva aunque la anterior siga en curso', async () => {
  const anterior = informacion.consultarAvisosActivos('sesion:ptar', new AbortController().signal)
  informacion.invalidarCacheAvisosActivos()
  const actualizada = informacion.consultarAvisosActivos('sesion:ptar', new AbortController().signal)
  assert.equal(llamadas, 2)
  pendientes[1].resolve({ data: [{ id: 'aviso-nuevo', mensaje: 'Actualizado' }], error: null })
  assert.deepEqual(await actualizada, { elementos: [{ id: 'aviso-nuevo', mensaje: 'Actualizado' }], error: false })
  pendientes[0].resolve({ data: [{ id: 'aviso-viejo', mensaje: 'Anterior' }], error: null })
  await anterior
  assert.deepEqual(await informacion.consultarAvisosActivos('sesion:ptar', new AbortController().signal),
    { elementos: [{ id: 'aviso-nuevo', mensaje: 'Actualizado' }], error: false })
  assert.equal(llamadas, 2)
})

test('cancelar un consumidor no interrumpe la consulta compartida por otro', async () => {
  const a = new AbortController(), b = new AbortController()
  const primera = informacion.consultarAvisosActivos('sesion:compartida', a.signal)
  const segunda = informacion.consultarAvisosActivos('sesion:compartida', b.signal)
  a.abort()
  await assert.rejects(primera, /Consulta cancelada/)
  assert.equal(pendientes[0].signal.aborted, false)
  pendientes[0].resolve({ data: [{ id: 'aviso-1', mensaje: 'Prueba' }], error: null })
  assert.deepEqual(await segunda, { elementos: [{ id: 'aviso-1', mensaje: 'Prueba' }], error: false })
  assert.equal(llamadas, 1)
})
