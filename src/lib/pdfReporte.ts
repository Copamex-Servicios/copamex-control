import { fechaMexicoAdmin } from './administracion'
import { nombresTurno } from './planta'
import type { ConsultaReporte } from './reportes'
import { exigirExportacionReporte } from './reportes'
import { nombreAreaReporte, resumenEjecutivoReporte } from './resumenEjecutivoReporte'

const escapar = (v: string | number) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const numero = (v: string | number) => new Intl.NumberFormat('es-MX', { maximumFractionDigits: 3 }).format(Number(v))
const fecha = (v: string) => v.split('-').reverse().join('/')

/** Documento ejecutivo independiente de la pestaña abierta y sin mediciones individuales. */
export function htmlReporteEjecutivo(r: ConsultaReporte): string {
  const s = resumenEjecutivoReporte(r)
  const indicadores: [string, number][] = [['Turnos registrados', s.turnos], ['Capturas vigentes', s.totalCapturas]]
  if (s.totalTecnicos !== null) indicadores.push(['Reportes técnicos', s.totalTecnicos])
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>COPAMEX - Reporte ejecutivo ${escapar(r.filtros.desde)} al ${escapar(r.filtros.hasta)}</title><style>
    @page { size:A4 portrait; margin:15mm; }
    * { box-sizing:border-box; } body { margin:0; color:#172b4d; font:10pt Arial,Helvetica,sans-serif; line-height:1.4; }
    header { border-bottom:2px solid #002d72; padding-bottom:12px; margin-bottom:18px; }
    .marca { color:#002d72; font-size:11pt; font-weight:bold; letter-spacing:1px; } h1 { color:#002d72; font-size:21pt; margin:4px 0 8px; }
    header p { margin:3px 0; } h2 { color:#002d72; font-size:12pt; margin:18px 0 8px; }
    table { width:100%; border-collapse:collapse; margin-bottom:12px; table-layout:fixed; }
    th { text-align:left; color:#002d72; background:#edf3fb; font-weight:bold; } th,td { border-bottom:1px solid #dce6f4; padding:6px 9px; vertical-align:top; overflow-wrap:break-word; }
    .indicadores td { color:#002d72; font-size:19pt; font-weight:bold; } .operacion th:first-child { width:16%; } .operacion th:nth-child(2) { width:49%; }
    .numerico { text-align:right; font-variant-numeric:tabular-nums; } section, tr { break-inside:avoid; }
    .nota { color:#536581; font-size:8.5pt; margin:7px 0; } footer { border-top:1px solid #dce6f4; margin-top:18px; padding-top:9px; color:#536581; font-size:8pt; }
    @media screen { body { max-width:180mm; margin:20px auto; padding:0 14px; } }
    @media print { body { print-color-adjust:exact; -webkit-print-color-adjust:exact; } }
  </style></head><body>
    <header><div class="marca">COPAMEX</div><h1>Reporte ejecutivo de operación</h1>
      <p><strong>Período:</strong> ${fecha(r.filtros.desde)} al ${fecha(r.filtros.hasta)}</p>
      <p><strong>Área:</strong> ${nombreAreaReporte(r.filtros.area)} &nbsp; <strong>Turno:</strong> ${r.filtros.turno === 'todos' ? 'Todos' : nombresTurno[r.filtros.turno]}</p>
    </header>
    <table class="indicadores"><thead><tr>${indicadores.map(([n]) => `<th>${n}</th>`).join('')}</tr></thead><tbody><tr>${indicadores.map(([, v]) => `<td>${numero(v)}</td>`).join('')}</tr></tbody></table>
    <section><h2>Resumen por área</h2><table><thead><tr><th>Área</th><th class="numerico">Turnos registrados</th><th class="numerico">Capturas vigentes</th>${s.porArea.some(a => a.tecnicos !== null) ? '<th class="numerico">Reportes técnicos</th>' : ''}</tr></thead>
      <tbody>${s.porArea.map(a => `<tr><td>${nombreAreaReporte(a.area)}</td><td class="numerico">${numero(a.turnos)}</td><td class="numerico">${numero(a.capturas)}</td>${s.porArea.some(x => x.tecnicos !== null) ? `<td class="numerico">${a.tecnicos === null ? 'No disponible' : numero(a.tecnicos)}</td>` : ''}</tr>`).join('')}</tbody></table></section>
    ${s.operacion.length ? `<section><h2>Información operativa del período</h2><table class="operacion"><thead><tr><th>Área</th><th>Indicador</th><th class="numerico">Valor</th><th>Unidad</th></tr></thead><tbody>${s.operacion.map(d => `<tr><td>${nombreAreaReporte(d.area)}</td><td>${escapar(d.indicador)}</td><td class="numerico">${numero(d.valor)}</td><td>${escapar(d.unidad)}</td></tr>`).join('')}</tbody></table></section>` : '<p class="nota">No hay mediciones operativas disponibles para resumir en este período.</p>'}
    ${s.notas.map(n => `<p class="nota">${escapar(n)}</p>`).join('')}
    <p class="nota">Cada captura operativa se cuenta una vez. Las muestras de calidad no se multiplican por sus resultados. Las bitácoras técnicas se contabilizan por separado.</p>
    <p class="nota">Capturas vigentes de Pozos, UF, Calidad y Proceso PTAR. Las observaciones antiguas de Bitácora no forman parte de esta consulta. Las mediciones y el historial solicitado se consultan en COPAMEX.</p>
    <footer>Consulta: ${escapar(fechaMexicoAdmin(r.inicioConsulta).replace('T', ' '))} a ${escapar(fechaMexicoAdmin(r.finConsulta).replace('T', ' '))} (México).<br>Fecha operativa asignada al inicio del turno. Historial de cambios: ${r.auditoria === 'completa' ? 'disponible en Reportes → Trazabilidad' : 'no solicitado'}.</footer>
  </body></html>`
}

/** Reutiliza la impresión nativa para Guardar como PDF, sin modificar la vista actual. */
export function imprimirReporteEjecutivo(r: ConsultaReporte, onError: (mensaje: string) => void): void {
  const documento = htmlReporteEjecutivo(r)
  document.querySelector<HTMLIFrameElement>('iframe[data-copamex-pdf]')?.remove()
  const marco = document.createElement('iframe')
  marco.dataset.copamexPdf = ''; marco.title = 'Reporte ejecutivo para PDF'; marco.setAttribute('aria-hidden', 'true')
  marco.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:1100px;border:0'
  marco.onload = () => {
    try {
      exigirExportacionReporte(r)
      const ventana = marco.contentWindow
      if (!ventana) throw new Error('No se pudo abrir el PDF ejecutivo.')
      ventana.addEventListener('afterprint', () => marco.remove(), { once: true })
      ventana.focus(); ventana.print()
    } catch { marco.remove(); onError('No se pudo abrir el PDF ejecutivo. Confirma tu sesión y vuelve a intentar.') }
  }
  marco.srcdoc = documento; document.body.append(marco)
}
