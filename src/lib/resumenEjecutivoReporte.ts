import { capturasPlanta, modulosPlanta, validarFiltrosPlanta } from './planta'
import type { CapturaPlanta } from './planta'
import { exigirExportacionReporte, resumirReporte, sumarDecimalReporte } from './reportes'
import type { ConsultaReporte } from './reportes'
import type { AreaOperativa, TipoTurno } from './tiposTurno'

export const nombreAreaReporte = (area: string) => area === 'calderas' ? 'Calderas' : area === 'ptar' ? 'PTAR' : 'Ambas áreas'
export interface TotalAreaReporte { area: AreaOperativa; turnos: number; capturas: number; tecnicos: number | null }
export interface DatoOperativoReporte { area: AreaOperativa; indicador: string; valor: string | number; unidad: string }

/** Una sola definición de población y totales para el PDF y las tres hojas operativas. */
export function resumenEjecutivoReporte(r: ConsultaReporte) {
  exigirExportacionReporte(r); validarFiltrosPlanta(r.filtros)
  const areas: AreaOperativa[] = r.filtros.area === 'todas' ? ['calderas', 'ptar'] : [r.filtros.area]
  const coincide = (t: { area: AreaOperativa; fecha_operativa: string; turno: TipoTurno }) => areas.includes(t.area)
    && t.fecha_operativa >= r.filtros.desde && t.fecha_operativa <= r.filtros.hasta && (r.filtros.turno === 'todos' || t.turno === r.filtros.turno)
  const capturas = capturasPlanta(r.actual), turnos = r.actual.turnos.elementos
  if (capturas.some(c => !coincide(c.registro.turno) || c.registro.lectura.eliminado_en !== null) || turnos.some(t => !coincide(t.turno))) throw new Error('Hay registros que no corresponden a los filtros o a la población vigente. Genera nuevamente.')
  if (new Set(capturas.map(c => `${c.modulo}:${c.registro.lectura.id}`)).size !== capturas.length || new Set(turnos.map(t => t.turno.id)).size !== turnos.length) throw new Error('La consulta contiene registros duplicados. Genera nuevamente.')
  const notas: string[] = [], operacion: DatoOperativoReporte[] = []
  const tecnicos = areas.flatMap(area => r.tecnicos?.[area]?.error === false ? r.tecnicos[area]!.filas : [])
  if (tecnicos.some(t => !coincide({ area: t.area, fecha_operativa: t.fechaOperativa, turno: t.turno })) || new Set(tecnicos.map(t => `${t.area}:${t.id}`)).size !== tecnicos.length) throw new Error('Los resúmenes técnicos no corresponden a la consulta. Genera nuevamente.')
  const porArea: TotalAreaReporte[] = areas.map(area => {
    const fuente = r.tecnicos?.[area]
    if (!fuente || fuente.error) notas.push(`Se omitió el total de reportes técnicos de ${nombreAreaReporte(area)} porque su consulta no estuvo disponible.`)
    const fuentes = Object.fromEntries(Object.entries(r.actual.fuentes).map(([m, f]) => [m, { ...f, elementos: f.elementos.filter(c => c.registro.turno.area === area) }])) as ConsultaReporte['actual']['fuentes']
    const datos = resumirReporte({ fuentes, turnos: { ...r.actual.turnos, elementos: turnos.filter(t => t.turno.area === area) } }, { ...r.filtros, area })
    const agregar = (indicador: string, valor: string | number | null, unidad: string) => { if (valor !== null) operacion.push({ area, indicador, valor, unidad }) }
    if (area === 'calderas') {
      agregar('Consumo Pozo 1', datos.pozo1, 'm³'); agregar('Consumo Pozo 2', datos.pozo2, 'm³')
      agregar('UF alimentado', datos.alimentado, 'm³'); agregar('UF aceptado', datos.aceptado, 'm³'); agregar('Rendimiento global UF', datos.rendimiento, '%')
    }
    if (datos.capturas.some(c => c.modulo === 'calidad')) {
      agregar('Calidad: resultados evaluados', datos.evaluados, 'resultados')
      agregar('Calidad: fuera del límite aplicado', datos.fuera, 'resultados')
      agregar('Calidad: sin límites aplicados', datos.sinLimites, 'resultados')
    }
    if (area === 'ptar' && datos.capturas.some(c => c.modulo === 'ptar')) agregar('Lecturas de proceso PTAR', datos.capturas.filter(c => c.modulo === 'ptar').length, 'lecturas')
    return { area, turnos: datos.cerrados + datos.abiertos, capturas: datos.capturas.length, tecnicos: fuente && !fuente.error ? fuente.filas.length : null }
  })
  const tecnicosCompletos = porArea.every(a => a.tecnicos !== null)
  const grupos = new Map<string, { fecha: string; area: AreaOperativa; turno: TipoTurno; turnos: number; capturas: CapturaPlanta[]; tecnicos: number | null }>()
  const grupo = (fecha: string, area: AreaOperativa, turno: TipoTurno) => {
    const clave = `${fecha}:${area}:${turno}`
    if (!grupos.has(clave)) grupos.set(clave, { fecha, area, turno, turnos: 0, capturas: [], tecnicos: r.tecnicos?.[area]?.error === false ? 0 : null })
    return grupos.get(clave)!
  }
  for (const { turno: t } of turnos) grupo(t.fecha_operativa, t.area, t.turno).turnos++
  for (const c of capturas) { const t = c.registro.turno; grupo(t.fecha_operativa, t.area, t.turno).capturas.push(c) }
  for (const t of tecnicos) { const g = grupo(t.fechaOperativa, t.area, t.turno); g.tecnicos = (g.tecnicos ?? 0) + 1 }
  const ordenTurno: Record<TipoTurno, number> = { dia: 0, tarde: 1, noche: 2 }
  const diario = [...grupos.values()].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.area.localeCompare(b.area) || ordenTurno[a.turno] - ordenTurno[b.turno]).map(g => {
    const sumar = (m: 'pozos' | 'uf', campo: string) => {
      const valores = g.capturas.filter(c => c.modulo === m).map(c => Number((c.registro.lectura as unknown as Record<string, unknown>)[campo]))
      return valores.length ? sumarDecimalReporte(valores) : null
    }
    return { ...g, porModulo: Object.fromEntries(modulosPlanta.map(m => [m, g.capturas.filter(c => c.modulo === m).length])),
      pozo1: sumar('pozos', 'consumo_pozo1'), pozo2: sumar('pozos', 'consumo_pozo2'), alimentado: sumar('uf', 'alimentado'), aceptado: sumar('uf', 'aceptado') }
  })
  return { porArea, capturas, operacion, diario, notas, turnos: turnos.length, totalCapturas: capturas.length,
    totalTecnicos: tecnicosCompletos ? porArea.reduce((n, a) => n + a.tecnicos!, 0) : null }
}
