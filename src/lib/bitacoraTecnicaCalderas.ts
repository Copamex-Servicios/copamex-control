import { supabase } from './supabase'
import { consultarResumenesTecnicosPlanta } from './reportesTecnicosPlanta'
import { borradorBitacoraCalderas, equiposCalderas, pilasCalderas, equiposAguaCalderas } from './tiposBitacoraCalderas'
import type { BorradorBitacoraCalderas } from './tiposBitacoraCalderas'
import { esFechaOperativa, esTipoTurno } from './turnos'
import type { TipoTurno } from './tiposTurno'

export interface ReporteTecnicoCalderas {
  id: string
  turnoId: string
  cuentaId: string
  creadoEn: string
  revision: number
  versionFormato: 1 | 2
  unidadCondensado: 'PSI' | 'kg/cm²'
  borrador: BorradorBitacoraCalderas
}
export class ErrorReporteCalderas extends Error {
  readonly incierto: boolean
  readonly conflicto: boolean
  constructor(mensaje: string, incierto = false, conflicto = false) {
    super(mensaje); this.incierto = incierto; this.conflicto = conflicto
  }
}
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(v)
function objeto(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ErrorReporteCalderas('No se pudo comprobar el reporte técnico. Actualiza la consulta.')
  return v as Record<string, unknown>
}
function numero(v: unknown): string {
  if (v === null) return ''
  if ((typeof v !== 'number' && typeof v !== 'string') || String(v).trim() === '' || !Number.isFinite(Number(v))) {
    throw new ErrorReporteCalderas('El reporte contiene una medición no reconocida.')
  }
  return String(v)
}
function opcion<T extends string>(v: unknown, opciones: readonly T[]): T | '' {
  if (v === null) return ''
  if (typeof v !== 'string' || !opciones.includes(v as T)) throw new ErrorReporteCalderas('El reporte contiene un estado no reconocido.')
  return v as T
}
function texto(v: unknown): string {
  if (v === null) return ''
  if (typeof v !== 'string') throw new ErrorReporteCalderas('El reporte contiene un comentario no reconocido.')
  return v
}
export function leerReporteCalderas(snapshot: unknown, turnoId: string): ReporteTecnicoCalderas {
  const s = objeto(snapshot), r = objeto(s.registro)
  if (!uuid(r.id) || r.turno_id !== turnoId || !uuid(r.creado_por) || (r.version_formato !== 1 && r.version_formato !== 2)
    || !Number.isSafeInteger(r.revision) || Number(r.revision) < 0 || typeof r.creado_en !== 'string'
    || !Number.isFinite(Date.parse(r.creado_en))) throw new ErrorReporteCalderas('No se pudo comprobar el turno del reporte técnico.')
  const borrador = borradorBitacoraCalderas()
  borrador.reporteRelevante = texto(r.reporte_relevante ?? null)
  const unidadCondensado = r.version_formato === 1 ? 'PSI' : 'kg/cm²'
  if (r.version_formato === 2 && r.presion_condensado_unidad !== 'kg/cm²') throw new ErrorReporteCalderas('No se pudo comprobar la unidad de condensado del reporte.')
  const camposServicio = { norte: 'bomba_norte_servicio', sur: 'bomba_sur_servicio', pozo1: 'pozo_1_servicio', pozo2: 'pozo_2_servicio' } as const
  for (const e of equiposAguaCalderas) {
    const valor = r[camposServicio[e.id]]
    if (r.version_formato === 2 && valor !== null && valor !== true) throw new ErrorReporteCalderas('No se pudo comprobar la selección en servicio.')
    borrador.servicioAgua[e.id] = r.version_formato === 2 && valor === true
  }
  for (const campo of Object.keys(borrador.mediciones) as (keyof typeof borrador.mediciones)[]) borrador.mediciones[campo] = numero(r[campo])
  borrador.estadoUF = opcion(r.estado_uf, ['Servicio', 'Alarmada (F/S)', 'Lavado'])
  borrador.comentariosUF = texto(r.comentarios_uf)
  if (!Array.isArray(s.equipos) || s.equipos.length !== 12 || !Array.isArray(s.pilas) || s.pilas.length !== 4) {
    throw new ErrorReporteCalderas('El detalle técnico está incompleto. Actualiza la consulta.')
  }
  const equipos = s.equipos.map(objeto), pilas = s.pilas.map(objeto)
  if (new Set(equipos.map(e => e.equipo)).size !== 12 || new Set(pilas.map(p => p.pila)).size !== 4
    || [...equipos, ...pilas].some(e => e.reporte_id !== r.id)) throw new ErrorReporteCalderas('El detalle técnico no corresponde al reporte.')
  for (const equipo of equiposCalderas) {
    const e = equipos.find(e => e.equipo === equipo.id)
    if (!e || (equipo.id.startsWith('caldera_') && (e.presion !== null || e.presion_unidad !== null))
      || (equipo.id.startsWith('sulzer_') && e.presion_unidad !== unidadCondensado)) throw new ErrorReporteCalderas('Revisa las unidades del reporte técnico.')
    borrador.equipos[equipo.id] = { estado: opcion(e.estado, ['Servicio', 'Reserva', 'Mantenimiento']), presion: numero(e.presion) }
  }
  for (const n of ['1', '2', '3', '4'] as const) {
    const e = equipos.find(e => e.equipo === `compresor_${n}`)
    if (!e) throw new ErrorReporteCalderas('Falta un compresor en el reporte técnico.')
    borrador.compresores[n] = opcion(e.estado, ['Servicio', 'Preparado', 'Mantenimiento'])
  }
  for (const pila of pilasCalderas) {
    const p = pilas.find(p => p.pila === pila.id)
    if (!p) throw new ErrorReporteCalderas('Falta una pila en el reporte técnico.')
    borrador.pilas[pila.id] = { nivel: numero(p.nivel), bomba: texto(p.bomba), presion: numero(p.presion) }
  }
  return { id: r.id, turnoId, cuentaId: r.creado_por, creadoEn: r.creado_en, revision: Number(r.revision),
    versionFormato: r.version_formato, unidadCondensado, borrador }
}

// Enviar decimales como texto evita redondearlos en JavaScript. PostgreSQL normaliza NULL y cero.
export function prepararDatosCalderas(b: BorradorBitacoraCalderas) {
  if (!b.reporteRelevante.trim() || b.reporteRelevante.trim().length > 4000) throw new ErrorReporteCalderas('Escribe el reporte relevante del turno (hasta 4,000 caracteres).')
  const medir = (v: string) => {
    if (!v.trim()) return null
    if (!Number.isFinite(Number(v))) throw new ErrorReporteCalderas('Revisa las mediciones numéricas antes de guardar.')
    return v.trim()
  }
  const equipos = Object.fromEntries(equiposCalderas.map(e => {
    if (e.id.startsWith('caldera_') && b.equipos[e.id].presion.trim()) throw new ErrorReporteCalderas('Las Calderas no registran presión.')
    return [e.id, { estado: b.equipos[e.id].estado || null, presion: medir(b.equipos[e.id].presion) }]
  }))
  return {
    reporteRelevante: b.reporteRelevante.trim(),
    versionFormato: 2 as const,
    servicioAgua: Object.fromEntries(equiposAguaCalderas.map(e => [e.id, b.servicioAgua[e.id] ? true : null])),
    mediciones: Object.fromEntries(Object.entries(b.mediciones).map(([k, v]) => [k, medir(v)])), equipos,
    pilas: Object.fromEntries(pilasCalderas.map(p => [p.id, { nivel: medir(b.pilas[p.id].nivel),
      bomba: b.pilas[p.id].bomba.trim() || null, presion: medir(b.pilas[p.id].presion) }])),
    compresores: Object.fromEntries(Object.entries(b.compresores).map(([k, v]) => [k, v || null])),
    estadoUF: b.estadoUF || null, comentariosUF: b.comentariosUF.trim() || null,
  }
}
export interface EnvioReporteCalderas {
  id: string
  turnoId: string
  cuentaId: string
  datos: ReturnType<typeof prepararDatosCalderas>
}
function fallo(error: unknown, mutacion = false): never {
  const e = objeto(error), codigo = typeof e.code === 'string' ? e.code : ''
  const definitivo = /^[\dA-Z]{5}$/.test(codigo) || ['PGRST202', 'PGRST203', 'PGRST301', 'PGRST302'].includes(codigo)
  const mensaje = mutacion && codigo === 'PGRST202' ? 'Falta instalar la actualización del reporte relevante del turno. La captura sigue disponible.'
    : codigo === '23505' ? 'El turno ya tiene un reporte o la solicitud ya fue utilizada. Actualiza la consulta.'
    : codigo === '42501' ? 'No está autorizado el guardado para esta cuenta y turno. Actualiza la consulta.'
    : codigo === '22023' ? 'Revisa los campos y las unidades del reporte técnico.'
    : mutacion ? 'No llegó la confirmación del reporte. Reintenta el envío original.' : 'No se pudo consultar el reporte técnico. Reintenta.'
  throw new ErrorReporteCalderas(mensaje, mutacion && !definitivo, codigo === '23505' || codigo === '42501')
}
export async function consultarReporteCalderas(turnoId: string, signal: AbortSignal): Promise<ReporteTecnicoCalderas | null> {
  const { data: cabecera, error } = await supabase.from('bitacora_calderas').select('id').eq('turno_id', turnoId).abortSignal(signal).maybeSingle()
  if (error) fallo(error)
  if (cabecera === null) return null
  const id = objeto(cabecera).id
  if (!uuid(id)) throw new ErrorReporteCalderas('No se pudo comprobar el identificador del reporte.')
  return consultarDetalleReporteCalderas(id, turnoId, signal)
}
export async function consultarDetalleReporteCalderas(id: string, turnoId: string, signal: AbortSignal, compartido = false): Promise<ReporteTecnicoCalderas> {
  if (!uuid(id) || !uuid(turnoId)) throw new ErrorReporteCalderas('El identificador del reporte no es válido.')
  const respuesta = await supabase.rpc(compartido ? 'consultar_bitacora_tecnica_planta' : 'consultar_bitacora_tecnica', { p_modulo: 'bitacora_calderas', p_id: id }).abortSignal(signal)
  if (respuesta.error) fallo(respuesta.error)
  const detalle = objeto(respuesta.data), turno = objeto(detalle.turno)
  const reporte = leerReporteCalderas(detalle.snapshot, turnoId)
  if (detalle.modulo !== 'bitacora_calderas' || turno.id !== turnoId || turno.area !== 'calderas' || reporte.id !== id) {
    throw new ErrorReporteCalderas('La consulta corresponde a otro turno o área.')
  }
  return reporte
}
export interface ResumenReporteCalderas {
  id: string
  turnoId: string
  fechaOperativa: string
  turno: TipoTurno
  operador: string
  creadoEn: string
  revision: number
}
export interface FiltrosReportesCalderas { desde: string; hasta: string; turno: TipoTurno | 'todos' }
export async function consultarHistorialReportesCalderas(filtros: FiltrosReportesCalderas, pagina: number, signal: AbortSignal, compartido = false) {
  if (!Number.isSafeInteger(pagina) || pagina < 0 || (filtros.desde && !esFechaOperativa(filtros.desde))
    || (filtros.hasta && !esFechaOperativa(filtros.hasta)) || (filtros.turno !== 'todos' && !esTipoTurno(filtros.turno))
    || (filtros.desde && filtros.hasta && filtros.desde > filtros.hasta)) throw new ErrorReporteCalderas('Revisa las fechas y el turno de la consulta.')
  if (compartido) return consultarResumenesTecnicosPlanta('calderas', filtros, pagina, signal)
  // La misma consulta sirve a la cuenta del área y a Administración; RLS decide la lectura.
  let consulta = supabase.from('bitacora_calderas').select(
    'id,turno_id,creado_en,revision,turno:turnos_operativos!inner(id,fecha_operativa,area,turno,operador:operadores!inner(nombre))',
  ).eq('turno.area', 'calderas')
  if (filtros.desde) consulta = consulta.gte('turno.fecha_operativa', filtros.desde)
  if (filtros.hasta) consulta = consulta.lte('turno.fecha_operativa', filtros.hasta)
  if (filtros.turno !== 'todos') consulta = consulta.eq('turno.turno', filtros.turno)
  const { data, error } = await consulta.order('creado_en', { ascending: false }).order('id', { ascending: false })
    .range(pagina * 20, pagina * 20 + 20).abortSignal(signal)
  if (error) fallo(error)
  if (!Array.isArray(data)) throw new ErrorReporteCalderas('No se pudo comprobar el historial técnico.')
  const filas = data.slice(0, 20).map(v => {
    const r = objeto(v), t = objeto(r.turno), o = objeto(t.operador)
    if (!uuid(r.id) || !uuid(r.turno_id) || t.id !== r.turno_id || t.area !== 'calderas' || !esFechaOperativa(t.fecha_operativa)
      || !esTipoTurno(t.turno) || typeof o.nombre !== 'string' || !o.nombre.trim() || typeof r.creado_en !== 'string'
      || !Number.isFinite(Date.parse(r.creado_en)) || !Number.isSafeInteger(r.revision) || Number(r.revision) < 0) {
      throw new ErrorReporteCalderas('Se recibió un reporte con datos de turno incompletos.')
    }
    return { id: r.id, turnoId: r.turno_id, fechaOperativa: t.fecha_operativa, turno: t.turno,
      operador: o.nombre, creadoEn: r.creado_en, revision: Number(r.revision) } satisfies ResumenReporteCalderas
  })
  if (new Set(filas.map(r => r.id)).size !== filas.length) throw new ErrorReporteCalderas('Se recibieron reportes técnicos repetidos.')
  return { filas, hayMas: data.length > 20 }
}
export async function enviarReporteCalderas(envio: EnvioReporteCalderas, signal: AbortSignal): Promise<ReporteTecnicoCalderas> {
  let respuestaRPC
  try {
    respuestaRPC = await supabase.rpc('guardar_bitacora_tecnica_calderas_v3', {
      p_id: envio.id, p_turno_id: envio.turnoId, p_datos: envio.datos,
    }).abortSignal(signal)
  } catch {
    throw new ErrorReporteCalderas('No llegó la confirmación del reporte. Reintenta el envío original.', true)
  }
  if (respuestaRPC.error) fallo(respuestaRPC.error, true)
  try {
    const respuesta = objeto(respuestaRPC.data)
    const reporte = leerReporteCalderas(respuesta.snapshot, envio.turnoId)
    if (respuesta.confirmado !== true || typeof respuesta.reintento !== 'boolean' || respuesta.id !== envio.id
      || reporte.id !== envio.id || reporte.cuentaId !== envio.cuentaId || reporte.versionFormato !== 2) throw new Error('Confirmación inconsistente')
    return reporte
  } catch (e) {
    throw new ErrorReporteCalderas(e instanceof ErrorReporteCalderas ? e.message : 'No llegó una confirmación válida. Reintenta el envío original.', true)
  }
}
