import { crearXlsxReporte, columnaExcel } from './xlsxReporte'
import { fragmentosTextoCalidad, limiteColumnaCalidad, nombresTurnoCalidad, operadoresCalidad } from './matrizCalidadDiaria'
import type { MatrizCalidadDiaria } from './matrizCalidadDiaria'

const xml = (s: string) => Array.from(s).filter(c => c.charCodeAt(0) >= 32 || '\n\t\r'.includes(c)).join('').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'

function sustituirXml(base: Uint8Array, reemplazos: Record<string, string | Uint8Array>): Uint8Array {
  const enc = new TextEncoder(), dec = new TextDecoder(), v = new DataView(base.buffer, base.byteOffset, base.byteLength)
  const archivos: { nombre: Uint8Array; datos: Uint8Array }[] = []
  const incluidos = new Set<string>()
  for (let o = 0; v.getUint32(o, true) === 0x04034b50;) {
    if (v.getUint16(o + 8, true) !== 0) throw new Error('Paquete Excel no compatible.')
    const n = v.getUint16(o + 26, true), e = v.getUint16(o + 28, true), size = v.getUint32(o + 18, true), ini = o + 30 + n + e
    const nombre = base.slice(o + 30, o + 30 + n), ruta = dec.decode(nombre)
    const reemplazo = reemplazos[ruta]
    archivos.push({ nombre, datos: reemplazo === undefined ? base.slice(ini, ini + size) : typeof reemplazo === 'string' ? enc.encode(reemplazo) : reemplazo })
    incluidos.add(ruta)
    o = ini + size
  }
  for (const [ruta, datos] of Object.entries(reemplazos)) if (!incluidos.has(ruta)) archivos.push({ nombre: enc.encode(ruta), datos: typeof datos === 'string' ? enc.encode(datos) : datos })
  const partes: Uint8Array[] = [], centros: Uint8Array[] = []
  let offset = 0
  for (const { nombre, datos } of archivos) {
    let crc = 0xffffffff
    for (const b of datos) { crc ^= b; for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
    crc = (crc ^ 0xffffffff) >>> 0
    const h = new Uint8Array(30 + nombre.length), a = new DataView(h.buffer)
    a.setUint32(0, 0x04034b50, true); a.setUint16(4, 20, true); a.setUint16(6, 0x0800, true); a.setUint16(12, 33, true); a.setUint32(14, crc, true); a.setUint32(18, datos.length, true); a.setUint32(22, datos.length, true); a.setUint16(26, nombre.length, true); h.set(nombre, 30)
    const c = new Uint8Array(46 + nombre.length), d = new DataView(c.buffer)
    d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x0800, true); d.setUint16(14, 33, true); d.setUint32(16, crc, true); d.setUint32(20, datos.length, true); d.setUint32(24, datos.length, true); d.setUint16(28, nombre.length, true); d.setUint32(42, offset, true); c.set(nombre, 46)
    partes.push(h, datos); centros.push(c); offset += h.length + datos.length
  }
  const size = centros.reduce((s, c) => s + c.length, 0), fin = new Uint8Array(22), f = new DataView(fin.buffer)
  f.setUint32(0, 0x06054b50, true); f.setUint16(8, archivos.length, true); f.setUint16(10, archivos.length, true); f.setUint32(12, size, true); f.setUint32(16, offset, true)
  const salida = new Uint8Array(offset + size + 22)
  let i = 0
  for (const p of [...partes, ...centros, fin]) { salida.set(p, i); i += p.length }
  return salida
}

const estilos =
  '<styleSheet xmlns="' + ns + '">' +
  '<fonts count="4"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="14"/><name val="Arial"/><color rgb="FFFFFFFF"/></font><font><b/><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/><color rgb="FFFFFFFF"/></font></fonts>' +
  '<fills count="11"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FF12376A"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FF174783"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FF205A9B"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FF2869AA"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FF174783"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FF205A9B"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFEAF1FB"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFEAF1FB"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFEAF1FB"/></patternFill></fill></fills>' +
  '<borders count="2"><border/><border><left style="thin"><color rgb="FF808080"/></left><right style="thin"><color rgb="FF808080"/></right><top style="thin"><color rgb="FF808080"/></top><bottom style="thin"><color rgb="FF808080"/></bottom></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="14">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
  '<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
  '<xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
  '<xf numFmtId="0" fontId="3" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
  '<xf numFmtId="0" fontId="3" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
  '<xf numFmtId="0" fontId="3" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
  '<xf numFmtId="0" fontId="3" fillId="7" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
  '<xf numFmtId="0" fontId="3" fillId="8" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
  '<xf numFmtId="0" fontId="2" fillId="10" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
  '<xf numFmtId="0" fontId="2" fillId="9" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
  '<xf numFmtId="0" fontId="2" fillId="9" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>' +
  '<xf numFmtId="0" fontId="3" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
  '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'

const punto = {
  aimsu: '20000000-0000-4000-8000-000000000001',
  pozo: '20000000-0000-4000-8000-000000000002',
  m2: '20000000-0000-4000-8000-000000000003',
  m4: '20000000-0000-4000-8000-000000000004',
  calderas: '20000000-0000-4000-8000-000000000005',
  pemex: '20000000-0000-4000-8000-000000000006',
  retorno: '20000000-0000-4000-8000-000000000007',
} as const

const plantilla = [
  { puntoId: punto.aimsu, punto: 'AIMSU', parametro: 'Color', limite: '≤ 300' },
  { puntoId: punto.aimsu, punto: 'AIMSU', parametro: 'Turbidez', limite: '≤ 25' },
  { puntoId: punto.m2, punto: 'Pila M-2', parametro: 'Color', limite: '≤ 250' },
  { puntoId: punto.m2, punto: 'Pila M-2', parametro: 'Turbidez', limite: '—' },
  { puntoId: punto.m2, punto: 'Pila M-2', parametro: 'SST', limite: '—' },
  { puntoId: punto.calderas, punto: 'Pila Calderas', parametro: 'Color', limite: '≤ 70' },
  { puntoId: punto.pozo, punto: 'Pozo', parametro: 'Color', limite: '≤ 100' },
  { puntoId: punto.m4, punto: 'Pila M-4', parametro: 'Color', limite: '≤ 250' },
  { puntoId: punto.m4, punto: 'Pila M-4', parametro: 'Turbidez', limite: '—' },
  { puntoId: punto.m4, punto: 'Pila M-4', parametro: 'SST', limite: '—' },
  { puntoId: punto.pemex, punto: 'PEMEX', parametro: 'Color', limite: '≤ 250' },
  { puntoId: punto.retorno, punto: 'Retorno TQE Almacén', parametro: 'Color', limite: '≤ 500' },
] as const

const grupos = [
  { titulo: 'AIMSU', inicio: 2, fin: 3, estilo: 2 },
  { titulo: 'PILA MAQ. 2', inicio: 4, fin: 6, estilo: 3 },
  { titulo: 'Calderas', inicio: 7, fin: 7, estilo: 4 },
  { titulo: 'Pozo', inicio: 8, fin: 8, estilo: 4 },
  { titulo: 'PILA MAQ.4', inicio: 9, fin: 11, estilo: 6 },
  { titulo: 'PEMEX', inicio: 12, fin: 12, estilo: 7 },
  { titulo: 'RET.BBAS VACIO', inicio: 13, fin: 13, estilo: 13 },
] as const

const gruposMeses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const mesExcel = (fecha: string) => {
  const [anio, mes] = fecha.split('-')
  return (gruposMeses[Number(mes) - 1] ?? mes) + '-' + (anio ?? '').slice(-2)
}
const horaExcel = (hora: string) => {
  const [horas, minutos = '00', segundos] = hora.split(':')
  const hora24 = Number(horas)
  const hora12 = String(hora24 % 12 || 12).padStart(2, '0')
  return hora12 + ':' + minutos + (segundos ? ':' + segundos : '') + ' ' + (hora24 < 12 ? 'a. m.' : 'p. m.')
}
const normalizar = (texto: string) => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '')

export function crearXlsxCalidadDiaria(m: MatrizCalidadDiaria): Uint8Array {
  const cantidadColumnas = plantilla.length + 2
  const ultima = columnaExcel(cantidadColumnas - 1)
  const filas: string[] = [], uniones: string[] = []
  const reemplazos: Record<string, string | Uint8Array> = { 'xl/styles.xml': estilos }
  let fila = 0

  const agregar = (valores: (string | number | null)[], estilo: number | number[] = 0, alto = 26) => {
    fila++
    filas.push('<row r="' + fila + '" ht="' + alto + '" customHeight="1">' + Array.from({ length: cantidadColumnas }, (_, indiceColumna) => {
      const valor = valores[indiceColumna] ?? null
      const estiloCelda = Array.isArray(estilo) ? estilo[indiceColumna] ?? 0 : estilo
      const referencia = columnaExcel(indiceColumna) + fila
      if (valor === null) return '<c r="' + referencia + '" s="' + estiloCelda + '"/>'
      if (typeof valor === 'number') {
        if (String(valor).replace(/[eE].*$/, '').replace(/[^0-9]/g, '').replace(/^0+/, '').length > 15) {
          return '<c r="' + referencia + '" s="' + estiloCelda + '" t="inlineStr"><is><t>' + xml(String(valor)) + '</t></is></c>'
        }
        return '<c r="' + referencia + '" s="' + estiloCelda + '"><v>' + valor + '</v></c>'
      }
      if (valor.length > 32767) throw new Error('Un texto supera la capacidad de una celda de Excel.')
      return '<c r="' + referencia + '" s="' + estiloCelda + '" t="inlineStr"><is><t xml:space="preserve">' + xml(valor) + '</t></is></c>'
    }).join('') + '</row>')
  }

  const banda = (texto: string) => {
    for (const parte of fragmentosTextoCalidad(texto)) {
      agregar([parte], 12, Math.max(26, Math.max(parte.split('\n').length, Math.ceil(parte.length / 100)) * 14 + 12))
      uniones.push('A' + fila + ':' + ultima + fila)
    }
  }

  const encabezadoGrupo: (string | number | null)[] = Array(cantidadColumnas).fill(null)
  encabezadoGrupo[0] = mesExcel(m.fecha)
  const estilosGrupo = Array(cantidadColumnas).fill(1) as number[]
  for (const grupo of grupos) {
    encabezadoGrupo[grupo.inicio] = grupo.titulo
    for (let columna = grupo.inicio; columna <= grupo.fin; columna++) estilosGrupo[columna] = grupo.estilo
    if (grupo.fin > grupo.inicio) uniones.push(columnaExcel(grupo.inicio) + '1:' + columnaExcel(grupo.fin) + '1')
  }
  agregar(encabezadoGrupo, estilosGrupo, 32)
  uniones.push('A1:B1')

  agregar(['Día', 'Hora', ...plantilla.map(columna => columna.parametro.toUpperCase())],
    [10, 10, ...plantilla.map(() => 10)], 26)
  agregar(['', '', ...plantilla.map(columna => {
    const aplicados = m.columnas
      .filter(origen => origen.puntoId === columna.puntoId && normalizar(origen.parametro) === normalizar(columna.parametro))
      .map(limiteColumnaCalidad)
    return aplicados.length ? [...new Set(aplicados)].join(' / ') : columna.limite
  })], [11, 11, ...plantilla.map(() => 11)], 25)
  uniones.push('A2:A3', 'B2:B3')

  const filasDia = m.turnos.flatMap((turno, ordenTurno) => turno.filas.map(registro => ({
    registro,
    ordenTurno,
  }))).sort((a, b) => a.registro.fechaLocal.localeCompare(b.registro.fechaLocal)
    || a.registro.hora.localeCompare(b.registro.hora) || a.ordenTurno - b.ordenTurno)

  let inicioDia = fila + 1
  for (let indiceFila = 0; indiceFila < filasDia.length; indiceFila++) {
    const registro = filasDia[indiceFila].registro
    const anterior = filasDia[indiceFila - 1]?.registro
    const mediciones = plantilla.map(columna => {
      const valores = m.columnas.flatMap((origen, indice) =>
        origen.puntoId === columna.puntoId && normalizar(origen.parametro) === normalizar(columna.parametro)
          && registro.valores[indice] !== null ? [registro.valores[indice]!] : [])
      if (!valores.length) return null
      return valores.length === 1 ? valores[0] : valores.map(String).join(' / ')
    })
    agregar([anterior?.fechaLocal === registro.fechaLocal ? null : Number(registro.dia), horaExcel(registro.hora), ...mediciones])
    const siguiente = filasDia[indiceFila + 1]?.registro
    if (!siguiente || siguiente.fechaLocal !== registro.fechaLocal) {
      if (fila > inicioDia) uniones.push('A' + inicioDia + ':A' + fila)
      inicioDia = fila + 1
    }
  }

  for (const turno of m.turnos) {
    if (!turno.filas.length) banda(nombresTurnoCalidad[turno.tipo] + ': Sin muestras')
    else {
      banda('COMENTARIOS · TURNO ' + nombresTurnoCalidad[turno.tipo].toUpperCase())
      const notas = turno.filas.filter(registro => registro.notas)
      if (!notas.length) banda('Sin comentarios registrados.')
      for (const registro of notas) banda(registro.hora + ' · ' + registro.notas)
    }
    banda('OPERADORES · TURNO ' + nombresTurnoCalidad[turno.tipo].toUpperCase())
    if (!turno.filas.length) banda('Sin muestras')
    for (const operador of operadoresCalidad(turno)) banda(operador)
  }

  const columnasXml = '<col min="1" max="1" width="9" customWidth="1"/><col min="2" max="2" width="18" customWidth="1"/>'
    + '<col min="3" max="' + cantidadColumnas + '" width="13" customWidth="1"/>'
  reemplazos['xl/worksheets/sheet1.xml'] =
    '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="' + ns + '" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:' + ultima + fila + '"/>'
    + '<sheetViews><sheetView workbookViewId="0"><pane xSplit="2" ySplit="3" topLeftCell="C4" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="C4" sqref="C4"/></sheetView></sheetViews>'
    + '<sheetFormatPr defaultRowHeight="26"/><cols>' + columnasXml + '</cols><sheetData>' + filas.join('') + '</sheetData>'
    + '<mergeCells count="' + uniones.length + '">' + uniones.map(ref => '<mergeCell ref="' + ref + '"/>').join('') + '</mergeCells>'
    + '<printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.15" footer="0.15"/>'
    + '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>'

  const base = crearXlsxReporte([{ nombre: 'Calidad', titulo: '', contexto: '', columnas: ['Día', 'Hora'], filas: [], congelar: false }])
  const texto = new TextDecoder().decode(base)
  const inicio = texto.indexOf('<?xml version="1.0"?><workbook ')
  const fin = texto.indexOf('</workbook>', inicio)
  if (inicio < 0 || fin < 0) throw new Error('No se pudo preparar el libro de Calidad.')
  reemplazos['xl/workbook.xml'] = texto.slice(inicio, fin + 11)
    .replace('<calcPr', '<definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">\'Calidad\'!$1:$3</definedName></definedNames><calcPr')
  return sustituirXml(base, reemplazos)
}
