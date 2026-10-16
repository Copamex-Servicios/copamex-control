// XLSX nativo: celdas tipadas, formatos, filtros y gráficos.
// No interpreta el texto de los operadores como fórmulas ni carga bibliotecas externas.
export type CeldaReporte = string | number | boolean | Date | null
export interface HojaReporte { nombre: string; titulo: string; contexto: string; columnas: string[]; filas: CeldaReporte[][]; graficas?: boolean; congelar?: boolean }
const xml = (s: string) => Array.from(s).filter(c => c.charCodeAt(0) >= 32 || [9, 10, 13].includes(c.charCodeAt(0))).join('').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
const enc = new TextEncoder()
export function columnaExcel(n: number): string { let s = ''; for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s }
function celda(v: CeldaReporte, referencia: string, encabezado = false, soloFecha = false, estiloTexto = 0): string {
  if (v === null) return `<c r="${referencia}"/>`
  if (v instanceof Date) return `<c r="${referencia}" s="${soloFecha ? 4 : 3}"><v>${v.getTime() / 86400000 + 25569}</v></c>`
  if (typeof v === 'number' && Number.isFinite(v) && String(v).replace(/[eE][+-]?\d+$/, '').replace(/[^\d]/g, '').replace(/^0+/, '').length <= 15) return `<c r="${referencia}" s="${Number.isInteger(v) ? 7 : 2}"><v>${v}</v></c>`
  if (typeof v === 'boolean') return `<c r="${referencia}" t="b"><v>${v ? 1 : 0}</v></c>`
  const texto = String(v)
  if (texto.length > 32767) throw new Error('Un texto excede el tamaño de celda de Excel. Revisa la captura antes de exportar.')
  return `<c r="${referencia}" s="${encabezado ? 1 : estiloTexto}" t="inlineStr"><is><t xml:space="preserve">${xml(texto)}</t></is></c>`
}
function anchoColumna(c: string): number {
  return /UUID|UTC|cuenta/i.test(c) ? 38 : /texto|nota|mensaje|antes|despu[eé]s|observaci[oó]n|contexto/i.test(c) ? 55
    : /operador|punto|medici[oó]n|indicador/i.test(c) ? 30 : /fecha|hora|M[eé]xico/i.test(c) ? 23
      : /[aá]rea|turno|unidad|valor|m[ií]nimo|m[aá]ximo/i.test(c) ? 17 : 22
}
function alturaFila(h: HojaReporte, f: CeldaReporte[]): number {
  return Math.min(409, Math.max(26, ...f.map((v, c) => typeof v === 'string' ? Math.ceil(v.length / Math.max(12, anchoColumna(h.columnas[c] ?? '') - 3)) * 15 + 8 : 26)))
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const b of bytes) { crc ^= b; for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
  return (crc ^ 0xffffffff) >>> 0
}
function zip(archivos: [string, string][]): Uint8Array {
  const piezas: Uint8Array[] = [], centrales: Uint8Array[] = []; let offset = 0
  for (const [ruta, contenido] of archivos) {
    const nombre = enc.encode(ruta), bytes = enc.encode(contenido), crc = crc32(bytes), cabecera = new Uint8Array(30 + nombre.length), v = new DataView(cabecera.buffer)
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(12, 33, true); v.setUint32(14, crc, true); v.setUint32(18, bytes.length, true); v.setUint32(22, bytes.length, true); v.setUint16(26, nombre.length, true); cabecera.set(nombre, 30)
    const central = new Uint8Array(46 + nombre.length), c = new DataView(central.buffer)
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(14, 33, true); c.setUint32(16, crc, true); c.setUint32(20, bytes.length, true); c.setUint32(24, bytes.length, true); c.setUint16(28, nombre.length, true); c.setUint32(42, offset, true); central.set(nombre, 46)
    piezas.push(cabecera, bytes); centrales.push(central); offset += cabecera.length + bytes.length
  }
  const size = centrales.reduce((n, c) => n + c.length, 0), fin = new Uint8Array(22), e = new DataView(fin.buffer)
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, archivos.length, true); e.setUint16(10, archivos.length, true); e.setUint32(12, size, true); e.setUint32(16, offset, true)
  const resultado = new Uint8Array(offset + size + fin.length); let i = 0
  for (const p of [...piezas, ...centrales, fin]) { resultado.set(p, i); i += p.length }
  return resultado
}
const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
function chart(hoja: HojaReporte, columnas: number[], titulo: string, unidad: string): string {
  const colores = ['1765C1', '008B7A', 'CF8500']
  const nombres: Record<number, string> = { 3: 'Pozo 1', 4: 'Pozo 2', 5: 'Alimentado', 6: 'Aceptado', 7: 'Rechazo' }
  const textoEje = '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1100"><a:solidFill><a:srgbClr val="334155"/></a:solidFill><a:latin typeface="Segoe UI"/></a:defRPr></a:pPr><a:endParaRPr lang="es-MX"/></a:p></c:txPr>'
  const salto = Math.max(1, Math.ceil(hoja.filas.length / 10))
  const categorias = hoja.filas.map((f, i) => {
    const fecha = f[0] instanceof Date ? `${String(f[0].getUTCDate()).padStart(2, '0')}/${String(f[0].getUTCMonth() + 1).padStart(2, '0')}/${f[0].getUTCFullYear()}` : String(f[0] ?? '')
    return `<c:pt idx="${i}"><c:v>${xml(fecha)}</c:v></c:pt>`
  }).join('')
  const series = columnas.map((col, index) => {
    const letra = columnaExcel(col), fin = hoja.filas.length + 5
    const cache = hoja.filas.map((f, i) => f[col] === null ? '' : `<c:pt idx="${i}"><c:v>${f[col]}</c:v></c:pt>`).join('')
    return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:v>${xml(nombres[col] ?? hoja.columnas[col])}</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="${colores[index]}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr><c:cat><c:strLit><c:ptCount val="${hoja.filas.length}"/>${categorias}</c:strLit></c:cat><c:val><c:numRef><c:f>'${xml(hoja.nombre)}'!$${letra}$6:$${letra}$${fin}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${hoja.filas.length}"/>${cache}</c:numCache></c:numRef></c:val></c:ser>`
  }).join('')
  const tituloXML = (texto: string) => `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="es-MX" sz="1500" b="1"><a:solidFill><a:srgbClr val="002D72"/></a:solidFill><a:latin typeface="Segoe UI"/></a:rPr><a:t>${xml(texto)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`
  const etiquetas = hoja.filas.length <= 10 ? `<c:dLbls><c:numFmt formatCode="General" sourceLinked="0"/>${textoEje}<c:dLblPos val="outEnd"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/></c:dLbls>` : ''
  const inicioCero = hoja.filas.some(f => columnas.some(c => typeof f[c] === 'number' && (f[c] as number) < 0)) ? '' : '<c:min val="0"/>'
  return `<?xml version="1.0" encoding="UTF-8"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart>${tituloXML(`${titulo} (${unidad})`)}<c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${series}${etiquetas}<c:gapWidth val="100"/><c:overlap val="0"/><c:axId val="100"/><c:axId val="200"/></c:barChart><c:catAx><c:axId val="100"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:tickLblPos val="nextTo"/>${textoEje}<c:crossAx val="200"/><c:crosses val="autoZero"/><c:auto val="0"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:tickLblSkip val="${salto}"/><c:tickMarkSkip val="${salto}"/></c:catAx><c:valAx><c:axId val="200"/><c:scaling><c:orientation val="minMax"/>${inicioCero}</c:scaling><c:axPos val="l"/><c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E7EEF6"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="General" sourceLinked="0"/><c:tickLblPos val="nextTo"/>${textoEje}<c:crossAx val="100"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx></c:plotArea><c:legend><c:legendPos val="t"/><c:layout/><c:overlay val="0"/>${textoEje}</c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="CBD5E1"/></a:solidFill></a:ln></c:spPr></c:chartSpace>`
}
export function crearXlsxReporte(hojas: HojaReporte[]): Uint8Array {
  if (!hojas.length || new Set(hojas.map(h => h.nombre)).size !== hojas.length || hojas.some(h => Array.from(h.nombre).some(c => '\\/?*[]:'.includes(c)) || h.nombre.length > 31)) throw new Error('Nombres de hojas no válidos.')
  const archivos: [string, string][] = [], tipos: string[] = [], relaciones: string[] = []
  hojas.forEach((h, i) => {
    const rows = [`<row r="2" ht="30" customHeight="1">${celda(h.titulo, 'A2', false, false, 5)}</row>`, `<row r="3" ht="50" customHeight="1">${celda(h.contexto.replaceAll(';', ' ·'), 'A3', false, false, 6)}</row>`, `<row r="5" ht="40" customHeight="1">${h.columnas.map((v, c) => celda(v, `${columnaExcel(c)}5`, true)).join('')}</row>`, ...h.filas.map((f, j) => `<row r="${j + 6}" ht="${alturaFila(h, f)}" customHeight="1">${f.map((v, c) => celda(v, `${columnaExcel(c)}${j + 6}`, false, /^Fecha/.test(h.columnas[c] ?? ''))).join('')}</row>`)]
    const ultima = Math.max(5, h.filas.length + 5), cols = h.columnas.map((c, j) => `<col min="${j + 1}" max="${j + 1}" width="${anchoColumna(c)}" customWidth="1"/>`).join('')
    const dibujo = (h.graficas || h.nombre === 'Graficas') && hojas.some(x => x.nombre === 'Diario') ? '<drawing r:id="rId1"/>' : ''
    const finTitulo = columnaExcel(Math.min(4, h.columnas.length - 1))
    archivos.push([`xl/worksheets/sheet${i + 1}.xml`, `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${ns}" xmlns:r="${rel}"><dimension ref="A1:${columnaExcel(h.columnas.length - 1)}${ultima}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0">${h.congelar ? '<pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A6" sqref="A6"/>' : ''}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${cols}</cols><sheetData>${rows.join('')}</sheetData>${h.nombre === 'Graficas' ? '' : `<autoFilter ref="A5:${columnaExcel(h.columnas.length - 1)}${ultima}"/>`}<mergeCells count="2"><mergeCell ref="A2:${finTitulo}2"/><mergeCell ref="A3:${finTitulo}3"/></mergeCells><printOptions horizontalCentered="0"/><pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/>${dibujo}</worksheet>`])
    tipos.push(`<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    relaciones.push(`<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
  })
  const diario = hojas.find(h => h.nombre === 'Diario')
  const indiceGraficas = hojas.findIndex(h => h.graficas || h.nombre === 'Graficas')
  if (diario && indiceGraficas >= 0) {
    const hojaGraficas = hojas[indiceGraficas]
    const filaGraficas = hojaGraficas.nombre === 'Diario' ? diario.filas.length + 7 : 14
    archivos.push([`xl/worksheets/_rels/sheet${indiceGraficas + 1}.xml.rels`, `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`])
    archivos.push(['xl/drawings/drawing1.xml', `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${[1, 2].map((n, i) => `<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>228600</xdr:colOff><xdr:row>${filaGraficas + i * 18}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="8572500" cy="3429000"/><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${n}" name="Gráfica ${n}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${rel}" r:id="rId${n}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:oneCellAnchor>`).join('')}</xdr:wsDr>`])
    archivos.push(['xl/drawings/_rels/drawing1.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${[1, 2].map(n => `<Relationship Id="rId${n}" Type="${rel}/chart" Target="../charts/chart${n}.xml"/>`).join('')}</Relationships>`], ['xl/charts/chart1.xml', chart(diario, [3, 4], 'Consumo diario de Pozos', 'm³')], ['xl/charts/chart2.xml', chart(diario, [5, 6, 7], 'Balance diario de UF', 'm³')])
    tipos.push('<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>', ...[1, 2].map(n => `<Override PartName="/xl/charts/chart${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`))
  }
  archivos.push(['xl/styles.xml', `<?xml version="1.0"?><styleSheet xmlns="${ns}"><numFmts count="4"><numFmt numFmtId="164" formatCode="#,##0.###"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy hh:mm:ss"/><numFmt numFmtId="166" formatCode="dd/mm/yyyy"/><numFmt numFmtId="167" formatCode="#,##0"/></numFmts><fonts count="4"><font><sz val="11"/><name val="Segoe UI"/><color rgb="FF172B4D"/></font><font><sz val="11"/><name val="Segoe UI"/><b/><color rgb="FFFFFFFF"/></font><font><sz val="18"/><name val="Segoe UI"/><b/><color rgb="FF002D72"/></font><font><sz val="10"/><name val="Segoe UI"/><color rgb="FF526581"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF002D72"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><bottom style="thin"><color rgb="FFE7EEF6"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="167" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`])
  archivos.push(['xl/workbook.xml', `<?xml version="1.0"?><workbook xmlns="${ns}" xmlns:r="${rel}"><bookViews><workbookView/></bookViews><sheets>${hojas.map((h, i) => `<sheet name="${xml(h.nombre)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029"/></workbook>`], ['xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relaciones.join('')}<Relationship Id="styles" Type="${rel}/styles" Target="styles.xml"/></Relationships>`], ['_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`], ['[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${tipos.join('')}</Types>`])
  return zip(archivos)
}
