import { crearXlsxReporte, columnaExcel } from './xlsxReporte.ts'
import { nombreAreaTecnica, nombreTurnoTecnico, textoCeldaTecnica } from './consolidadoTecnico.ts'
import type { MatrizTecnica } from './consolidadoTecnico'

type Valor = string | number | null
const xml = (s: string) => Array.from(s).filter(c => c.charCodeAt(0) >= 32 || [9,10,13].includes(c.charCodeAt(0))).join('').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'

function decimal(s: string): string | null {
  const m = s.match(/^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/)
  if (!m || !(m[2] + (m[3] ?? '')).length) return null
  let digitos = (m[2] + (m[3] ?? '')).replace(/^0+/, ''), exp = Number(m[4] ?? 0) - (m[3]?.length ?? 0)
  if (!digitos) return '0'
  while (digitos.endsWith('0')) { digitos = digitos.slice(0, -1); exp++ }
  return `${m[1] === '-' ? '-' : ''}${digitos}e${exp}`
}
export function numeroExcelTecnico(s: string): string | number {
  const n = Number(s), canonico = decimal(s)
  // Excel dispone de 15 cifras significativas; la excepción conserva el texto
  // original en lugar de redondear una medición de mayor precisión.
  return canonico !== null && Number.isFinite(n) && canonico === decimal(String(n))
    && canonico.split('e')[0].replace('-', '').length <= 15 ? n : s
}

/** Fragmentos reversibles para que observaciones extensas no queden recortadas. */
export function fragmentosObservacion(s: string): string[] {
  const partes: string[] = []; let parte = '', columnas = 0, lineas = 0
  for (const caracter of s) {
    parte += caracter
    if (caracter === '\n' || ++columnas >= 30) { lineas++; columnas = 0 }
    if (lineas >= 18) { partes.push(parte); parte = ''; lineas = 0 }
  }
  if (parte || !partes.length) partes.push(parte)
  return partes
}

const estilos = `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="${ns}">
<fonts count="4"><font><sz val="10"/><name val="Arial"/><color rgb="FF172B4D"/></font><font><b/><sz val="15"/><name val="Arial"/><color rgb="FF002D72"/></font><font><b/><sz val="10"/><name val="Arial"/><color rgb="FF002D72"/></font><font><sz val="10"/><name val="Arial"/><color rgb="FF536581"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEDF3FB"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border/><border><left style="thin"><color rgb="FFD6DFEB"/></left><right style="thin"><color rgb="FFD6DFEB"/></right><top style="thin"><color rgb="FFD6DFEB"/></top><bottom style="thin"><color rgb="FFD6DFEB"/></bottom></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

// Reutiliza el paquete XLSX nativo existente. Solo sustituye la hoja y estilos
// de este archivo técnico; las exportaciones generales no se modifican.
function paqueteTecnico(base: Uint8Array, reemplazos: Record<string, string>): Uint8Array {
  const archivos: [Uint8Array, Uint8Array][] = [], lector = new DataView(base.buffer, base.byteOffset, base.byteLength), enc = new TextEncoder(), dec = new TextDecoder()
  for (let offset = 0; lector.getUint32(offset, true) === 0x04034b50;) {
    if (lector.getUint16(offset + 8, true) !== 0) throw new Error('El paquete XLSX usa una compresión no compatible.')
    const size = lector.getUint32(offset + 18, true), n = lector.getUint16(offset + 26, true), extra = lector.getUint16(offset + 28, true)
    const nombre = base.slice(offset + 30, offset + 30 + n), inicio = offset + 30 + n + extra
    archivos.push([nombre, dec.decode(nombre) in reemplazos ? enc.encode(reemplazos[dec.decode(nombre)]) : base.slice(inicio, inicio + size)])
    offset = inicio + size
  }
  const piezas: Uint8Array[] = [], centrales: Uint8Array[] = []; let offset = 0
  for (const [nombre, contenido] of archivos) {
    let crc = 0xffffffff
    for (const b of contenido) { crc ^= b; for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
    crc = (crc ^ 0xffffffff) >>> 0
    const cabecera = new Uint8Array(30 + nombre.length), v = new DataView(cabecera.buffer)
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(12, 33, true)
    v.setUint32(14, crc, true); v.setUint32(18, contenido.length, true); v.setUint32(22, contenido.length, true); v.setUint16(26, nombre.length, true); cabecera.set(nombre, 30)
    const central = new Uint8Array(46 + nombre.length), c = new DataView(central.buffer)
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(14, 33, true)
    c.setUint32(16, crc, true); c.setUint32(20, contenido.length, true); c.setUint32(24, contenido.length, true); c.setUint16(28, nombre.length, true); c.setUint32(42, offset, true); central.set(nombre, 46)
    piezas.push(cabecera, contenido); centrales.push(central); offset += cabecera.length + contenido.length
  }
  const size = centrales.reduce((s, c) => s + c.length, 0), fin = new Uint8Array(22), e = new DataView(fin.buffer)
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, archivos.length, true); e.setUint16(10, archivos.length, true); e.setUint32(12, size, true); e.setUint32(16, offset, true)
  const resultado = new Uint8Array(offset + size + 22); let posicion = 0
  for (const pieza of [...piezas, ...centrales, fin]) { resultado.set(pieza, posicion); posicion += pieza.length }
  return resultado
}

export function crearXlsxTecnicoDiario(matriz: MatrizTecnica): Uint8Array {
  const filas: { valores: Valor[]; estilos?: number[]; altura?: number }[] = [], merges: string[] = []
  const agregar = (valores: Valor[], estilosFila?: number[], altura?: number) => filas.push({ valores, estilos:estilosFila, altura })
  const completa = (texto: string, estilo = 2, altura?: number) => {
    agregar([texto, null, null], [estilo,estilo,estilo], altura)
    merges.push(`A${filas.length}:C${filas.length}`)
  }
  const parrafo = (texto: string, estilo = 0) => {
    for (const parte of fragmentosObservacion(texto)) completa(parte, estilo)
  }
  const fecha = matriz.fecha.split('-').reverse().join('/')
  const seleccionados = matriz.columnas.filter(c => c.estado === 'seleccionado')
  completa('COPAMEX · Reportes técnicos', 1, 30)
  completa(`${nombreAreaTecnica(matriz.area)} · Fecha operativa: ${fecha}`, 2, 24)
  completa(`Turnos seleccionados: ${seleccionados.map(c => nombreTurnoTecnico[c.turno]).join(', ')}`, 0)
  const ausentes = matriz.columnas.filter(c => c.estado !== 'seleccionado')
  if (ausentes.length) completa(ausentes.map(c => `${nombreTurnoTecnico[c.turno]}: ${c.estado === 'sin_reporte' ? 'Sin reporte' : 'No seleccionado'}`).join(' · '), 6)
  for (const columna of seleccionados) {
    const posicion = matriz.columnas.indexOf(columna)
    completa(`Turno ${nombreTurnoTecnico[columna.turno]}`, 1, 28)
    completa(`Operador: ${columna.operador}`)
    completa(`Fecha operativa: ${fecha} · Captura: ${columna.captura} (México)`, 0)
    completa(`Revisión ${columna.revision} · Formato ${columna.formato}`, 0)
    for (const seccion of [...new Set(matriz.filas.map(f => f.seccion))]) {
      const campos = matriz.filas.filter(f => f.seccion === seccion && f.celdas[posicion].estado !== 'no_capturado')
      if (!campos.length) continue
      completa(seccion, 2, 24)
      const tabla = campos.filter(f => f.tipo !== 'texto')
      if (tabla.length) {
        agregar(['Medición / equipo', 'Valor / estado', 'Unidad'], [4,4,4], 24)
        for (const campo of tabla) {
          const celda = campo.celdas[posicion]
          const valor = campo.tipo === 'medicion' && celda.estado === 'dato' ? numeroExcelTecnico(celda.valor) : textoCeldaTecnica(celda)
          agregar([campo.parametro, valor, celda.unidad], [0,typeof valor === 'number' ? 5 : celda.estado === 'dato' ? 0 : 6,0])
        }
      }
      for (const campo of campos.filter(f => f.tipo === 'texto')) parrafo(`${campo.parametro}: ${textoCeldaTecnica(campo.celdas[posicion])}`)
    }
    if (matriz.area === 'calderas' && columna.formato === 1) parrafo('Formato histórico 1: servicio de agua potable y pozos no capturado. Unidades originales, sin conversiones.', 6)
    parrafo(`Reporte: ${columna.reporteId} · Turno: ${columna.turnoId}\nAutor: ${columna.autorId}`, 6)
  }
  const anchos = [62,32,17]
  const sheetData = filas.map((f,i) => {
    const fusionada = merges.includes(`A${i+1}:C${i+1}`)
    const alto = f.altura ?? Math.min(409, Math.max(24, ...f.valores.map((v,j) => typeof v === 'string' ? v.split('\n').reduce((s,linea) => s + Math.max(1,Math.ceil(linea.length / ((fusionada ? 105 : anchos[j])-4))),0)*13+8 : 24)))
    return `<row r="${i+1}" ht="${alto}" customHeight="1">${f.valores.map((v,j) => {
      const r = `${columnaExcel(j)}${i+1}`, estilo = f.estilos?.[j] ?? 0
      return v === null ? `<c r="${r}" s="${estilo}"/>` : typeof v === 'number' ? `<c r="${r}" s="${estilo}"><v>${v}</v></c>` : `<c r="${r}" s="${estilo}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`
    }).join('')}</row>`
  }).join('')
  const hoja = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${ns}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:C${filas.length}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="24"/><cols>${anchos.map((w,i) => `<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${sheetData}</sheetData><mergeCells count="${merges.length}">${merges.map(r => `<mergeCell ref="${r}"/>`).join('')}</mergeCells><printOptions horizontalCentered="1"/><pageMargins left="0.4" right="0.4" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup orientation="portrait" paperSize="9" fitToWidth="1" fitToHeight="0"/></worksheet>`
  const libro = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="Consolidado" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">'Consolidado'!$1:$3</definedName><definedName name="_xlnm.Print_Area" localSheetId="0">'Consolidado'!$A$1:$C$${filas.length}</definedName></definedNames></workbook>`
  const base = crearXlsxReporte([{ nombre:'Consolidado', titulo:'', contexto:'', columnas:['Medición / equipo', 'Valor / estado', 'Unidad'], filas:[] }])
  return paqueteTecnico(base, { 'xl/worksheets/sheet1.xml':hoja, 'xl/styles.xml':estilos, 'xl/workbook.xml':libro })
}
