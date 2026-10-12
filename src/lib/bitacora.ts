import { supabase } from './supabase'
import { esFechaOperativa, esTipoTurno } from './turnos'
import type { CamposBitacora, LecturaBitacora, RegistroBitacora, SolicitudGuardadoBitacora, ValoresBitacora } from './tiposBitacora'
export type { RegistroBitacora, SolicitudGuardadoBitacora } from './tiposBitacora'

export class ErrorBitacora extends Error {
  readonly resultadoIncierto: boolean
  constructor(mensaje: string, incierto = false) { super(mensaje); this.name = 'ErrorBitacora'; this.resultadoIncierto = incierto }
}
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(v)
const instante = (v: unknown): v is string => typeof v === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(v) && Number.isFinite(Date.parse(v))
function objeto(v: unknown, incierto = false): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ErrorBitacora('No se pudo comprobar la información de Bitácora. Actualiza.', incierto)
  return v as Record<string, unknown>
}
export function validarCamposBitacora(campos: CamposBitacora): ValoresBitacora {
  if (typeof campos.texto !== 'string' || !campos.texto.trim()) throw new ErrorBitacora('Escribe lo relevante del turno antes de guardar la nota.')
  return { texto: campos.texto.trim() }
}
export function originalBitacora(m: LecturaBitacora): ValoresBitacora { return { texto: m.texto } }
export function leerLecturaBitacora(v: unknown, incierto = false): LecturaBitacora {
  const m = objeto(v, incierto)
  const { id, turno_id, texto, capturado_en, recibido_en, creado_por, eliminado_en, eliminado_por } = m
  if (!uuid(id) || !uuid(turno_id) || !uuid(creado_por) || typeof texto !== 'string' || !texto.trim()
    || !instante(capturado_en) || !instante(recibido_en) || Date.parse(recibido_en) < Date.parse(capturado_en)
    || eliminado_en !== null || eliminado_por !== null) throw new ErrorBitacora('No se pudo comprobar la nota guardada. Actualiza.', incierto)
  return { id, turno_id, texto, capturado_en, recibido_en, creado_por, eliminado_en, eliminado_por }
}
export function leerRegistroBitacora(v: unknown): RegistroBitacora {
  const m = objeto(v), lectura = leerLecturaBitacora(m), t = objeto(m.turno), o = objeto(t.operador)
  const { id, fecha_operativa, area, turno, operador_id, iniciado_por, iniciado_en, finalizado_en, notas_cierre } = t
  if (id !== lectura.turno_id || !esFechaOperativa(fecha_operativa) || (area !== 'calderas' && area !== 'ptar')
    || !esTipoTurno(turno) || !uuid(operador_id) || iniciado_por !== lectura.creado_por || !instante(iniciado_en)
    || Date.parse(lectura.capturado_en) < Date.parse(iniciado_en)
    || (finalizado_en !== null && (!instante(finalizado_en) || Date.parse(finalizado_en) < Date.parse(lectura.capturado_en)))
    || (notas_cierre !== null && typeof notas_cierre !== 'string') || o.id !== operador_id || typeof o.nombre !== 'string' || !o.nombre.trim()) {
    throw new ErrorBitacora('No se pudo comprobar el turno de la nota. Actualiza.')
  }
  return { lectura, turno: { id, fecha_operativa, area, turno, operador_id, iniciado_por: lectura.creado_por, iniciado_en, finalizado_en, notas_cierre }, operadorNombre: o.nombre }
}
const seleccion = 'id,turno_id,texto,capturado_en,recibido_en,creado_por,eliminado_en,eliminado_por,turno:turnos_operativos!inner(id,fecha_operativa,area,turno,operador_id,iniciado_por,iniciado_en,finalizado_en,notas_cierre,operador:operadores!inner(id,nombre))'
function fallo(error: unknown, mensaje: string, mutacion = false): never {
  const e = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const codigo = typeof e.code === 'string' ? e.code : ''
  const propio = ['42501','22023','23505','40001'].includes(codigo) && typeof e.message === 'string'
    && /^(Solo una cuenta|Escribe lo relevante|Actualiza la nota|La nota|Esta nota|Terminó la hora|No se encontró|El turno|No se puede guardar)/.test(e.message)
  throw new ErrorBitacora(propio ? e.message as string : mensaje,
    mutacion && !(/^[\dA-Z]{5}$/.test(codigo) || ['PGRST202','PGRST203','PGRST301','PGRST302'].includes(codigo)))
}
function cancelada(signal: AbortSignal) { if (signal.aborted) throw new ErrorBitacora('La operación se canceló antes de enviarse.') }
export async function consultarLecturaBitacora(turnoId: string, signal: AbortSignal): Promise<RegistroBitacora | null> {
  cancelada(signal)
  if (!uuid(turnoId)) throw new ErrorBitacora('Selecciona un turno válido.')
  const { data, error } = await supabase.from('bitacora').select(seleccion).eq('turno_id',turnoId).is('eliminado_en',null)
    .order('capturado_en',{ascending:false}).order('id',{ascending:false}).limit(1).abortSignal(signal).maybeSingle()
  if (error) fallo(error,'No se pudo consultar la última nota del turno.')
  if (data === null) return null
  const registro = leerRegistroBitacora(data)
  if (registro.lectura.turno_id !== turnoId) throw new ErrorBitacora('La nota corresponde a otro turno. Actualiza.')
  return registro
}
export async function consultarHistorialBitacora(signal: AbortSignal): Promise<RegistroBitacora[]> {
  cancelada(signal)
  const lotes = await Promise.all((['calderas','ptar'] as const).map(async area => {
    const { data, error } = await supabase.from('bitacora').select(seleccion).eq('turno.area',area).is('eliminado_en',null)
      .order('capturado_en',{ascending:false}).order('id',{ascending:false}).limit(20).abortSignal(signal)
    if (error) fallo(error,'No se pudo consultar el historial de Bitácora.')
    if (!Array.isArray(data)) throw new ErrorBitacora('No se pudo comprobar el historial de Bitácora.')
    const registros = data.map(leerRegistroBitacora)
    if (registros.some(r => r.turno.area !== area) || new Set(registros.map(r => r.lectura.id)).size !== registros.length) throw new ErrorBitacora('Se recibieron notas repetidas o de otra área.')
    return registros
  }))
  return lotes.flat()
}
export async function guardarLecturaBitacora(cuentaId: string, solicitud: SolicitudGuardadoBitacora, signal: AbortSignal): Promise<LecturaBitacora> {
  cancelada(signal)
  const { valores, original } = solicitud
  if (!uuid(cuentaId) || !uuid(solicitud.id) || !uuid(solicitud.turnoId) || typeof valores.texto !== 'string' || !valores.texto.trim()
    || (original && (original.id !== solicitud.id || original.turno_id !== solicitud.turnoId || original.creado_por !== cuentaId))) throw new ErrorBitacora('Revisa la nota y su turno antes de guardar.')
  try {
    const { data, error } = await supabase.rpc('guardar_nota_bitacora', { p_id: solicitud.id, p_turno_id: solicitud.turnoId,
      p_texto: valores.texto.trim(), p_original: original ? originalBitacora(original) : null,
    }).abortSignal(signal).single()
    if (error) fallo(error,'No se pudo confirmar la nota. Reintenta la misma solicitud.',true)
    const m = leerLecturaBitacora(data,true)
    if (m.id !== solicitud.id || m.turno_id !== solicitud.turnoId || m.creado_por !== cuentaId || m.texto !== valores.texto.trim()
      || (original && (m.capturado_en !== original.capturado_en || m.recibido_en !== original.recibido_en))) throw new ErrorBitacora('No se pudo comprobar la confirmación. Reintenta la misma solicitud.',true)
    return m
  } catch (e) {
    if (e instanceof ErrorBitacora) throw e
    throw new ErrorBitacora('No llegó la confirmación de la nota. Reintenta la misma solicitud.',true)
  }
}
