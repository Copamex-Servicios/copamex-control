import { exigirCuentaReporte } from './reporteOperativo'
import { leerReportesIndividuales, prepararReportesIndividuales } from './reportesIndividuales'
import { supabase } from './supabase'
import { mayusculasNota, normalizarNota } from './notasOperativas'
import { consultarResumenesTecnicosPlanta } from './reportesTecnicosPlanta'
import { borradorBitacoraPTAR, medicionesBitacoraPTAR, bombasBitacoraPTAR, prensasBitacoraPTAR, destinosDescargaPTAR, normalizarVelocidadesPrensas } from './tiposBitacoraPTAR'
import type { BorradorBitacoraPTAR } from './tiposBitacoraPTAR'
import { esFechaOperativa, esTipoTurno } from './turnos'
import type { TipoTurno } from './tiposTurno'
import { etiquetaOperadoresTurno, relacionOperadorAcompanante, relacionOperadorPrincipal } from './tiposTurno'

export interface ReporteTecnicoPTAR {
  id: string
  turnoId: string
  cuentaId: string
  creadoEn: string
  revision: number
  borrador: BorradorBitacoraPTAR
}
export class ErrorReportePTAR extends Error {
  readonly incierto: boolean
  readonly conflicto: boolean
  readonly sinCambios: boolean
  constructor(mensaje: string, incierto = false, conflicto = false, sinCambios = false) {
    super(mensaje); this.incierto = incierto; this.conflicto = conflicto; this.sinCambios = sinCambios
  }
}
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(v)
function objeto(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ErrorReportePTAR('No se pudo comprobar el reporte técnico. Actualiza la consulta.')
  return v as Record<string, unknown>
}
function numero(v: unknown): string {
  if (v === null) return ''
  if ((typeof v !== 'number' && typeof v !== 'string') || String(v).trim() === '' || !Number.isFinite(Number(v))) {
    throw new ErrorReportePTAR('El reporte contiene una medición no reconocida.')
  }
  return String(v)
}
function opcion<T extends string>(v: unknown, opciones: readonly T[]): T | '' {
  if (v === null) return ''
  if (typeof v !== 'string' || !opciones.includes(v as T)) throw new ErrorReportePTAR('El reporte contiene un estado no reconocido.')
  return v as T
}
function texto(v: unknown): string {
  if (v === null) return ''
  if (typeof v !== 'string') throw new ErrorReportePTAR('El reporte contiene un comentario no reconocido.')
  return v
}
export function leerReportePTAR(snapshot: unknown, turnoId: string): ReporteTecnicoPTAR {
  const s = objeto(snapshot), r = objeto(s.registro)
  if (!uuid(r.id) || r.turno_id !== turnoId || !uuid(r.creado_por) || r.version_formato !== 1
    || !Number.isSafeInteger(r.revision) || Number(r.revision) < 0 || typeof r.creado_en !== 'string'
    || !Number.isFinite(Date.parse(r.creado_en))) throw new ErrorReportePTAR('No se pudo comprobar el turno del reporte técnico.')
  const borrador = borradorBitacoraPTAR()
  borrador.reporteRelevante = texto(r.reporte_relevante ?? null)
  const reportes = leerReportesIndividuales(r.reportes_operadores)
  if (reportes) borrador.reportesOperadores = reportes
  for (const m of medicionesBitacoraPTAR) borrador.mediciones[m.campo] = numero(r[m.campo])
  borrador.estadoAgitador = opcion(r.estado_agitador_9300, ['Servicio', 'Reserva', 'Mantenimiento'])
  borrador.destinoDescarga = opcion(r.destino_descarga_daf, destinosDescargaPTAR)
  borrador.horasDescarga = { tanque11: numero(r.horas_descarga_tanque_11), tanques56: numero(r.horas_descarga_tanques_5_6) }
  for (const n of bombasBitacoraPTAR) {
    const modo = opcion(r[`modo_bomba_${n}`], ['A', 'M'])
    borrador.bombas[n] = modo === 'A' ? 'Automático (A)' : modo === 'M' ? 'Manual (M)' : ''
  }
  for (const prensa of prensasBitacoraPTAR) borrador.prensas[prensa] = opcion(r[`estado_prensa_${prensa.toLowerCase()}`], ['Servicio', 'Reserva', 'Mantenimiento'])
  for (const prensa of prensasBitacoraPTAR) borrador.velocidadesPrensas[prensa] = numero(r['velocidad_prensa_' + prensa.toLowerCase()] ?? null)
  borrador.comentarioPrensas = texto(r.comentario_prensas)
  return { id: r.id, turnoId, cuentaId: r.creado_por, creadoEn: r.creado_en, revision: Number(r.revision), borrador }
}

// Decimales como texto, sin redondear ni aplicar conversiones.
export function prepararDatosPTAR(b: BorradorBitacoraPTAR, original?: BorradorBitacoraPTAR) {
  const reportesOperadores = prepararReportesIndividuales(b.reportesOperadores)
  if (!b.reporteRelevante.trim() || mayusculasNota(b.reporteRelevante).trim().length > 4000) throw new ErrorReportePTAR('Escribe el reporte relevante del turno (hasta 4,000 caracteres).')
  const velocidadesPrensas = normalizarVelocidadesPrensas(b.velocidadesPrensas)
    ?? (original && normalizarVelocidadesPrensas(original.velocidadesPrensas) ? { Essity: null, Nalco: null } : undefined)
  const medir = (v: string, campo: string) => {
    if (!v.trim()) throw new ErrorReportePTAR(`Completa el campo: ${campo}.`)
    if (!Number.isFinite(Number(v))) throw new ErrorReportePTAR('Revisa las mediciones numéricas antes de guardar.')
    return v.trim()
  }
  const elegir = (v: string, opciones: readonly string[], campo: string) => {
    if (!opciones.includes(v)) throw new ErrorReportePTAR(`Selecciona una opción para: ${campo}.`)
    return v
  }
  const horas = (v: string, campo: string) => {
    if (!v.trim() || !Number.isFinite(Number(v)) || Number(v) < 0) throw new ErrorReportePTAR(`Registra horas válidas para ${campo}.`)
    return v.trim()
  }
  return {
    reporteRelevante: mayusculasNota(b.reporteRelevante).trim(),
    ...(reportesOperadores ? { reportesOperadores } : {}),
    ...(velocidadesPrensas ? { velocidadesPrensas } : {}),
    mediciones: Object.fromEntries(medicionesBitacoraPTAR.map(m => [m.campo, medir(b.mediciones[m.campo], m.nombre)])),
    estadoAgitador: elegir(b.estadoAgitador, ['Servicio', 'Reserva', 'Mantenimiento'], 'Estado del agitador 9300'),
    destinoDescarga: elegir(b.destinoDescarga, destinosDescargaPTAR, 'Descarga del DAF Chino'),
    horasDescarga: { tanque11: horas(b.horasDescarga.tanque11, 'tanque 11'), tanques56: horas(b.horasDescarga.tanques56, 'tanques 5 y 6') },
    bombas: Object.fromEntries(bombasBitacoraPTAR.map(n => [n, elegir(b.bombas[n], ['Automático (A)', 'Manual (M)'], `Modo de la bomba ${n}`)])),
    prensas: Object.fromEntries(prensasBitacoraPTAR.map(n => [n, elegir(b.prensas[n], ['Servicio', 'Reserva', 'Mantenimiento'], `Estado de la prensa ${n}`)])),
    comentarioPrensas: normalizarNota(b.comentarioPrensas),
  }
}
export interface EnvioReportePTAR {
  operativo?: boolean
  supervisor?: boolean
  reporteId?: string
  revisionEsperada?: number
  creadoEn?: string
  id: string
  turnoId: string
  cuentaId: string
  datos: ReturnType<typeof prepararDatosPTAR>
}
function fallo(error: unknown, mutacion = false): never {
  const e = objeto(error), codigo = typeof e.code === 'string' ? e.code : ''
  if (mutacion && codigo === '22023' && e.message === 'No hay cambios para registrar.') {
    throw new ErrorReportePTAR('No hay cambios para guardar.', false, false, true)
  }
  const definitivo = /^[\dA-Z]{5}$/.test(codigo) || ['PGRST202', 'PGRST203', 'PGRST301', 'PGRST302'].includes(codigo)
  const mensaje = mutacion && codigo === 'PGRST202' ? 'Falta instalar la actualización del reporte relevante del turno. La captura sigue disponible.'
    : codigo === '40001' ? 'El reporte cambió. Actualiza antes de corregir.'
    : codigo === '23505' ? 'El turno ya tiene un reporte o la solicitud ya fue utilizada. Actualiza la consulta.'
    : codigo === '42501' ? 'No está autorizado el guardado para esta cuenta y turno. Actualiza la consulta.'
    : codigo === '22023' ? 'Revisa los campos y las unidades del reporte técnico.'
    : mutacion ? 'No llegó la confirmación del reporte. Reintenta el envío original.' : 'No se pudo consultar el reporte técnico. Reintenta.'
  throw new ErrorReportePTAR(mensaje, mutacion && !definitivo, codigo === '40001' || codigo === '23505' || codigo === '42501')
}
export async function consultarReportePTAR(turnoId: string, signal: AbortSignal): Promise<ReporteTecnicoPTAR | null> {
  const { data: cabecera, error } = await supabase.from('bitacora_ptar').select('id').eq('turno_id', turnoId).abortSignal(signal).maybeSingle()
  if (error) fallo(error)
  if (cabecera === null) return null
  const id = objeto(cabecera).id
  if (!uuid(id)) throw new ErrorReportePTAR('No se pudo comprobar el identificador del reporte.')
  return consultarDetalleReportePTAR(id, turnoId, signal)
}
export async function consultarDetalleReportePTAR(id: string, turnoId: string, signal: AbortSignal, compartido = false): Promise<ReporteTecnicoPTAR> {
  if (!uuid(id) || !uuid(turnoId)) throw new ErrorReportePTAR('El identificador del reporte no es válido.')
  const respuesta = await supabase.rpc(compartido ? 'consultar_bitacora_tecnica_planta' : 'consultar_bitacora_tecnica', { p_modulo: 'bitacora_ptar', p_id: id }).abortSignal(signal)
  if (respuesta.error) fallo(respuesta.error)
  const detalle = objeto(respuesta.data), turno = objeto(detalle.turno)
  const reporte = leerReportePTAR(detalle.snapshot, turnoId)
  if (detalle.modulo !== 'bitacora_ptar' || turno.id !== turnoId || turno.area !== 'ptar' || reporte.id !== id) {
    throw new ErrorReportePTAR('La consulta corresponde a otro turno o área.')
  }
  return reporte
}
export interface ResumenReportePTAR {
  id: string
  turnoId: string
  fechaOperativa: string
  turno: TipoTurno
  operador: string
  creadoEn: string
  revision: number
}
export interface FiltrosReportesPTAR { desde: string; hasta: string; turno: TipoTurno | 'todos' }
export async function consultarHistorialReportesPTAR(filtros: FiltrosReportesPTAR, pagina: number, signal: AbortSignal, compartido = false) {
  if (!Number.isSafeInteger(pagina) || pagina < 0 || (filtros.desde && !esFechaOperativa(filtros.desde))
    || (filtros.hasta && !esFechaOperativa(filtros.hasta)) || (filtros.turno !== 'todos' && !esTipoTurno(filtros.turno))
    || (filtros.desde && filtros.hasta && filtros.desde > filtros.hasta)) throw new ErrorReportePTAR('Revisa las fechas y el turno de la consulta.')
  if (compartido) return consultarResumenesTecnicosPlanta('ptar', filtros, pagina, signal)
  // La misma consulta sirve a la cuenta del área y a Administración; RLS decide la lectura.
  let consulta = supabase.from('bitacora_ptar').select(
    `id,turno_id,creado_en,revision,turno:turnos_operativos!inner(id,fecha_operativa,area,turno,operador_id,operador_acompanante_id,${relacionOperadorPrincipal},${relacionOperadorAcompanante})`,
  ).eq('turno.area', 'ptar')
  if (filtros.desde) consulta = consulta.gte('turno.fecha_operativa', filtros.desde)
  if (filtros.hasta) consulta = consulta.lte('turno.fecha_operativa', filtros.hasta)
  if (filtros.turno !== 'todos') consulta = consulta.eq('turno.turno', filtros.turno)
  const { data, error } = await consulta.order('creado_en', { ascending: false }).order('id', { ascending: false })
    .range(pagina * 20, pagina * 20 + 20).abortSignal(signal)
  if (error) fallo(error)
  if (!Array.isArray(data)) throw new ErrorReportePTAR('No se pudo comprobar el historial técnico.')
  const filas = data.slice(0, 20).map(v => {
    const r = objeto(v), t = objeto(r.turno), o = objeto(t.operador)
    const oa = t.operador_acompanante === null ? null : objeto(t.operador_acompanante)
    if (!uuid(r.id) || !uuid(r.turno_id) || t.id !== r.turno_id || t.area !== 'ptar' || !esFechaOperativa(t.fecha_operativa)
      || !esTipoTurno(t.turno) || typeof o.nombre !== 'string' || !o.nombre.trim()
      || (t.operador_acompanante_id === null ? oa !== null : typeof oa?.nombre !== 'string' || !String(oa.nombre).trim())
      || typeof r.creado_en !== 'string'
      || !Number.isFinite(Date.parse(r.creado_en)) || !Number.isSafeInteger(r.revision) || Number(r.revision) < 0) {
      throw new ErrorReportePTAR('Se recibió un reporte con datos de turno incompletos.')
    }
    return { id: r.id, turnoId: r.turno_id, fechaOperativa: t.fecha_operativa, turno: t.turno,
      operador: etiquetaOperadoresTurno(o.nombre, typeof oa?.nombre === 'string' ? oa.nombre : null), creadoEn: r.creado_en, revision: Number(r.revision) } satisfies ResumenReportePTAR
  })
  if (new Set(filas.map(r => r.id)).size !== filas.length) throw new ErrorReportePTAR('Se recibieron reportes técnicos repetidos.')
  return { filas, hayMas: data.length > 20 }
}
export async function enviarReportePTAR(envio: EnvioReportePTAR, signal: AbortSignal): Promise<ReporteTecnicoPTAR> {
  if (envio.operativo) exigirCuentaReporte(envio.cuentaId, "ptar", envio.supervisor)
  let respuestaRPC
  try {
    respuestaRPC = await supabase.rpc(envio.operativo ? 'guardar_reporte_operativo' : 'guardar_bitacora_tecnica_ptar_v2', {
      p_id: envio.id, p_turno_id: envio.turnoId, p_datos: envio.datos,
      ...(envio.operativo ? { p_area: "ptar", p_reporte_id: envio.reporteId ?? null, p_revision_esperada: envio.revisionEsperada ?? null } : {}),
    }).abortSignal(signal)
  } catch {
    throw new ErrorReportePTAR('No llegó la confirmación del reporte. Reintenta el envío original.', true)
  }
  if (envio.operativo) exigirCuentaReporte(envio.cuentaId, "ptar", envio.supervisor)
  if (respuestaRPC.error) fallo(respuestaRPC.error, true)
  try {
    const respuesta = objeto(respuestaRPC.data)
    const reporte = leerReportePTAR(respuesta.snapshot, envio.turnoId)
    if (respuesta.confirmado !== true || typeof respuesta.reintento !== 'boolean' || respuesta.id !== envio.id
      || reporte.id !== (envio.reporteId ?? envio.id) || reporte.cuentaId !== envio.cuentaId) throw new Error('Confirmación inconsistente')
    if (envio.reporteId && (envio.revisionEsperada === undefined || reporte.revision < envio.revisionEsperada + 1 || reporte.creadoEn !== envio.creadoEn)) throw new Error('La respuesta no confirma esta corrección.')
    return reporte
  } catch (e) {
    throw new ErrorReportePTAR(e instanceof ErrorReportePTAR ? e.message : 'No llegó una confirmación válida. Reintenta el envío original.', true)
  }
}
