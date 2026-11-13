// Regresión aislada: ninguna petición ni escritura en Supabase real.
import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const cuenta = id(1), turnoId = id(2), muestraId = id(3)
let servidor, servicio, respuesta, llamadas
function muestra() {
  return {
    id: muestraId, turno_id: turnoId, hora_muestra: '08:00:00', notas: null,
    capturado_en: '2026-11-03T14:00:00Z', recibido_en: '2026-11-03T14:00:00Z',
    creado_por: cuenta, eliminado_en: null, eliminado_por: null,
    turno: { id: turnoId, fecha_operativa: '2026-11-03', area: 'calderas', turno: 'dia',
      operador_id: id(4), operador_acompanante_id: id(5), iniciado_por: cuenta,
      iniciado_en: '2026-11-03T13:00:00Z', finalizado_en: null, notas_cierre: null,
      operador: { id: id(4), nombre: 'Operador de prueba' } },
    resultados: [{ id: id(6), muestra_id: muestraId, punto_id: id(7), parametro_id: id(8), valor: 150,
      limite_min_aplicado: null, limite_max_aplicado: 300, fuera_norma: false,
      punto: { id: id(7), nombre: 'Punto de prueba', area: 'calderas' },
      parametro: { id: id(8), nombre: 'Color', unidad: null } }],
  }
}
function solicitud(original = null) {
  return { id: muestraId, turnoId, original, valores: { notas: null,
    resultados: [{ id: id(6), punto_id: id(7), parametro_id: id(8), valor: 150 }] } }
}
const guardar = original => servicio.guardarLecturaCalidad(cuenta, solicitud(original), new AbortController().signal)
before(async () => {
  globalThis.__confirmacionCalidadPrueba = {
    rpc(nombre, parametros) {
      llamadas.push({ nombre, parametros })
      return { abortSignal: async signal => { signal.throwIfAborted(); return respuesta() } }
    },
    from() { throw new Error('La confirmación no debe agregar consultas de lectura.') },
  }
  servidor = await createServer({ configFile: false, envDir: false, cacheDir: '.tmp/vite-tests/confirmacion-calidad', optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false }, plugins: [{ name: 'confirmacion-calidad-simulada', enforce: 'pre',
      resolveId(nombre) { if (/(^|\/)supabase(?:\.ts)?$/.test(nombre) && !nombre.startsWith('@')) return '\0confirmacion-calidad' },
      load(nombre) { if (nombre === '\0confirmacion-calidad') return 'export const supabase = globalThis.__confirmacionCalidadPrueba' },
    }] })
  servicio = await servidor.ssrLoadModule('/src/lib/calidad.ts')
})
after(async () => { await servidor?.close(); delete globalThis.__confirmacionCalidadPrueba })
beforeEach(() => { llamadas = []; respuesta = () => ({ data: muestra(), error: null }) })

test('confirma la muestra con pareja aunque la RPC no incluya el nombre del acompañante', async () => {
  const lectura = await guardar()
  assert.equal(lectura.id, muestraId)
  assert.equal(lectura.resultados[0].valor, 150)
  assert.equal(llamadas.length, 1)
  assert.equal(llamadas[0].nombre, 'guardar_muestra_calidad_online')
})
test('confirma muestras de turnos históricos sin acompañante', async () => {
  respuesta = () => { const data = muestra(); data.turno.operador_acompanante_id = null; return { data, error: null } }
  assert.equal((await guardar()).id, muestraId)
})
test('confirma reintentos con el mismo identificador y conserva la solicitud original', async () => {
  await guardar(); await guardar()
  assert.deepEqual(llamadas[0], llamadas[1])
})
test('el historial sigue exigiendo la relación correcta del segundo operador', () => {
  assert.throws(() => servicio.leerRegistroCalidad(muestra()), /segundo operador/)
  const data = muestra(); data.turno.operador_acompanante = { id: id(5), nombre: 'Acompañante de prueba' }
  assert.match(servicio.leerRegistroCalidad(data).operadorNombre, /Acompañante de prueba/)
  data.turno.operador_acompanante.id = id(99)
  assert.throws(() => servicio.leerRegistroCalidad(data), /segundo operador/)
})
test('rechaza confirmaciones de otra muestra, turno o cuenta y valores distintos', async () => {
  for (const modificar of [m => { m.id = id(99) }, m => { m.turno_id = id(99) },
    m => { m.creado_por = id(99) }, m => { m.resultados[0].valor = 151 }, m => { m.notas = 'Otra nota' }]) {
    respuesta = () => { const data = muestra(); modificar(data); return { data, error: null } }
    await assert.rejects(guardar(), e => e instanceof servicio.ErrorCalidad && e.resultadoIncierto)
  }
})
test('rechaza evaluaciones incorrectas, resultados repetidos y muestras incompletas', async () => {
  for (const modificar of [m => { m.resultados[0].fuera_norma = true },
    m => { m.resultados.push({ ...m.resultados[0] }) }, m => { m.resultados = [] },
    m => { m.hora_muestra = 'inválida' }, m => { m.recibido_en = '2026-11-03T12:00:00Z' }]) {
    respuesta = () => { const data = muestra(); modificar(data); return { data, error: null } }
    await assert.rejects(guardar(), e => e instanceof servicio.ErrorCalidad && e.resultadoIncierto)
  }
})
test('una corrección conserva las fechas y límites originales', async () => {
  const original = { ...muestra() }; delete original.turno
  assert.equal((await guardar(original)).capturado_en, original.capturado_en)
  respuesta = () => { const data = muestra(); data.resultados[0].limite_max_aplicado = 400; return { data, error: null } }
  await assert.rejects(guardar(original), e => e instanceof servicio.ErrorCalidad && e.resultadoIncierto)
})
test('mantiene el estado incierto ante fallos de conexión y los rechazos definitivos del servidor', async () => {
  respuesta = () => { throw new Error('Sin conexión') }
  await assert.rejects(guardar(), e => e instanceof servicio.ErrorCalidad && e.resultadoIncierto)
  respuesta = () => ({ data: null, error: { code: '42501', message: 'El turno está cerrado.' } })
  await assert.rejects(guardar(), e => e instanceof servicio.ErrorCalidad && !e.resultadoIncierto)
})
test('la consulta habitual no toma una lectura adicional como reemplazo de la muestra completa', async () => {
  const normal=muestra()
  normal.turno.operador_acompanante={id:id(5),nombre:'Segundo operador'}
  const adicional=structuredClone(normal)
  adicional.id=id(99); adicional.seguimiento_id=id(90)
  adicional.resultados[0].muestra_id=adicional.id
  adicional.resultados[0].valor=120
  const filas=[adicional,normal]
  globalThis.__confirmacionCalidadPrueba.from=()=>{
    const filtros={}
    const q={
      select(){return q},eq(k,v){filtros[k]=v;return q},is(k,v){filtros[k]=v;return q},
      order(){return q},limit(){return q},abortSignal(){return q},
      async maybeSingle(){return {data:filas.find(m=>
        m.turno_id===filtros.turno_id && (!('seguimiento_id' in filtros)||!m.seguimiento_id)),error:null}}
    }
    return q
  }
  try {
    const consultado=await servicio.consultarLecturaCalidad(turnoId,new AbortController().signal)
    assert.equal(consultado.lectura.id,muestraId)
    assert.equal(consultado.lectura.resultados[0].valor,150)
    assert.equal(servicio.leerRegistroCalidad(adicional).lectura.seguimientoId,id(90))
  } finally {
    globalThis.__confirmacionCalidadPrueba.from=()=>{throw new Error('No se esperaba otra consulta')}
  }
})
