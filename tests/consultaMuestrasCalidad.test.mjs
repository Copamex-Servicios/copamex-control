// Read-only fixtures. These tests never connect to a real database.
import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const turno = (n = 2) => ({ id: id(n), fecha_operativa: '2026-11-03', area: 'calderas', turno: 'noche',
  operador_id: id(4), operador_acompanante_id: null, iniciado_por: id(1),
  iniciado_en: '2026-11-04T04:00:00Z', finalizado_en: null, notas_cierre: null,
  operador: { id: id(4), nombre: 'Operador de prueba' } })
function muestra(n, t = turno(), fecha = '2026-11-04T05:50:00Z') {
  return { id: id(100 + n), turno_id: t.id, hora_muestra: '23:50:00', notas: null,
    capturado_en: fecha, recibido_en: fecha, creado_por: id(1), eliminado_en: null, eliminado_por: null, turno: t,
    resultados: [{ id: id(1000 + n), muestra_id: id(100 + n), punto_id: id(7), parametro_id: id(8), valor: 150,
      limite_min_aplicado: null, limite_max_aplicado: 300, fuera_norma: false,
      punto: { id: id(7), nombre: 'Punto de prueba', area: 'calderas' },
      parametro: { id: id(8), nombre: 'Color', unidad: 'Pt-Co' } }] }
}
let servidor, servicio, filas, grupos, truncar, llamadas, auth, ConsultaMuestras
const filtros = { desde: '', hasta: '', area: 'todas', turno: 'todos' }
const signal = () => new AbortController().signal
before(async () => {
  globalThis.__consultaMuestrasPrueba = { from(tabla) {
    const llamada = { tabla, filtros: [], orden: [], rango: null }; llamadas.push(llamada)
    const q = {
      select(columnas, opciones) { llamada.columnas = columnas; assert.equal(opciones.count, 'exact'); return q },
      is(c, v) { llamada.filtros.push([c, v]); return q },
      limit() { return q },
      gte(c, v) { llamada.filtros.push([c, v]); return q }, lte(c, v) { llamada.filtros.push([c, v]); return q },
      eq(c, v) { llamada.filtros.push([c, v]); return q },
      order(c, v) { llamada.orden.push([c, v]); return q },
      range(a, b) { llamada.rango = [a, b]; return q },
      async abortSignal(s) {
        s.throwIfAborted()
        let datos = tabla === 'turnos_operativos' ? grupos : filas
        if (tabla === 'muestras_calidad') datos = datos.filter(m => m.turno_id === llamada.filtros.find(([c]) => c === 'turno_id')[1])
        const [a,b] = llamada.rango
        return { data: datos.slice(a,b + 1 - (truncar ? 1 : 0)), count: datos.length, error: null }
      },
    }; return q
  } }
  servidor = await createServer({ configFile: false, envDir: false, cacheDir: '.tmp/vite-tests/consulta-muestras',
    optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false },
    plugins: [{ name: 'consulta-calidad-simulada', enforce: 'pre',
      resolveId(n) {
        if (/(^|\/)supabase(?:\.ts)?$/.test(n) && !n.startsWith('@')) return '\0consulta-muestras'
        if (/(^|\/)authStore(?:\.ts)?$/.test(n)) return '\0consulta-auth'
      },
      load(n) {
        if (n === '\0consulta-muestras') return 'export const supabase = globalThis.__consultaMuestrasPrueba'
        if (n === '\0consulta-auth') return 'export const useAuthStore = Object.assign(() => globalThis.__consultaAuthPrueba, {getState: () => globalThis.__consultaAuthPrueba, setState: v => {globalThis.__consultaAuthPrueba = v}})'
      },
    }] })
  servicio = await servidor.ssrLoadModule('/src/lib/consultaMuestrasCalidad.ts')
  auth = (await servidor.ssrLoadModule('/src/stores/authStore.ts')).useAuthStore
  ConsultaMuestras = (await servidor.ssrLoadModule('/src/components/calidad/ConsultaMuestrasCalidad.tsx')).ConsultaMuestrasCalidad
})
after(async () => { await servidor?.close(); delete globalThis.__consultaMuestrasPrueba; delete globalThis.__consultaAuthPrueba })
beforeEach(() => { llamadas = []; truncar = false; grupos = [turno()]; filas = [] })
const grupo = async () => (await servicio.consultarGruposMuestras(filtros, 0, signal())).grupos[0]

for (const cantidad of [1, 3, 27, 45]) test(`consulta ${cantidad} muestras sin omisiones ni duplicados`, async () => {
  filas = Array.from({ length: cantidad }, (_, n) => muestra(n))
  const g = await grupo(); let pagina = 0, todas = [], lote
  do { lote = await servicio.consultarPaginaMuestras(g, pagina++, signal()); todas.push(...lote.muestras) } while(lote.hayMas)
  assert.equal(todas.length, cantidad); assert.equal(new Set(todas.map(m => m.lectura.id)).size, cantidad)
  assert.equal(lote.total, cantidad); assert.equal(pagina, Math.ceil(cantidad / 20))
  assert.deepEqual(llamadas.at(-1).orden.map(([c]) => c), ['capturado_en', 'id'])
  assert.equal(todas[0].lectura.resultados[0].limite_max_aplicado, 300)
})
test('pagina turnos por identificador, incluso con la misma fecha, area y tipo', async () => {
  grupos = Array.from({ length: 13 }, (_, n) => turno(20 + n))
  const a = await servicio.consultarGruposMuestras(filtros, 0, signal())
  const b = await servicio.consultarGruposMuestras(filtros, 1, signal())
  assert.equal(a.grupos.length, 10); assert.equal(a.hayMas, true)
  assert.equal(b.grupos.length, 3); assert.equal(b.hayMas, false)
  assert.equal(new Set([...a.grupos, ...b.grupos].map(g => g.turno.id)).size, 13)
})
test('mantiene juntas muestras de un turno que cruza medianoche y las ordena por registro', async () => {
  filas = [muestra(1, turno(), '2026-11-04T06:10:00Z'), muestra(0)]
  const lote = await servicio.consultarPaginaMuestras(await grupo(), 0, signal())
  assert.deepEqual(lote.muestras.map(m => m.lectura.capturado_en), ['2026-11-04T05:50:00Z','2026-11-04T06:10:00Z'])
  assert.ok(lote.muestras.every(m => m.turno.fecha_operativa === '2026-11-03'))
})
test('rechaza una pagina truncada en vez de anunciar un turno completo', async () => {
  filas = Array.from({ length: 27 }, (_, n) => muestra(n)); const g = await grupo(); truncar = true
  await assert.rejects(servicio.consultarPaginaMuestras(g, 0, signal()), /incompleta/)
})
test('rechaza muestras repetidas y relaciones inconsistentes', async () => {
  filas = [muestra(0), muestra(0)]; const g = await grupo()
  await assert.rejects(servicio.consultarPaginaMuestras(g, 0, signal()), /repetidas/)
  filas = [muestra(0, { ...turno(), fecha_operativa: '2026-11-02' })]
  await assert.rejects(servicio.consultarPaginaMuestras(g, 0, signal()), /no corresponde/)
})
test('valida filtros y cancelacion antes de consultar', async () => {
  await assert.rejects(servicio.consultarGruposMuestras({ ...filtros, desde:'2026-11-04', hasta:'2026-11-03' }, 0, signal()), /Revisa/)
  const c = new AbortController(); c.abort()
  await assert.rejects(servicio.consultarGruposMuestras(filtros, 0, c.signal))
  assert.equal(llamadas.length, 0)
})

test('botones diarios solo en interfaces de Calidad y Administracion; requieren fecha', () => {
  for (const rol of ['calidad','admin','calderas','ptar']) {
    auth.setState({ estado:'autenticado', perfil:{id:id(1),rol,activo:true}, sesion:{user:{id:id(1)}} })
    const html = renderToStaticMarkup(React.createElement(ConsultaMuestras,{exportacionDiaria:true,exportable:true}))
    if (rol === 'calidad' || rol === 'admin') {
      assert.match(html, /<button(?![^>]*disabled)[^>]*>PDF<\/button>/)
      assert.match(html, /<button(?![^>]*disabled)[^>]*>Excel<\/button>/)
      assert.match(html, /Selecciona la fecha operativa para descargar/)
      assert.match(html, /Fecha operativa/)
      const conFecha = renderToStaticMarkup(React.createElement(ConsultaMuestras,{exportacionDiaria:true,filtrosIniciales:{desde:'2026-11-03',hasta:'2026-11-03',area:'calderas',turno:'todos'}}))
      assert.match(conFecha, /<button(?![^>]*disabled)[^>]*>PDF<\/button>/)
      assert.match(conFecha, /<button(?![^>]*disabled)[^>]*>Excel<\/button>/)
    } else {
      assert.doesNotMatch(html, />PDF<\/button>|>Excel<\/button>/)
    }
    const consulta = renderToStaticMarkup(React.createElement(ConsultaMuestras))
    assert.doesNotMatch(consulta, />PDF<\/button>|>Excel<\/button>/)
  }
  auth.setState({estado:'sin-cuenta',perfil:null,sesion:null})
  assert.equal(renderToStaticMarkup(React.createElement(ConsultaMuestras,{exportacionDiaria:true})), '')
  assert.equal(llamadas.length,0)
})
