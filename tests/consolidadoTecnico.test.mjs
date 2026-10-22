// Datos simulados exclusivamente para pruebas; no consulta ni escribe Supabase.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { crc32 } from 'node:zlib'
import { agruparTecnicos, datosTecnico, seleccionarTecnicos, validarConsolidado, matrizTecnicoDiario, textoCeldaTecnica } from '../src/lib/consolidadoTecnico.ts'
import { crearXlsxTecnicoDiario, fragmentosObservacion, numeroExcelTecnico } from '../src/lib/xlsxTecnicoDiario.ts'
import { crearPdfTecnicoDiario } from '../src/lib/pdfTecnicoDiario.ts'
import { descargarTecnicoDiario, descargarPdfTecnicoDiario } from '../src/lib/exportarTecnicoDiario.ts'
import { borradorBitacoraCalderas, equiposCalderas, pilasCalderas } from '../src/lib/tiposBitacoraCalderas.ts'
import { borradorBitacoraPTAR, medicionesBitacoraPTAR } from '../src/lib/tiposBitacoraPTAR.ts'

const fecha = '2026-10-19'
const fuente = fs.readFileSync(new URL('../src/assets/fuentes/DejaVuSans.ttf', import.meta.url))
const crearMatriz = (detalles, disponibles = detalles.map(d => d.fila.turno)) => matrizTecnicoDiario(fecha, detalles[0]?.area ?? 'calderas', detalles, disponibles)
function fila(turno, area = 'calderas') {
  return { id: `reporte-${area}-${turno}`, turnoId: `turno-${area}-${turno}`, area, turno, fechaOperativa: fecha,
    operador: `Operador <${turno}>`, creadoEn: '2026-10-20T08:00:00Z', revision: 2 }
}
function detalle(turno, area = 'calderas', version = 2) {
  const resumen = fila(turno, area), borrador = area === 'calderas' ? borradorBitacoraCalderas() : borradorBitacoraPTAR()
  borrador.reporteRelevante = 'Nota completa\nSegunda línea <script>alert(1)</script>'
  for (const [i, campo] of Object.keys(borrador.mediciones).entries()) borrador.mediciones[campo] = `${i + 1}.1234`
  if (area === 'calderas') {
    for (const e of equiposCalderas) borrador.equipos[e.id] = { estado: 'Servicio', presion: e.id.startsWith('sulzer_') ? '1.234567890123456789' : '' }
    for (const p of pilasCalderas) borrador.pilas[p.id] = { nivel: '75', bomba: '=1+1', presion: '2.5' }
    borrador.compresores['1'] = 'Preparado'; borrador.estadoUF = 'Lavado'
    borrador.comentariosUF = 'Observación UF completa'; borrador.servicioAgua.norte = true
  } else {
    borrador.bombas['9'] = 'Manual (M)'; borrador.prensas.Essity = 'Reserva'
    borrador.estadoAgitador = 'Servicio'; borrador.destinoDescarga = 'Tanque 11'
    borrador.comentarioPrensas = 'Motivo de paro\nTexto conservado'
  }
  return { area, fila: resumen, reporte: { id: resumen.id, turnoId: resumen.turnoId, cuentaId: 'autor-prueba', creadoEn: resumen.creadoEn,
    revision: 2, borrador, ...(area === 'calderas' ? { versionFormato: version, unidadCondensado: version === 1 ? 'PSI' : 'kg/cm²' } : {}) } }
}

test('agrupa Noche por fecha operativa aunque la captura cruce medianoche', () => {
  const dias = agruparTecnicos(fecha, '2026-10-20', [fila('noche')])
  assert.equal(dias[0].fecha, '2026-10-20')
  assert.deepEqual(dias[0].calderas, {})
  assert.equal(dias[1].calderas.noche.turno, 'noche')
})
test('día incompleto: solo se seleccionan turnos disponibles del área', () => {
  const [dia] = agruparTecnicos(fecha, fecha, [fila('dia'), fila('noche'), fila('tarde', 'ptar')])
  assert.deepEqual(seleccionarTecnicos(dia, 'calderas', ['dia', 'tarde', 'noche']).map(f => f.turno), ['dia', 'noche'])
  assert.deepEqual(seleccionarTecnicos(dia, 'ptar', ['dia', 'tarde', 'noche']).map(f => f.turno), ['tarde'])
  assert.deepEqual(seleccionarTecnicos(dia, 'calderas', []), [])
  assert.throws(() => crearMatriz([]), /al menos un turno/)
})
test('un día sin reportes conserva disponibilidad vacía; no fabrica datos', () => {
  const [dia] = agruparTecnicos(fecha, fecha, [])
  assert.deepEqual(dia, { fecha, calderas: {}, ptar: {} })
  assert.throws(() => agruparTecnicos('2026-02-31', '2026-03-03', []), /válidas/)
})
test('día completo: tres turnos disponibles; selección individual y total', () => {
  const [dia] = agruparTecnicos(fecha, fecha, ['dia', 'tarde', 'noche'].map(t => fila(t)))
  assert.equal(seleccionarTecnicos(dia, 'calderas', ['dia', 'tarde', 'noche']).length, 3)
  assert.deepEqual(crearMatriz(['dia', 'tarde', 'noche'].map(t => detalle(t))).columnas.map(c => c.estado), ['seleccionado', 'seleccionado', 'seleccionado'])
  assert.deepEqual(crearMatriz([detalle('noche', 'ptar')]).columnas.map(c => c.estado), ['sin_reporte', 'sin_reporte', 'seleccionado'])
})
test('rechaza duplicados, mezcla de áreas, fechas y revisiones desactualizadas', () => {
  assert.throws(() => agruparTecnicos(fecha, fecha, [fila('dia'), fila('dia')]), /duplicados/)
  assert.throws(() => validarConsolidado(fecha, 'calderas', [detalle('dia'), detalle('tarde', 'ptar')]), /mezcla/)
  assert.throws(() => validarConsolidado('2026-10-20', 'calderas', [detalle('dia')]), /mezcla/)
  const cambiado = detalle('dia'); cambiado.reporte.revision++
  assert.throws(() => validarConsolidado(fecha, 'calderas', [cambiado]), /revisiones/)
})
test('Calderas conserva mediciones, equipos, pilas, observaciones y unidades por versión', () => {
  for (const version of [1, 2]) {
    const d = detalle('dia', 'calderas', version), datos = datosTecnico(d)
    assert.equal(datos.length, version === 1 ? 41 : 45)
    for (const valor of Object.values(d.reporte.borrador.mediciones)) assert.ok(datos.some(r => r.valor === valor), valor)
    assert.equal(datos.find(r => r.parametro === 'Sulzer 436 · Presión').unidad, version === 1 ? 'PSI' : 'kg/cm²')
    assert.equal(datos.find(r => r.parametro === 'Bomba de ósmosis 422 · Presión').unidad, 'PSI')
    assert.equal(datos.find(r => r.parametro === 'Reporte relevante').valor, d.reporte.borrador.reporteRelevante)
    assert.equal(datos.some(r => r.parametro === 'Bomba Norte'), version === 2)
    assert.ok(datos.some(r => r.valor === 'Observación UF completa'))
  }
})
test('PTAR conserva todas las mediciones, modos, estados y comentario de prensas', () => {
  const d = detalle('noche', 'ptar'), datos = datosTecnico(d)
  assert.equal(datos.length, 22)
  for (const m of medicionesBitacoraPTAR) {
    const r = datos.find(r => r.parametro === m.nombre)
    assert.equal(r.valor, d.reporte.borrador.mediciones[m.campo]); assert.equal(r.unidad, m.unidad)
  }
  assert.ok(datos.some(r => r.valor === 'Manual (M)'))
  assert.ok(datos.some(r => r.valor === 'Motivo de paro\nTexto conservado'))
})
function archivosXlsx(bytes) {
  const archivos = new Map(), lector = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let offset = 0; lector.getUint32(offset, true) === 0x04034b50;) {
    const size = lector.getUint32(offset + 18, true), nombre = lector.getUint16(offset + 26, true), extra = lector.getUint16(offset + 28, true)
    const inicio = offset + 30 + nombre + extra
    assert.equal(crc32(bytes.slice(inicio, inicio + size)), lector.getUint32(offset + 14, true), 'CRC de archivo XLSX')
    archivos.set(new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + nombre)), new TextDecoder().decode(bytes.slice(inicio, inicio + size)))
    offset = inicio + size
  }
  return archivos
}
test('Excel: una hoja vertical por bloques de turno, números y configuración de impresión', () => {
  const matriz = crearMatriz([detalle('noche'), detalle('dia')], ['dia','tarde','noche'])
  const archivos = archivosXlsx(crearXlsxTecnicoDiario(matriz)), hoja = archivos.get('xl/worksheets/sheet1.xml')
  assert.equal([...archivos.keys()].filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).length, 1)
  for (const valor of ['Día','Tarde','Noche','No seleccionado','1.234567890123456789','=1+1','COPAMEX · Reportes técnicos']) assert.ok(hoja.includes(valor), valor)
  assert.match(hoja, /<v>1\.1234<\/v>/)
  assert.match(hoja, /<v>2\.5<\/v>/)
  assert.match(hoja, /orientation="portrait"/)
  assert.match(hoja, /mergeCell/)
  assert.match(archivos.get('xl/workbook.xml'), /Print_Titles/)
  assert.match(archivos.get('xl/styles.xml'), /style="thin"/)
  assert.doesNotMatch(hoja, /<f>/)
})
test('tres estados distintos y cero conservado en la matriz y el XLSX', () => {
  const d = detalle('dia'); d.reporte.borrador.mediciones.nivel_condensado = '0'; d.reporte.borrador.mediciones.presion_432 = ''
  const m = crearMatriz([d], ['dia','tarde'])
  const cero = m.filas.find(f => f.parametro === 'Nivel del tanque de condensado')
  assert.equal(textoCeldaTecnica(cero.celdas[0]), '0')
  assert.equal(textoCeldaTecnica(cero.celdas[1]), 'No seleccionado')
  assert.equal(textoCeldaTecnica(cero.celdas[2]), 'Sin reporte')
  assert.equal(textoCeldaTecnica(m.filas.find(f => f.parametro === 'Bomba de condensado 432 · Presión').celdas[0]), 'Sin registrar')
  assert.match(archivosXlsx(crearXlsxTecnicoDiario(m)).get('xl/worksheets/sheet1.xml'), /<v>0<\/v>/)
  assert.equal(numeroExcelTecnico('0.00000000001'), 0.00000000001)
  assert.equal(numeroExcelTecnico('1234567890123456789'), '1234567890123456789')
})
test('formatos históricos comparados sin conversiones ni estados inferidos', () => {
  const m = crearMatriz([detalle('dia','calderas',1), detalle('tarde','calderas',2)], ['dia','tarde'])
  const presion = m.filas.find(f => f.parametro === 'Sulzer 436 · Presión')
  assert.equal(presion.unidad, 'Según turno')
  assert.equal(presion.celdas[0].unidad, 'PSI'); assert.equal(presion.celdas[1].unidad, 'kg/cm²')
  assert.equal(presion.celdas[0].valor, presion.celdas[1].valor)
  assert.equal(m.filas.find(f => f.parametro === 'Bomba Norte').celdas[0].estado, 'no_capturado')
  const hoja = archivosXlsx(crearXlsxTecnicoDiario(m)).get('xl/worksheets/sheet1.xml')
  assert.match(hoja, />PSI</); assert.match(hoja, />kg\/cm²</)
})
test('observaciones extensas se fragmentan sin pérdida y sin filas Excel recortadas', () => {
  const nota = 'Observación registrada: presión 2 kg/cm² → revisar.\n'.repeat(100)
  assert.equal(fragmentosObservacion(nota).join(''), nota)
  const d = detalle('noche','ptar'); d.reporte.borrador.comentarioPrensas = nota
  const hoja = archivosXlsx(crearXlsxTecnicoDiario(crearMatriz([d]))).get('xl/worksheets/sheet1.xml')
  assert.ok(hoja.includes("Observación registrada:")); assert.ok(hoja.includes("revisar."))
  assert.ok([...hoja.matchAll(/ht="([\d.]+)"/g)].every(m => Number(m[1]) < 409))
})
test('PDF real vertical: tablas por turno, encabezados repetidos y observaciones largas', () => {
  for (const area of ['calderas','ptar']) {
    const d = detalle('dia',area), n = detalle('noche',area)
    d.reporte.borrador.reporteRelevante = 'Observación: presión 2 kg/cm² → revisar.\n'.repeat(75) + 'FIN DE OBSERVACIÓN'
    const pdf = crearPdfTecnicoDiario(crearMatriz([d,n], ['dia','tarde','noche']), fuente.toString('base64'))
    const bytes = new Uint8Array(pdf.output('arraybuffer'))
    assert.equal(new TextDecoder().decode(bytes.slice(0,5)), '%PDF-')
    assert.ok(pdf.internal.pageSize.getWidth() < pdf.internal.pageSize.getHeight())
    assert.ok(pdf.getNumberOfPages() > 1)
    assert.match(pdf.output(), /ToUnicode/)
    assert.ok(textoPdf(pdf).join(' ').includes('FIN DE OBSERVACIÓN'))
    for (const pagina of textoPdf(pdf)) assert.ok(pagina.includes('COPAMEX · Reportes técnicos'))
    const textos = Object.values(pdf.getFont().metadata.toUnicode).map(v => String.fromCodePoint(v)).join('')
    for (const c of ['í','²','³','→']) if (area === 'calderas' || c !== '³') assert.ok(textos.includes(c), c)
    // Tablas y texto dentro del papel, sin desbordes fuera de las páginas.
    for (const pagina of pdf.internal.pages.slice(1)) {
      for (const m of pagina.join('\n').matchAll(/([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re\b/g)) {
        const [,xs,ys,ws,hs] = m, x = +xs, y = +ys, w = +ws, h = +hs
        assert.ok(x >= -0.1 && x+w <= 596, `ancho: ${x+w}`)
        assert.ok(Math.min(y,y+h) >= -0.1 && Math.max(y,y+h) <= 843, `alto: ${y},${h}`)
      }
    }
  }
})
function textoPdf(pdf) {
  const mapa = pdf.getFont().metadata.toUnicode
  return pdf.internal.pages.slice(1).map(pagina => [...pagina.join('\n').matchAll(/<([\da-f]+)>\s*Tj/gi)].map(m => {
    let texto = ''
    for (let i = 0; i < m[1].length; i += 4) texto += String.fromCodePoint(mapa[parseInt(m[1].slice(i,i+4),16)] ?? 32)
    return texto
  }).join(' '))
}

test('PDF histórico compara PSI y kg/cm² y conserva estados de selección', () => {
  const matriz = crearMatriz([detalle('dia','calderas',1),detalle('tarde','calderas',2)], ['dia','tarde','noche'])
  const pdf = crearPdfTecnicoDiario(matriz, fuente.toString('base64'))
  const texto = textoPdf(pdf).join(' ').replace(/\s+/g,' ')
  for (const esperado of ['PSI','kg/cm²','No seleccionado','servicio de agua potable y pozos no capturado']) assert.ok(texto.includes(esperado), esperado)
  assert.ok(!texto.includes('Operador <noche>'))
})

test('PDF y Excel reproducen el formato vertical de referencia con todos los campos y trazabilidad', () => {
  for (const area of ['calderas','ptar']) {
    const matriz = crearMatriz([detalle('dia',area),detalle('noche',area)], ['dia','tarde','noche'])
    const pdf = crearPdfTecnicoDiario(matriz, fuente.toString('base64'))
    const paginas = textoPdf(pdf), texto = paginas.join(' ').replace(/\s+/g,' ')
    const hoja = archivosXlsx(crearXlsxTecnicoDiario(matriz)).get('xl/worksheets/sheet1.xml')
    for (const esperado of ['Turno Día','Turno Noche','Medición / equipo','Valor / estado','Unidad', '20/10/2026', 'autor-prueba']) {
      assert.ok(texto.includes(esperado), esperado)
      assert.ok(hoja.includes(esperado), esperado)
    }
    assert.ok(texto.indexOf('Turno Día') < texto.indexOf('Turno Noche'))
    assert.ok(!paginas.some(p => p.includes('Turno Día') && p.includes('Turno Noche')), 'Turnos en páginas separadas')
    assert.doesNotMatch(hoja, /<c r="[DE]\d+"/)
    for (const fila of matriz.filas) {
      assert.ok(texto.includes(fila.parametro), fila.parametro)
      assert.ok(hoja.includes(fila.parametro.replaceAll('&','&amp;')), fila.parametro)
    }
  }
})
test('descarga directa PDF y XLSX: MIME correcto y ningún iframe o impresión', async t => {
  const blobs = [], enlaces = []
  t.mock.method(URL, 'createObjectURL', blob => { blobs.push(blob); return 'blob:prueba' })
  t.mock.method(URL, 'revokeObjectURL', () => {})
  t.mock.method(globalThis, 'fetch', async () => new Response(fuente))
  const documento = globalThis.document
  globalThis.document = { body:{ append() {} }, createElement(tag) { assert.equal(tag,'a'); const a = { click() {}, remove() {} }; enlaces.push(a); return a } }
  try {
    const d = detalle('dia'); let autorizaciones = 0
    descargarTecnicoDiario(fecha,'calderas',[d],['dia','noche'])
    await descargarPdfTecnicoDiario(fecha,'calderas',[d],['dia','noche'],() => { autorizaciones++ })
    assert.equal(blobs[0].type,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    assert.equal(blobs[1].type,'application/pdf')
    assert.match(enlaces[0].download,/\.xlsx$/); assert.match(enlaces[1].download,/\.pdf$/)
    assert.equal(new TextDecoder().decode((await blobs[1].arrayBuffer()).slice(0,5)), '%PDF-')
    assert.ok(autorizaciones >= 3)
    await assert.rejects(descargarPdfTecnicoDiario(fecha,'calderas',[d],['dia'],() => { throw new Error('Sesión cambiada') }), /Sesión cambiada/)
    assert.equal(blobs.length, 2, 'Una sesión no autorizada no descarga documentos')
  } finally { if (documento === undefined) delete globalThis.document; else globalThis.document = documento }
})
