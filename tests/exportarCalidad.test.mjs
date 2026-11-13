import test from 'node:test'
import assert from 'node:assert/strict'
import { crc32 } from 'node:zlib'
import { hojaResultadosCalidad } from '../src/lib/exportarCalidad.ts'
import { crearXlsxReporte } from '../src/lib/xlsxReporte.ts'

function archivos(bytes) {
  const partes = new Map(), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let offset = 0; view.getUint32(offset, true) === 0x04034b50;) {
    const size = view.getUint32(offset + 18, true), nombre = view.getUint16(offset + 26, true)
    const inicio = offset + 30 + nombre + view.getUint16(offset + 28, true)
    assert.equal(crc32(bytes.slice(inicio, inicio + size)), view.getUint32(offset + 14, true))
    partes.set(new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + nombre)), new TextDecoder().decode(bytes.slice(inicio, inicio + size)))
    offset = inicio + size
  }
  return partes
}
const resultados = [
  { punto: { nombre: 'AIMSU' }, parametro: { nombre: 'Turbidez', unidad: 'NTU' }, valor: 20.125,
    limite_min_aplicado: 0, limite_max_aplicado: 25, fuera_norma: false },
  { punto: { nombre: '=1+1 & <prueba>' }, parametro: { nombre: 'Color', unidad: null }, valor: 78,
    limite_min_aplicado: null, limite_max_aplicado: 70, fuera_norma: true },
  { punto: { nombre: 'Sin límite' }, parametro: { nombre: 'Color', unidad: null }, valor: 0,
    limite_min_aplicado: null, limite_max_aplicado: null, fuera_norma: null },
]

test('Excel de Calidad: una tabla sin títulos, con números, unidades, límites y texto seguro', () => {
  const partes = archivos(crearXlsxReporte([hojaResultadosCalidad(resultados)]))
  const hoja = partes.get('xl/worksheets/sheet1.xml')
  assert.equal([...partes.keys()].filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).length, 1)
  assert.match(hoja, /<row r="1"[^>]*><c r="A1"[^>]*>.*Punto/)
  assert.match(hoja, /<c r="C2"[^>]*><v>20\.125<\/v>/)
  assert.match(hoja, /Turbidez \(NTU\)/)
  assert.match(hoja, /≥ 0 · ≤ 25/)
  assert.match(hoja, /=1\+1 &amp; &lt;prueba&gt;/)
  assert.match(hoja, /<autoFilter ref="A1:E4"/)
  assert.doesNotMatch(hoja, /<pane\b/)
  assert.doesNotMatch(hoja, /<mergeCells|<f[ >]/)
  const filtrada = archivos(crearXlsxReporte([hojaResultadosCalidad(resultados.filter(r => r.fuera_norma === true))])).get('xl/worksheets/sheet1.xml')
  assert.match(filtrada, /<autoFilter ref="A1:E2"/)
  assert.doesNotMatch(filtrada, /AIMSU/)
})

test('Excel existente conserva títulos y filtros; Calidad admite una tabla vacía', () => {
  const normal = archivos(crearXlsxReporte([{ nombre: 'Resumen', titulo: 'Título original', contexto: 'Periodo', columnas: ['Punto', 'Valor'], filas: [['A', 1]], congelar: true }])).get('xl/worksheets/sheet1.xml')
  assert.match(normal, /Título original/)
  assert.match(normal, /<autoFilter ref="A5:B6"/)
  assert.match(normal, /ySplit="5" topLeftCell="A6"/)
  assert.match(normal, /<mergeCells count="2">/)
  const vacia = archivos(crearXlsxReporte([hojaResultadosCalidad([])])).get('xl/worksheets/sheet1.xml')
  assert.match(vacia, /<autoFilter ref="A1:E1"/)
  assert.doesNotMatch(vacia, /<row r="2"/)
})
test('los resultados sin límites conservan su valor y exportan guiones sin clasificación',()=>{
 const hoja=hojaResultadosCalidad([{...resultados[2],parametro:{nombre:'SST',unidad:null},valor:2}])
 assert.deepEqual(hoja.filas[0].slice(2),[2,'—','—'])
})
test('exportar la hoja integrada identifica las filas adicionales con su hora',()=>{
 const original={...resultados[0],id:'original'},extra={...resultados[0],id:'adicional',valor:30}
 const hoja=hojaResultadosCalidad([original,extra],new Map([['adicional','Adicional · 12/11/2026, 11:30:00']]))
 assert.equal(hoja.filas.length,2)
 assert.doesNotMatch(hoja.filas[0][1],/Adicional/)
 assert.match(hoja.filas[1][1],/Adicional · 12\/11\/2026, 11:30:00/)
 assert.equal(hoja.filas[1][2],30)
})
