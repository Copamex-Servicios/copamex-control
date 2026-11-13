import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const solicitud = { alcance: 'dia-completo', fechaOperativa: '2026-11-03', area: 'calderas' }
function muestra(n, tipo = 'dia', area = 'calderas') {
  const muestraId = id(100 + n), turnoId = id(10 + ['dia','tarde','noche'].indexOf(tipo))
  const fecha = new Date(Date.parse('2026-11-04T05:50:00Z') + n * 60000).toISOString()
  return { id: muestraId, turno_id: turnoId, hora_muestra: '23:50:00', capturado_en: fecha, recibido_en: fecha,
    notas: 'Nota original', creado_por: id(1), eliminado_en: null, eliminado_por: null,
    turno: { id: turnoId, fecha_operativa: solicitud.fechaOperativa, area, turno: tipo,
      operador_id: id(4), operador_acompanante_id: null, iniciado_por: id(1),
      iniciado_en: '2026-11-03T12:00:00Z', finalizado_en: null, notas_cierre: null,
      operador: { id: id(4), nombre: 'Operador original' } },
    resultados: [7,8].map(p => ({ id: id(10000 + n * 10 + p), muestra_id: muestraId, punto_id: id(p), parametro_id: id(9),
      valor: n, limite_min_aplicado: 0, limite_max_aplicado: 300, fuera_norma: n > 300,
      punto: { id: id(p), nombre: 'Punto ' + p, area }, parametro: { id: id(9), nombre: 'Color', unidad: 'Pt-Co' } })),
  }
}
let server, servicio, auth, filas, llamadas, ajustar, alResponder
const signal = () => new AbortController().signal
const perfil = (rol = 'calidad', cuenta = id(1)) => ({ estado: 'autenticado', perfil: { id: cuenta, rol, activo: true }, sesion: { user: { id: cuenta } } })
before(async () => {
  globalThis.__diarioCalidad = { from(tabla) {
    assert.equal(tabla, 'muestras_calidad')
    const llamada = { filtros: {}, rango: null, head: false }; llamadas.push(llamada)
    const q = { select(_s, opciones) { assert.equal(opciones.count,'exact'); llamada.head = opciones.head; return q },
      is(c,v) { llamada.filtros[c] = v; return q }, eq(c,v) { llamada.filtros[c] = v; return q },
      order() { return q }, range(a,b) { llamada.rango = [a,b]; return q },
      async abortSignal(s) {
        s.throwIfAborted(); alResponder()
        const data = filas.filter(m => m.turno.area === llamada.filtros['turno.area'] && m.turno.fecha_operativa === llamada.filtros['turno.fecha_operativa'])
        const r = { data: llamada.head ? null : data.slice(llamada.rango[0], llamada.rango[1]+1), count: data.length, error: null }
        return ajustar(r, llamada)
      } }
    return q
  } }
  server = await createServer({ configFile:false, envDir:false, cacheDir:'.tmp/vite-tests/diario-calidad',
    optimizeDeps:{noDiscovery:true}, server:{middlewareMode:true,hmr:false},
    plugins:[{name:'diario-calidad-simulado',enforce:'pre',
      resolveId(n) { if (/(^|\/)supabase(?:\.ts)?$/.test(n) && !n.startsWith('@')) return '\0diario-calidad' },
      load(n) { if (n === '\0diario-calidad') return 'export const supabase = globalThis.__diarioCalidad' },
    }] })
  servicio = await server.ssrLoadModule('/src/lib/reporteDiarioCalidad.ts')
  auth = (await server.ssrLoadModule('/src/stores/authStore.ts')).useAuthStore
})
after(async () => { await server?.close(); delete globalThis.__diarioCalidad })
beforeEach(() => { filas = []; llamadas = []; ajustar = r => r; alResponder = () => {}; auth.setState(perfil()) })

test('dia completo incluye 2 + 1 + 4 muestras individuales y todos sus resultados historicos', async () => {
  filas = ['dia','dia','tarde','noche','noche','noche','noche'].map((t,n) => muestra(n,t))
  const resultado = await servicio.consultarDiaCompletoCalidad(solicitud,signal())
  assert.equal(resultado.totalMuestras,7)
  assert.deepEqual(resultado.turnos.map(t => t.muestras.length),[2,1,4])
  assert.equal(resultado.turnos.flatMap(t => t.muestras).reduce((n,m) => n+m.lectura.resultados.length,0),14)
  const m = resultado.turnos[2].muestras[3]
  assert.equal(m.lectura.resultados[0].valor,6)
  assert.equal(m.lectura.resultados[0].limite_max_aplicado,300)
  assert.equal(m.lectura.resultados[0].parametro.unidad,'Pt-Co')
  assert.equal(m.lectura.notas,'Nota original'); assert.equal(m.operadorNombre,'Operador original')
})
test('pagina todas las muestras del dia sin depender de las 20 visibles', async () => {
  filas = Array.from({length:451},(_,n) => muestra(n,'noche'))
  const resultado = await servicio.consultarDiaCompletoCalidad(solicitud,signal())
  assert.equal(resultado.totalMuestras,451)
  assert.equal(new Set(resultado.turnos[2].muestras.map(m => m.lectura.id)).size,451)
  assert.deepEqual(llamadas.filter(l => !l.head).map(l => l.rango),[[0,199],[200,399],[400,599]])
  assert.equal(llamadas.length,4)
})
test('una muestra habitual y tres adicionales conservan cuatro horarios y el valor original', async () => {
  filas = Array.from({length:4},(_,n)=>muestra(n))
  for (const m of filas.slice(1)) {
    m.seguimiento_id = id(900)
    m.resultados = m.resultados.slice(0,1)
  }
  const resultado = await servicio.consultarDiaCompletoCalidad(solicitud,signal())
  assert.equal(resultado.totalMuestras,4)
  const muestras=resultado.turnos[0].muestras
  assert.equal(muestras[0].lectura.seguimientoId,undefined)
  assert.equal(muestras[0].lectura.resultados.length,2)
  assert.equal(muestras[0].lectura.resultados[0].valor,0)
  assert.equal(muestras.filter(m=>m.lectura.seguimientoId===id(900)).length,3)
  assert.equal(new Set(muestras.map(m=>m.lectura.capturado_en)).size,4)
})
test('Noche conserva la fecha operativa al cruzar medianoche y ordena por hora de registro', async () => {
  filas = [muestra(30,'noche'),muestra(0,'noche')]
  const resultado = await servicio.consultarDiaCompletoCalidad(solicitud,signal())
  assert.deepEqual(resultado.turnos.map(t => t.muestras.length),[0,0,2])
  assert.deepEqual(resultado.turnos[2].muestras.map(m => m.lectura.capturado_en),['2026-11-04T05:50:00.000Z','2026-11-04T06:20:00.000Z'])
  assert.ok(resultado.turnos[2].muestras.every(m => m.turno.fecha_operativa === '2026-11-03'))
})
test('separa PTAR y Calderas y mantiene vacios los turnos sin muestras', async () => {
  filas = [muestra(0),muestra(1,'tarde','ptar')]
  const resultado = await servicio.consultarDiaCompletoCalidad({...solicitud,area:'ptar'},signal())
  assert.equal(resultado.totalMuestras,1); assert.deepEqual(resultado.turnos.map(t => t.muestras.length),[0,1,0])
  assert.ok(llamadas.every(l => l.filtros['turno.area'] === 'ptar' && l.filtros.eliminado_en === null))
})
test('rechaza paginas incompletas, repetidas o que cambian de total, sin devolver un reporte parcial', async () => {
  filas = Array.from({length:201},(_,n) => muestra(n))
  ajustar = (r,l) => l.rango?.[0] === 0 ? {...r,data:r.data.slice(1)} : r
  await assert.rejects(servicio.consultarDiaCompletoCalidad(solicitud,signal()),/incompleta/)
  ajustar = (r,l) => l.rango?.[0] === 200 ? {...r,data:[filas[0]]} : r
  await assert.rejects(servicio.consultarDiaCompletoCalidad(solicitud,signal()),/incompleta/)
  ajustar = (r,l) => l.head ? {...r,count:r.count+1} : r
  await assert.rejects(servicio.consultarDiaCompletoCalidad(solicitud,signal()),/incompleta/)
})
test('respeta sesion activa, cambio de cuenta y cancelacion; solo usa SELECT', async () => {
  for (const rol of ['admin','calidad','calderas','ptar']) {
    auth.setState(perfil(rol)); assert.equal((await servicio.consultarDiaCompletoCalidad(solicitud,signal())).totalMuestras,0)
  }
  auth.setState({...perfil(),perfil:{...perfil().perfil,activo:false}})
  await assert.rejects(servicio.consultarDiaCompletoCalidad(solicitud,signal()),/cuenta activa/)
  auth.setState(perfil()); alResponder = () => auth.setState(perfil('calidad',id(99)))
  await assert.rejects(servicio.consultarDiaCompletoCalidad(solicitud,signal()),/cuenta cambi/)
  const c = new AbortController(); c.abort()
  await assert.rejects(servicio.consultarDiaCompletoCalidad(solicitud,c.signal))
})
test('preparacion rechaza otra fecha, mezcla de areas y muestras repetidas', async () => {
  filas = [muestra(0)]
  const reporte = await servicio.consultarDiaCompletoCalidad(solicitud,signal()), m = reporte.turnos[0].muestras[0]
  assert.throws(() => servicio.prepararDiaCompletoCalidad(solicitud,[m,m]),/repetidas/)
  assert.throws(() => servicio.prepararDiaCompletoCalidad({...solicitud,fechaOperativa:'2026-11-04'},[m]),/no corresponde/)
  assert.throws(() => servicio.prepararDiaCompletoCalidad({...solicitud,area:'ptar'},[m]),/no corresponde/)
})
