import { consultarResumenesTecnicosPlanta } from './reportesTecnicosPlanta'
import { exigirAdminRevision } from './revisionCapturas'
import { agruparTecnicos } from './consolidadoTecnico'
import type { FiltrosPlanta } from './planta'
import type { FilaTecnicaAdmin } from './revisionTecnica'
import type { AreaOperativa } from './tiposTurno'

export async function consultarDiasTecnicos(cuenta: string, filtros: FiltrosPlanta, signal: AbortSignal) {
  exigirAdminRevision(cuenta)
  const areas: AreaOperativa[] = filtros.area === 'todas' ? ['calderas', 'ptar'] : [filtros.area]
  const fuentes = await Promise.all(areas.map(async area => {
    const filas: FilaTecnicaAdmin[] = [], ids = new Set<string>()
    // Leer todas las páginas antes de declarar un turno «Sin reporte».
    // El turno del filtro define la selección inicial, no oculta disponibilidad.
    for (let pagina = 0; pagina < 50; pagina++) {
      signal.throwIfAborted(); exigirAdminRevision(cuenta)
      const r = await consultarResumenesTecnicosPlanta(area, { ...filtros, turno: 'todos' }, pagina, signal)
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
  return agruparTecnicos(filtros.desde, filtros.hasta, fuentes.flat())
}
