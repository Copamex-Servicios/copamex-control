import { supabase } from './supabase'
import { useAuthStore } from '../stores/authStore'
import { notificarInformacionActualizada } from './actualizacionInformacion'

export interface SeguimientoCalidad {
  id: string; tipo: string; area: 'calderas' | 'ptar'; punto_id: string; parametro_id: string
  instruccion: string; creado_por: string
}
export interface SolicitudSeguimiento {
  id: string; operacion: 'activar' | 'finalizar' | 'lectura'; instruccion?: string
  turno?: string; seguimiento?: string; valor?: number
}
export class ErrorSeguimiento extends Error {
  readonly incierto: boolean
  constructor(mensaje: string, incierto = false) { super(mensaje); this.incierto = incierto }
}
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(v)
export function leerSeguimiento(v: unknown): SeguimientoCalidad | null {
  if (v === null) return null
  if (!v || typeof v !== 'object') throw new ErrorSeguimiento('Respuesta de seguimiento inválida.')
  const s = v as SeguimientoCalidad
  if (!uuid(s.id) || !uuid(s.punto_id) || !uuid(s.parametro_id) || !uuid(s.creado_por)
    || s.tipo !== 'color_m4' || !['calderas','ptar'].includes(s.area)
    || typeof s.instruccion !== 'string' || !s.instruccion.trim() || s.instruccion.length > 4000) {
    throw new ErrorSeguimiento('No se pudo comprobar el seguimiento.')
  }
  return s
}
function exigir(cuenta: string, operacion?: SolicitudSeguimiento['operacion']) {
  const a = useAuthStore.getState()
  const roles = operacion === 'lectura' ? ['calderas'] : operacion ? ['admin'] : ['admin','calidad','calderas','ptar']
  if (a.estado !== 'autenticado' || !a.perfil?.activo || a.perfil.id !== cuenta || a.sesion?.user.id !== cuenta
    || !roles.includes(a.perfil.rol)) throw new ErrorSeguimiento('La sesión cambió. Inicia sesión con la cuenta autorizada.')
}
export async function consultarSeguimiento(cuenta: string, signal: AbortSignal) {
  exigir(cuenta); signal.throwIfAborted()
  const r = await supabase.rpc('consultar_seguimiento_calidad', { p_tipo:'color_m4' }).abortSignal(signal)
  exigir(cuenta); signal.throwIfAborted()
  if (r.error) throw new ErrorSeguimiento(r.error.code === 'PGRST202'
    ? 'El seguimiento requiere aplicar la migración 20261112000200 en Supabase.'
    : 'No se pudo consultar el seguimiento. Reintenta.')
  return leerSeguimiento(r.data)
}

// Se conserva la solicitud original por cuenta para reintentar, incluso al cambiar de pestaña.
const memoria = new Map<string, SolicitudSeguimiento>()
const clave = (cuenta: string) => 'copamex:seguimiento-pendiente:' + cuenta
export function pendienteSeguimiento(cuenta: string): SolicitudSeguimiento | null {
  const actual = memoria.get(cuenta)
  if (actual) return actual
  try {
    const s = JSON.parse(sessionStorage.getItem(clave(cuenta)) ?? 'null') as SolicitudSeguimiento | null
    if (!s || !uuid(s.id) || !['activar','finalizar','lectura'].includes(s.operacion)) return null
    if (s.operacion === 'activar' && (typeof s.instruccion !== 'string' || !s.instruccion.trim() || s.instruccion.length > 4000)) return null
    if (s.operacion === 'lectura' && (!uuid(s.turno) || !uuid(s.seguimiento) || typeof s.valor !== 'number' || !Number.isFinite(s.valor))) return null
    memoria.set(cuenta,s); return s
  } catch { return null }
}
function conservar(cuenta: string, s: SolicitudSeguimiento | null) {
  if (s) memoria.set(cuenta,s); else memoria.delete(cuenta)
  try { if (s) sessionStorage.setItem(clave(cuenta),JSON.stringify(s)); else sessionStorage.removeItem(clave(cuenta)) } catch { /* La memoria conserva el reintento mientras siga abierta la aplicación. */ }
}
export async function ejecutarSeguimiento(cuenta: string, nueva: SolicitudSeguimiento, signal: AbortSignal) {
  const s = pendienteSeguimiento(cuenta) ?? Object.freeze({ ...nueva })
  exigir(cuenta,s.operacion); signal.throwIfAborted()
  conservar(cuenta,s)
  const r = s.operacion === 'activar'
    ? await supabase.rpc('activar_seguimiento_calidad',{ p_id:s.id,p_tipo:'color_m4',p_instruccion:s.instruccion }).abortSignal(signal)
    : s.operacion === 'finalizar'
      ? await supabase.rpc('finalizar_seguimiento_calidad',{ p_id:s.id }).abortSignal(signal)
      : await supabase.rpc('guardar_lectura_seguimiento_calidad',{ p_id:s.id,p_turno:s.turno,p_seguimiento:s.seguimiento,p_valor:s.valor }).abortSignal(signal)
  exigir(cuenta,s.operacion)
  if (r.error) {
    const conocido = /^(?:[0-9]{2}[0-9A-Z]{3}|P[0-9]{4}|XX[0-9]{3}|PGRST\d{3})$/.test(r.error.code ?? '')
    if (conocido) conservar(cuenta,null)
    throw new ErrorSeguimiento(conocido
      ? ['42501','22023','23505'].includes(r.error.code) ? r.error.message : 'El servidor rechazó la operación. Actualiza y reintenta.'
      : 'No se confirmó la operación. Reintenta la misma solicitud.',!conocido)
  }
  if (r.data !== s.id) throw new ErrorSeguimiento('La respuesta no confirma la solicitud. Reintenta.',true)
  conservar(cuenta,null); notificarInformacionActualizada()
}
