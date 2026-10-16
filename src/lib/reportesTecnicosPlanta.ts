import { supabase } from './supabase'
import { esFechaOperativa, esTipoTurno } from './turnos'
import type { TipoTurno } from './tiposTurno'

export async function consultarResumenesTecnicosPlanta(area: 'calderas' | 'ptar', filtros: { desde: string; hasta: string; turno: TipoTurno | 'todos' }, pagina: number, signal: AbortSignal) {
  const { data, error } = await supabase.rpc('consultar_bitacoras_tecnicas_planta', {
    p_desde: filtros.desde || '1900-01-01', p_hasta: filtros.hasta || '9999-12-31', p_area: area,
    p_turno: filtros.turno, p_limite: 20, p_offset: pagina * 20,
  }).abortSignal(signal)
  if (error) {
    if (error.code === 'PGRST202') throw new Error('Falta instalar la consulta compartida de bitácoras técnicas en este proyecto.')
    const detalle = error.message?.trim()
    throw new Error(detalle ? `No se pudo consultar el historial técnico: ${detalle}` : 'No se pudo consultar el historial técnico. Reintenta.')
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.filas) || typeof data.mas !== 'boolean') throw new Error('Respuesta de historial inválida.')
  const filas = data.filas.map((r: Record<string, unknown>) => {
    const uuid = (v: unknown): v is string => typeof v === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(v)
    if (!uuid(r.id) || !uuid(r.turno_id) || r.area !== area || r.modulo !== `bitacora_${area}` || !esFechaOperativa(r.fecha_operativa)
      || !esTipoTurno(r.turno) || typeof r.operador !== 'string' || !r.operador.trim() || typeof r.creado_en !== 'string'
      || !Number.isFinite(Date.parse(r.creado_en)) || !Number.isSafeInteger(r.revision) || Number(r.revision) < 0
      || (filtros.desde && r.fecha_operativa < filtros.desde) || (filtros.hasta && r.fecha_operativa > filtros.hasta)
      || (filtros.turno !== 'todos' && r.turno !== filtros.turno)) throw new Error('El reporte no corresponde a la consulta.')
    return { id: r.id, turnoId: r.turno_id, fechaOperativa: r.fecha_operativa, turno: r.turno, operador: r.operador, creadoEn: r.creado_en, revision: Number(r.revision) }
  })
  if (filas.length > 20 || new Set(filas.map((r: { id: string }) => r.id)).size !== filas.length) throw new Error('Historial inconsistente. Actualiza.')
  return { filas, hayMas: data.mas as boolean }
}
