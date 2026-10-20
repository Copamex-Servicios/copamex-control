import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import type { RowInput } from 'jspdf-autotable'
import { nombreAreaTecnica, nombreTurnoTecnico, textoCeldaTecnica } from './consolidadoTecnico.ts'
import type { MatrizTecnica } from './consolidadoTecnico'

/** Reportes verticales por turno, descargables sin diálogo de impresión. */
export function crearPdfTecnicoDiario(matriz: MatrizTecnica, fuente: string): jsPDF {
  const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4', putOnlyUsedFonts:true, compress:true })
  doc.addFileToVFS('DejaVuSans.ttf', fuente)
  doc.addFont('DejaVuSans.ttf', 'DejaVuSans', 'normal')
  doc.setFont('DejaVuSans', 'normal')
  doc.setProperties({ title:`COPAMEX · Reportes técnicos · ${nombreAreaTecnica(matriz.area)} · ${matriz.fecha}`, author:'COPAMEX' })
  const fecha = matriz.fecha.split('-').reverse().join('/')
  const seleccionados = matriz.columnas.filter(c => c.estado === 'seleccionado')
  const cabecera = () => {
    doc.setFont('DejaVuSans', 'normal'); doc.setTextColor(0,45,114); doc.setFontSize(17)
    doc.text('COPAMEX · Reportes técnicos', 14, 17)
    doc.setFontSize(10)
    doc.text(`${nombreAreaTecnica(matriz.area)} · Fecha operativa: ${fecha}`, 14, 24)
    doc.setFontSize(9)
    doc.text(`Turnos seleccionados: ${seleccionados.map(c => nombreTurnoTecnico[c.turno]).join(', ')}`, 14, 30)
    doc.setDrawColor(0,45,114); doc.setLineWidth(0.2); doc.line(14, 34, 196, 34)
  }
  seleccionados.forEach((columna, indice) => {
    if (indice) doc.addPage()
    const posicion = matriz.columnas.indexOf(columna)
    const body: RowInput[] = []
    const parrafo = (texto: string, discreto = false) => {
      doc.setFontSize(discreto ? 8 : 10)
      const lineas: string[] = doc.splitTextToSize(texto, 177)
      for (let i = 0; i < lineas.length; i += 10) body.push([{ content:lineas.slice(i,i+10).join('\n'), colSpan:3,
        styles:{ fontSize:discreto ? 8 : 10, textColor:discreto ? [83,101,129] : [23,43,77], fillColor:[255,255,255] } }])
    }
    if (!indice) {
      const ausentes = matriz.columnas.filter(c => c.estado !== 'seleccionado')
      if (ausentes.length) parrafo(ausentes.map(c => `${nombreTurnoTecnico[c.turno]}: ${c.estado === 'sin_reporte' ? 'Sin reporte' : 'No seleccionado'}`).join(' · '), true)
    }
    for (const seccion of [...new Set(matriz.filas.map(f => f.seccion))]) {
      const filas = matriz.filas.filter(f => f.seccion === seccion && f.celdas[posicion].estado !== 'no_capturado')
      if (!filas.length) continue
      body.push([{ content:seccion, colSpan:3, styles:{ fillColor:[255,255,255], textColor:[0,45,114], cellPadding:{ top:4, bottom:2, left:0, right:0 }, fontSize:11 } }])
      const tabla = filas.filter(f => f.tipo !== 'texto')
      if (tabla.length) {
        body.push(['Medición / equipo', 'Valor / estado', 'Unidad'].map(content => ({ content, styles:{ fillColor:[237,243,251], textColor:[0,45,114] } })))
        for (const fila of tabla) body.push([fila.parametro, textoCeldaTecnica(fila.celdas[posicion]), fila.celdas[posicion].unidad])
      }
      for (const fila of filas.filter(f => f.tipo === 'texto')) parrafo(`${fila.parametro}: ${textoCeldaTecnica(fila.celdas[posicion])}`)
    }
    if (matriz.area === 'calderas' && columna.formato === 1) parrafo('Formato histórico 1: servicio de agua potable y pozos no capturado. Unidades originales, sin conversiones.', true)
    parrafo(`Reporte: ${columna.reporteId} · Turno: ${columna.turnoId}\nAutor: ${columna.autorId}`, true)
    autoTable(doc, {
      startY:38, margin:{ top:38, right:14, bottom:14, left:14 },
      head:[[{ content:`Turno ${nombreTurnoTecnico[columna.turno]}\nOperador: ${columna.operador}\nFecha operativa: ${fecha} · Captura: ${columna.captura} (México)\nRevisión ${columna.revision} · Formato ${columna.formato}`, colSpan:3 }]],
      body, theme:'plain', showHead:'everyPage', rowPageBreak:'avoid',
      styles:{ font:'DejaVuSans', fontStyle:'normal', fontSize:10, cellPadding:2, textColor:[23,43,77], valign:'top', overflow:'linebreak', lineWidth:{ bottom:0.15 }, lineColor:[214,225,242] },
      headStyles:{ fillColor:[255,255,255], textColor:[0,45,114], fontSize:11, cellPadding:{ top:2, bottom:4, left:0, right:0 } },
      columnStyles:{ 0:{ cellWidth:105 }, 1:{ cellWidth:49 }, 2:{ cellWidth:28 } },
      willDrawPage:cabecera,
    })
  })
  const paginas = doc.getNumberOfPages()
  for (let pagina = 1; pagina <= paginas; pagina++) {
    doc.setPage(pagina); doc.setFontSize(8); doc.setTextColor(83,101,129)
    doc.text(`Página ${pagina} de ${paginas}`, 196, 291, { align:'right' })
  }
  return doc
}
