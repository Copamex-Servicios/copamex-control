import { mayusculasNota } from './notasOperativas'

export interface ComentarioOperador { nombre: string; comentario: string }
export type ReportesIndividuales = [ComentarioOperador, ComentarioOperador]

export function leerReportesIndividuales(valor: unknown): ReportesIndividuales | undefined {
  if (valor === null || valor === undefined) return undefined
  if (!Array.isArray(valor) || valor.length !== 2 || valor.some(v => !v || typeof v !== 'object'
    || typeof v.nombre !== 'string' || !v.nombre.trim() || typeof v.comentario !== 'string' || !v.comentario.trim())) {
    throw new Error('No se pudieron comprobar los reportes de los dos operadores.')
  }
  return valor.map(v => ({ nombre: v.nombre, comentario: v.comentario })) as ReportesIndividuales
}

export function resumenReportesIndividuales(reportes: ReportesIndividuales): string {
  return reportes.map((r, i) => `OPERADOR ${i + 1}:\n${mayusculasNota(r.comentario).trim()}`).join('\n\n')
}

export function prepararReportesIndividuales(reportes?: ReportesIndividuales) {
  if (!reportes) return undefined
  const comentarios = reportes.map(r => mayusculasNota(r.comentario).trim())
  if (comentarios.some(c => !c)) throw new Error('Escribe el reporte relevante de cada uno de los dos operadores.')
  if (resumenReportesIndividuales(reportes).length > 4000) throw new Error('Los dos reportes relevantes juntos admiten hasta 4,000 caracteres.')
  return { principal: comentarios[0], acompanante: comentarios[1] }
}
