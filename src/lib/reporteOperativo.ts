import { supabase } from './supabase'
import { useAuthStore } from '../stores/authStore'
import type { AreaOperativa, TipoTurno } from './tiposTurno'

export interface ContextoReporteOperativo {
  turnoId: string | null; reporteId: string | null; ahora: number; inicio: number; fin: number
  puedeEditar: boolean; estado: string; fechaOperativa?: string; turno?: TipoTurno
}
export function exigirCuentaReporte(cuenta: string, area: AreaOperativa, supervisor = false) {
  const a = useAuthStore.getState()
  if (a.estado !== 'autenticado' || !a.perfil?.activo || a.perfil.id !== cuenta || a.sesion?.user.id !== cuenta
    || a.perfil.rol !== (supervisor ? 'admin' : area)) throw new Error('La cuenta ya no está autorizada para este reporte.')
}
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(v)
const objeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const instante = (v: unknown) => typeof v === 'string' ? Date.parse(v) : NaN

export function leerContextoReporte(v: unknown): ContextoReporteOperativo {
  if (!objeto(v) || !Number.isFinite(instante(v.ahora)) || typeof v.puede_editar !== 'boolean'
    || !['Sin turno','Sin enviar','Enviado','Cerrado completo','Cerrado con pendientes'].includes(String(v.estado))) throw new Error('No se pudo comprobar el horario del reporte.')
  const ahora = instante(v.ahora)
  if (v.turno_id === null && v.puede_editar === false) return { turnoId: null, reporteId: null, ahora, inicio: 0, fin: 0, puedeEditar: false, estado: 'Sin turno' }
  const inicio = instante(v.inicio), fin = instante(v.fin)
  if (!uuid(v.turno_id) || (v.reporte_id !== null && !uuid(v.reporte_id)) || !Number.isFinite(inicio) || !Number.isFinite(fin) || fin <= inicio
    || typeof v.fecha_operativa !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.fecha_operativa) || !['dia','tarde','noche'].includes(String(v.turno))
    || (v.puede_editar && (ahora < inicio || ahora >= fin))) throw new Error('El permiso no coincide con el horario del servidor.')
  return { turnoId: v.turno_id, reporteId: v.reporte_id as string | null, ahora, inicio, fin, puedeEditar: v.puede_editar,
    estado: String(v.estado), fechaOperativa: v.fecha_operativa, turno: v.turno as TipoTurno }
}
export async function consultarContextoReporte(cuenta: string, area: AreaOperativa, turnoId: string | null, signal: AbortSignal) {
  exigirCuentaReporte(cuenta, area)
  const r = await supabase.rpc('consultar_contexto_reporte_operativo', { p_area: area, p_turno_id: turnoId }).abortSignal(signal)
  exigirCuentaReporte(cuenta, area); signal.throwIfAborted()
  // Compatibilidad previa a la aplicación autorizada: conserva el envío anterior, sin habilitar edición.
  if (r.error?.code === 'PGRST202') return null
  if (r.error) throw new Error('No se pudo confirmar el horario. Actualiza la consulta.')
  return leerContextoReporte(r.data)
}
export function permisoVigente(contexto: ContextoReporteOperativo, transcurrido: number) {
  return contexto.puedeEditar && transcurrido >= 0 && transcurrido < 60000
    && contexto.ahora + transcurrido >= contexto.inicio && contexto.ahora + transcurrido < contexto.fin
}

export interface PendienteTecnico {
  turno_id: string; area: AreaOperativa; turno: TipoTurno; fecha_operativa: string
  reporte_id: string | null; revision: number | null; creado_en: string | null
  operador: string; operador_acompanante: string | null
}
export async function consultarPendientesTecnicos(cuenta: string, filtros: { desde: string; hasta: string; area: string }, pagina: number, signal: AbortSignal, limite = 25) {
  if (!Number.isInteger(limite) || limite < 1 || limite > 100 || !Number.isInteger(pagina) || pagina < 0) throw new Error('Paginación de pendientes inválida.')
  exigirCuentaReporte(cuenta, 'calderas', true)
  const r = await supabase.rpc('consultar_pendientes_tecnicos', {
    p_desde: filtros.desde, p_hasta: filtros.hasta, p_area: filtros.area, p_limite: limite, p_offset: pagina * limite,
  }).abortSignal(signal)
  exigirCuentaReporte(cuenta, 'calderas', true); signal.throwIfAborted()
  if (r.error?.code === 'PGRST202') return null
  if (r.error || !objeto(r.data) || !Array.isArray(r.data.filas) || typeof r.data.mas !== 'boolean' || r.data.filas.length > limite) throw new Error('No se pudieron consultar los pendientes técnicos.')
  const filas = r.data.filas.map((v: unknown) => {
    if (!objeto(v) || !uuid(v.turno_id) || !['calderas','ptar'].includes(String(v.area)) || !['dia','tarde','noche'].includes(String(v.turno))
      || typeof v.fecha_operativa !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.fecha_operativa)
      || v.fecha_operativa < filtros.desde || v.fecha_operativa > filtros.hasta || (filtros.area !== 'todas' && v.area !== filtros.area)
      || typeof v.operador !== 'string' || (v.operador_acompanante !== null && typeof v.operador_acompanante !== 'string')
      || (v.reporte_id !== null && (!uuid(v.reporte_id) || !Number.isSafeInteger(v.revision) || Number(v.revision) < 0 || !Number.isFinite(instante(v.creado_en))))) throw new Error('La consulta de pendientes no coincide con los filtros.')
    return v as unknown as PendienteTecnico
  })
  if (new Set(filas.map(v => v.turno_id)).size !== filas.length) throw new Error('Se recibieron turnos repetidos.')
  return { filas, mas: r.data.mas }
}


