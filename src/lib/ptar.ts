import { supabase } from './supabase'
import { esFechaOperativa, esTipoTurno } from './turnos'
import { medicionesPTAR } from './tiposPTAR'
import type { CamposPTAR, LecturaPTAR, RegistroPTAR, SolicitudGuardadoPTAR, ValoresPTAR } from './tiposPTAR'
export type { RegistroPTAR, SolicitudGuardadoPTAR } from './tiposPTAR'

export class ErrorPTAR extends Error {
  readonly resultadoIncierto: boolean
  constructor(mensaje: string, incierto = false) { super(mensaje); this.name = 'ErrorPTAR'; this.resultadoIncierto = incierto }
}
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(v)
const instante = (v: unknown): v is string => typeof v === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(v) && Number.isFinite(Date.parse(v))
function objeto(v: unknown, incierto = false): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ErrorPTAR('No se pudo comprobar la información de PTAR. Actualiza.', incierto)
  return v as Record<string, unknown>
}
function decimal(texto: string): string {
  const valor = texto.replace(',', '.').replace(/^\+/, '')
  const negativo = valor.startsWith('-')
  const [mantisa, exponente = '0'] = valor.replace(/^-/, '').toLowerCase().split('e')
  const [entera, fraccion = ''] = mantisa.split('.')
  const digitos = entera + fraccion, posicion = entera.length + Number(exponente)
  let limpio = (posicion <= 0 ? `0.${'0'.repeat(-posicion)}${digitos}`
    : posicion >= digitos.length ? digitos + '0'.repeat(posicion - digitos.length)
      : `${digitos.slice(0, posicion)}.${digitos.slice(posicion)}`)
    .replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  if (limpio.startsWith('.')) limpio = `0${limpio}`
  return /^0(?:\.0*)?$/.test(limpio) ? '0' : `${negativo ? '-' : ''}${limpio}`
}

export function validarCamposPTAR(campos: CamposPTAR): ValoresPTAR {
  const valores = {} as ValoresPTAR
  for (const { campo } of medicionesPTAR) {
    const texto = campos[campo]
    if (typeof texto !== 'string') throw new ErrorPTAR('Revisa las mediciones PTAR.')
    const limpio = texto.trim()
    if (!limpio) { valores[campo] = null; continue }
    if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(limpio)) throw new ErrorPTAR('Escribe números sin separadores de miles.')
    const valor = Number(limpio.replace(',', '.'))
    if (!Number.isFinite(valor) || Math.abs(valor) > Number.MAX_SAFE_INTEGER || decimal(limpio) !== decimal(String(valor))) throw new ErrorPTAR('Una medición tiene más cifras de las que se pueden conservar. Revisa el valor.')
    valores[campo] = valor === 0 ? 0 : valor
  }
  if (medicionesPTAR.every(({campo}) => valores[campo] === null)) throw new ErrorPTAR('Completa al menos una medición PTAR.')
  if (typeof campos.notas !== 'string') throw new ErrorPTAR('Revisa las notas.')
  valores.notas = campos.notas.trim() || null
  return valores
}
export function originalPTAR(m: ValoresPTAR): ValoresPTAR {
  const valores = {} as ValoresPTAR
  for (const {campo} of medicionesPTAR) valores[campo] = m[campo]
  valores.notas = m.notas
  return valores
}
export function leerLecturaPTAR(v: unknown, incierto = false): LecturaPTAR {
  const m = objeto(v, incierto)
  const { id, turno_id, notas, capturado_en, recibido_en, creado_por, eliminado_en, eliminado_por } = m
  if (!uuid(id) || !uuid(turno_id) || !uuid(creado_por) || (notas !== null && typeof notas !== 'string')
    || !instante(capturado_en) || !instante(recibido_en) || Date.parse(recibido_en) < Date.parse(capturado_en)
    || eliminado_en !== null || eliminado_por !== null) throw new ErrorPTAR('No se pudo comprobar la lectura guardada. Actualiza.', incierto)
  const valores = {} as ValoresPTAR
  for (const {campo} of medicionesPTAR) {
    const valor = m[campo]
    if (valor !== null && (typeof valor !== 'number' || !Number.isFinite(valor) || Math.abs(valor) > Number.MAX_SAFE_INTEGER)) throw new ErrorPTAR('No se pudo comprobar una medición PTAR. Actualiza.', incierto)
    valores[campo] = valor as number | null
  }
  if (medicionesPTAR.every(({campo}) => valores[campo] === null)) throw new ErrorPTAR('La lectura no contiene mediciones. Actualiza.', incierto)
  return { ...valores, notas, id, turno_id, capturado_en, recibido_en, creado_por, eliminado_en, eliminado_por }
}
export function leerRegistroPTAR(v: unknown): RegistroPTAR {
  const m = objeto(v), lectura = leerLecturaPTAR(m), t = objeto(m.turno), o = objeto(t.operador)
  const { id, fecha_operativa, area, turno, operador_id, iniciado_por, iniciado_en, finalizado_en, notas_cierre } = t
  if (id !== lectura.turno_id || !esFechaOperativa(fecha_operativa) || area !== 'ptar'
    || !esTipoTurno(turno) || !uuid(operador_id) || iniciado_por !== lectura.creado_por || !instante(iniciado_en)
    || Date.parse(lectura.capturado_en) < Date.parse(iniciado_en)
    || (finalizado_en !== null && (!instante(finalizado_en) || Date.parse(finalizado_en) < Date.parse(lectura.capturado_en)))
    || (notas_cierre !== null && typeof notas_cierre !== 'string') || o.id !== operador_id || typeof o.nombre !== 'string' || !o.nombre.trim()) {
    throw new ErrorPTAR('No se pudo comprobar el turno de la lectura. Actualiza.')
  }
  return { lectura, turno: { id, fecha_operativa, area, turno, operador_id, iniciado_por: lectura.creado_por, iniciado_en, finalizado_en, notas_cierre }, operadorNombre: o.nombre }
}
const seleccion = medicionesPTAR.map(m => m.campo).join(',') + ',id,turno_id,notas,capturado_en,recibido_en,creado_por,eliminado_en,eliminado_por,turno:turnos_operativos!inner(id,fecha_operativa,area,turno,operador_id,iniciado_por,iniciado_en,finalizado_en,notas_cierre,operador:operadores!inner(id,nombre))'
function fallo(error: unknown, mensaje: string, mutacion = false): never {
  const e = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const codigo = typeof e.code === 'string' ? e.code : ''
  const propio = ['42501','22023','23505','40001'].includes(codigo) && typeof e.message === 'string'
    && /^(Solo una cuenta|Selecciona un turno|Completa al menos|Actualiza la lectura|La lectura|Esta lectura|Terminó la hora|No se encontró|El turno|No se puede guardar)/.test(e.message)
  throw new ErrorPTAR(propio ? e.message as string : mensaje,
    mutacion && !(/^[\dA-Z]{5}$/.test(codigo) || ['PGRST202','PGRST203','PGRST301','PGRST302'].includes(codigo)))
}
function cancelada(signal: AbortSignal) { if (signal.aborted) throw new ErrorPTAR('La operación se canceló antes de enviarse.') }
export async function consultarLecturaPTAR(turnoId: string, signal: AbortSignal): Promise<RegistroPTAR | null> {
  cancelada(signal)
  if (!uuid(turnoId)) throw new ErrorPTAR('Selecciona un turno válido.')
  const { data, error } = await supabase.from('lecturas_ptar').select(seleccion).eq('turno_id',turnoId).is('eliminado_en',null)
    .order('capturado_en',{ascending:false}).order('id',{ascending:false}).limit(1).abortSignal(signal).maybeSingle()
  if (error) fallo(error,'No se pudo consultar la última lectura del turno.')
  if (data === null) return null
  const registro = leerRegistroPTAR(data)
  if (registro.lectura.turno_id !== turnoId) throw new ErrorPTAR('La lectura corresponde a otro turno. Actualiza.')
  return registro
}
export async function consultarHistorialPTAR(signal: AbortSignal): Promise<RegistroPTAR[]> {
  cancelada(signal)
  const { data, error } = await supabase.from('lecturas_ptar').select(seleccion).eq('turno.area','ptar').is('eliminado_en',null)
    .order('capturado_en',{ascending:false}).order('id',{ascending:false}).limit(20).abortSignal(signal)
  if (error) fallo(error,'No se pudo consultar el historial PTAR.')
  if (!Array.isArray(data)) throw new ErrorPTAR('No se pudo comprobar el historial PTAR.')
  const registros = data.map(leerRegistroPTAR)
  if (new Set(registros.map(r => r.lectura.id)).size !== registros.length) throw new ErrorPTAR('Se recibieron lecturas repetidas.')
  return registros
}
export async function guardarLecturaPTAR(cuentaId: string, solicitud: SolicitudGuardadoPTAR, signal: AbortSignal): Promise<LecturaPTAR> {
  cancelada(signal)
  const { valores, original } = solicitud
  if (!uuid(cuentaId) || !uuid(solicitud.id) || !uuid(solicitud.turnoId) || !medicionesPTAR.some(({campo}) => valores[campo] !== null) || medicionesPTAR.some(({campo}) => valores[campo] !== null && (typeof valores[campo] !== 'number' || !Number.isFinite(valores[campo]) || Math.abs(valores[campo]) > Number.MAX_SAFE_INTEGER)) || (valores.notas !== null && typeof valores.notas !== 'string')
    || (original && (original.id !== solicitud.id || original.turno_id !== solicitud.turnoId || original.creado_por !== cuentaId))) throw new ErrorPTAR('Revisa la lectura y su turno antes de guardar.')
  try {
    const { data, error } = await supabase.rpc('guardar_lectura_ptar', { p_id: solicitud.id, p_turno_id: solicitud.turnoId,
      p_mediciones: Object.fromEntries(medicionesPTAR.map(({campo}) => [campo, valores[campo]])), p_notas: valores.notas?.trim() || null, p_original: original ? originalPTAR(original) : null,
    }).abortSignal(signal).single()
    if (error) fallo(error,'No se pudo confirmar la lectura. Reintenta la misma solicitud.',true)
    const m = leerLecturaPTAR(data,true)
    if (m.id !== solicitud.id || m.turno_id !== solicitud.turnoId || m.creado_por !== cuentaId || JSON.stringify(originalPTAR(m)) !== JSON.stringify({ ...originalPTAR(valores), notas: valores.notas?.trim() || null })
      || (original && (m.capturado_en !== original.capturado_en || m.recibido_en !== original.recibido_en))) throw new ErrorPTAR('No se pudo comprobar la confirmación. Reintenta la misma solicitud.',true)
    return m
  } catch (e) {
    if (e instanceof ErrorPTAR) throw e
    throw new ErrorPTAR('No llegó la confirmación de la lectura. Reintenta la misma solicitud.',true)
  }
}
