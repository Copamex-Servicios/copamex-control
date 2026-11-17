import { consultarResumenesTecnicosPlanta } from './reportesTecnicosPlanta'
import { exigirAdminRevision } from './revisionCapturas'
import { agruparTecnicos, diasEnPeriodoTecnico } from './consolidadoTecnico'
import { supabase } from './supabase'
import { esFechaOperativa } from './turnos'
import type { FiltrosPlanta } from './planta'
import type { FilaTecnicaAdmin } from './revisionTecnica'
import type { AreaOperativa } from './tiposTurno'

export const diasTecnicosPorPagina = 7
const MILISEGUNDOS_POR_DIA = 86400000

function fechaHoyMexico(): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const valor = (tipo: string) => partes.find(parte => parte.type === tipo)?.value
  const fecha = `${valor('year')}-${valor('month')}-${valor('day')}`
  if (!esFechaOperativa(fecha)) throw new Error('No se pudo determinar la fecha actual de México.')
  return fecha
}

export async function consultarPeriodoTecnicoCompleto(cuenta: string, signal: AbortSignal) {
  exigirAdminRevision(cuenta); signal.throwIfAborted()
  const hasta = fechaHoyMexico()
  const [calderas, ptar] = await Promise.all([
    supabase.from('turnos_operativos').select('fecha_operativa,reporte:bitacora_calderas!inner(id)')
      .lte('fecha_operativa', hasta).order('fecha_operativa', { ascending: true }).order('id', { ascending: true }).limit(1).abortSignal(signal),
    supabase.from('turnos_operativos').select('fecha_operativa,reporte:bitacora_ptar!inner(id)')
      .lte('fecha_operativa', hasta).order('fecha_operativa', { ascending: true }).order('id', { ascending: true }).limit(1).abortSignal(signal),
  ])
  signal.throwIfAborted(); exigirAdminRevision(cuenta)
  if (calderas.error || ptar.error || !Array.isArray(calderas.data) || !Array.isArray(ptar.data)) {
    throw new Error('No se pudo determinar el primer reporte técnico. Reintenta la consulta.')
  }
  const fechas = [...calderas.data, ...ptar.data].map(turno => turno.fecha_operativa)
  if (fechas.some(fecha => !esFechaOperativa(fecha) || fecha > hasta)) {
    throw new Error('Se encontró una fecha de reporte técnico inválida.')
  }
  return { desde: fechas.sort()[0] ?? hasta, hasta }
}

export async function consultarDiasTecnicos(cuenta: string, filtros: FiltrosPlanta, signal: AbortSignal, pagina = 0) {
  exigirAdminRevision(cuenta)
  const totalDias = diasEnPeriodoTecnico(filtros.desde, filtros.hasta)
  const totalPaginas = Math.ceil(totalDias / diasTecnicosPorPagina)
  if (!Number.isSafeInteger(pagina) || pagina < 0 || pagina >= totalPaginas) throw new Error('La página de reportes técnicos no es válida.')
  const fechaBase = Date.parse(`${filtros.desde}T12:00:00Z`)
  const indiceFinal = totalDias - 1 - pagina * diasTecnicosPorPagina
  const indiceInicial = Math.max(0, indiceFinal - diasTecnicosPorPagina + 1)
  const filtrosPagina = {
    ...filtros,
    desde: new Date(fechaBase + indiceInicial * MILISEGUNDOS_POR_DIA).toISOString().slice(0, 10),
    hasta: new Date(fechaBase + indiceFinal * MILISEGUNDOS_POR_DIA).toISOString().slice(0, 10),
  }
  const areas: AreaOperativa[] = filtros.area === 'todas' ? ['calderas', 'ptar'] : [filtros.area]
  const fuentes = await Promise.all(areas.map(async area => {
    const filas: FilaTecnicaAdmin[] = [], ids = new Set<string>()
    // Leer todas las páginas antes de declarar un turno «Sin reporte».
    // Siempre se consulta el día completo; el filtro no oculta disponibilidad.
    for (let pagina = 0; pagina < 50; pagina++) {
      signal.throwIfAborted(); exigirAdminRevision(cuenta)
      const r = await consultarResumenesTecnicosPlanta(area, { desde: filtrosPagina.desde, hasta: filtrosPagina.hasta, turno: 'todos' }, pagina, signal)
      for (const fila of r.filas) {
        if (ids.has(fila.id)) throw new Error('El historial cambió durante la consulta. Actualiza.')
        ids.add(fila.id); filas.push({ ...fila, area })
      }
      if (!r.hayMas) return filas
      if (!r.filas.length) throw new Error('No se pudo completar la consulta. Actualiza.')
    }
    throw new Error('Consulta demasiado extensa. Reduce el período antes de consolidar.')
  }))
  signal.throwIfAborted(); exigirAdminRevision(cuenta)
  return agruparTecnicos(filtrosPagina.desde, filtrosPagina.hasta, fuentes.flat())
}
