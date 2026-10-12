import { supabase } from './supabase'
import { esFechaOperativa, esTipoTurno } from './turnos'
import type { AreaOperativa as AreaPlanta } from './tiposTurno'
import type { CamposCalidad, CatalogosCalidad, LecturaCalidad, RegistroCalidad,
  ResultadoCalidad, SolicitudGuardadoCalidad, ValoresCalidad } from './tiposCalidad'
export type { RegistroCalidad, SolicitudGuardadoCalidad } from './tiposCalidad'

export class ErrorCalidad extends Error {
  readonly resultadoIncierto: boolean
  constructor(mensaje: string, incierto = false) { super(mensaje); this.name = 'ErrorCalidad'; this.resultadoIncierto = incierto }
}
export const claveResultadoCalidad = (punto: string, parametro: string) => `${punto}:${parametro}`
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(v)
const numero = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER
const instante = (v: unknown): v is string => typeof v === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(v) && Number.isFinite(Date.parse(v))
function objeto(v: unknown, incierto = false): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ErrorCalidad('No se pudo comprobar la información de Calidad. Actualiza.', incierto)
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
export function validarCamposCalidad(campos: CamposCalidad): ValoresCalidad {
  const resultados: ValoresCalidad['resultados'][number][] = []
  for (const [clave, texto] of Object.entries(campos.valores)) {
    const [punto_id, parametro_id, extra] = clave.split(':')
    if (!uuid(punto_id) || !uuid(parametro_id) || extra !== undefined || typeof texto !== 'string') throw new ErrorCalidad('Revisa el punto y parámetro de cada resultado.')
    const limpio = texto.trim()
    if (!limpio) continue
    if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(limpio)) throw new ErrorCalidad('Escribe números sin separadores de miles en los resultados.')
    const valor = Number(limpio.replace(',', '.'))
    if (!numero(valor) || decimal(limpio) !== decimal(String(valor))) throw new ErrorCalidad('Un resultado tiene más cifras de las que se pueden conservar. Revisa el valor.')
    resultados.push({ id: '', punto_id, parametro_id, valor: valor === 0 ? 0 : valor })
  }
  if (!resultados.length) throw new ErrorCalidad('Escribe al menos un resultado de Calidad.')
  return { resultados, notas: campos.notas.trim() || null }
}
export function extraerValoresCalidad(m: LecturaCalidad): ValoresCalidad {
  return { notas: m.notas, resultados: m.resultados.map(({ id, punto_id, parametro_id, valor }) => ({ id, punto_id, parametro_id, valor })) }
}
export function originalCalidad(m: LecturaCalidad) {
  return { hora_muestra: m.hora_muestra, notas: m.notas,
    resultados: extraerValoresCalidad(m).resultados.slice().sort((a, b) => a.id.localeCompare(b.id)) }
}
function leerResultado(v: unknown, muestraId: string, incierto: boolean): ResultadoCalidad {
  const r = objeto(v, incierto), p = objeto(r.punto, incierto), q = objeto(r.parametro, incierto)
  const { id, muestra_id, punto_id, parametro_id, valor, limite_min_aplicado: min, limite_max_aplicado: max, fuera_norma } = r
  if (!uuid(id) || muestra_id !== muestraId || !uuid(punto_id) || !uuid(parametro_id) || !numero(valor)
    || (min !== null && !numero(min)) || (max !== null && !numero(max)) || (min !== null && max !== null && min > max)
    || p.id !== punto_id || typeof p.nombre !== 'string' || !p.nombre.trim() || ![null,'calderas','ptar'].includes(p.area as string | null)
    || q.id !== parametro_id || typeof q.nombre !== 'string' || !q.nombre.trim() || (q.unidad !== null && typeof q.unidad !== 'string')) {
    throw new ErrorCalidad('No se pudo comprobar un resultado de la muestra. Actualiza.', incierto)
  }
  const esperado = min === null && max === null ? null : (min !== null && valor < min) || (max !== null && valor > max)
  if (fuera_norma !== esperado) throw new ErrorCalidad('No se pudo comprobar la evaluación de Calidad. Actualiza.', incierto)
  return { id, muestra_id, punto_id, parametro_id, valor, limite_min_aplicado: min, limite_max_aplicado: max, fuera_norma: esperado,
    punto: { id: punto_id, nombre: p.nombre, area: p.area as AreaPlanta | null }, parametro: { id: parametro_id, nombre: q.nombre, unidad: q.unidad as string | null } }
}
export function leerRegistroCalidad(v: unknown, incierto = false): RegistroCalidad {
  const m = objeto(v, incierto), t = objeto(m.turno, incierto), o = objeto(t.operador, incierto)
  const { id, turno_id, hora_muestra, notas, capturado_en, recibido_en, creado_por, eliminado_en, eliminado_por } = m
  const { id: idTurno, fecha_operativa, area, turno, operador_id, iniciado_por, iniciado_en, finalizado_en, notas_cierre } = t
  if (!uuid(id) || !uuid(turno_id) || !uuid(creado_por) || !instante(capturado_en) || !instante(recibido_en)
    || Date.parse(recibido_en) < Date.parse(capturado_en) || eliminado_en !== null || eliminado_por !== null
    || typeof hora_muestra !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?$/.test(hora_muestra)
    || (notas !== null && typeof notas !== 'string') || idTurno !== turno_id || !esFechaOperativa(fecha_operativa)
    || (area !== 'calderas' && area !== 'ptar') || !esTipoTurno(turno) || !uuid(operador_id) || iniciado_por !== creado_por
    || !instante(iniciado_en) || Date.parse(capturado_en) < Date.parse(iniciado_en)
    || (finalizado_en !== null && (!instante(finalizado_en) || Date.parse(finalizado_en) < Date.parse(capturado_en)))
    || (notas_cierre !== null && typeof notas_cierre !== 'string') || o.id !== operador_id || typeof o.nombre !== 'string' || !o.nombre.trim()
    || !Array.isArray(m.resultados) || !m.resultados.length) throw new ErrorCalidad('No se pudo comprobar la muestra y su turno. Actualiza.', incierto)
  const resultados = m.resultados.map(r => leerResultado(r, id, incierto))
  if (new Set(resultados.map(r => r.id)).size !== resultados.length
    || new Set(resultados.map(r => claveResultadoCalidad(r.punto_id, r.parametro_id))).size !== resultados.length) {
    throw new ErrorCalidad('La muestra contiene resultados repetidos. Actualiza.', incierto)
  }
  return { lectura: { id, turno_id, hora_muestra, notas, capturado_en, recibido_en, creado_por, eliminado_en, eliminado_por, resultados },
    turno: { id: idTurno, fecha_operativa, area, turno, operador_id, iniciado_por: creado_por, iniciado_en, finalizado_en, notas_cierre }, operadorNombre: o.nombre }
}
const seleccion = 'id,turno_id,hora_muestra,notas,capturado_en,recibido_en,creado_por,eliminado_en,eliminado_por,turno:turnos_operativos!inner(id,fecha_operativa,area,turno,operador_id,iniciado_por,iniciado_en,finalizado_en,notas_cierre,operador:operadores!inner(id,nombre)),resultados:resultados_calidad(id,muestra_id,punto_id,parametro_id,valor,limite_min_aplicado,limite_max_aplicado,fuera_norma,punto:puntos_muestreo(id,nombre,area),parametro:parametros_calidad(id,nombre,unidad))'
function fallo(error: unknown, mensaje: string, mutacion = false): never {
  const e = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const codigo = typeof e.code === 'string' ? e.code : ''
  const propio = ['42501','22023','23505','40001'].includes(codigo) && typeof e.message === 'string'
    && /^(Solo una cuenta|La muestra|Escribe al menos|Revisa los puntos|No repitas|Actualiza la muestra|Esta muestra|La corrección|Terminó la hora|No se encontró la muestra|El turno|Selecciona puntos|No se puede guardar)/.test(e.message)
  throw new ErrorCalidad(propio ? e.message as string : mensaje,
    mutacion && !(/^[\dA-Z]{5}$/.test(codigo) || ['PGRST202','PGRST203','PGRST301','PGRST302'].includes(codigo)))
}
function cancelada(signal: AbortSignal) { if (signal.aborted) throw new ErrorCalidad('La operación se canceló antes de enviarse.') }
export async function consultarCatalogosCalidad(signal: AbortSignal): Promise<CatalogosCalidad> {
  cancelada(signal)
  const [p, q] = await Promise.all([
    supabase.from('puntos_muestreo').select('id,nombre,area,activo,orden').eq('activo',true).order('orden').order('id').abortSignal(signal),
    supabase.from('parametros_calidad').select('id,nombre,unidad,activo').eq('activo',true).order('nombre').order('id').abortSignal(signal),
  ])
  if (p.error || q.error) fallo(p.error || q.error, 'No se pudieron consultar los puntos y parámetros de Calidad.')
  if (!Array.isArray(p.data) || !Array.isArray(q.data)) throw new ErrorCalidad('No se pudo comprobar la lista de puntos y parámetros.')
  const puntos = p.data.map(v => { const r = objeto(v)
    if (!uuid(r.id) || typeof r.nombre !== 'string' || !r.nombre.trim() || ![null,'calderas','ptar'].includes(r.area as string | null)
      || r.activo !== true || !Number.isInteger(r.orden)) throw new ErrorCalidad('Revisa la configuración de los puntos de Calidad.')
    return { id: r.id, nombre: r.nombre, area: r.area as AreaPlanta | null, activo: true, orden: r.orden as number }
  })
  const parametros = q.data.map(v => { const r = objeto(v)
    if (!uuid(r.id) || typeof r.nombre !== 'string' || !r.nombre.trim() || r.activo !== true || (r.unidad !== null && typeof r.unidad !== 'string')) throw new ErrorCalidad('Revisa la configuración de los parámetros de Calidad.')
    return { id: r.id, nombre: r.nombre, unidad: r.unidad as string | null, activo: true }
  })
  if (new Set(puntos.map(punto => punto.id)).size !== puntos.length || new Set(parametros.map(parametro => parametro.id)).size !== parametros.length) throw new ErrorCalidad('Se recibieron puntos o parámetros repetidos.')
  return { puntos, parametros }
}
export async function consultarLecturaCalidad(turnoId: string, signal: AbortSignal): Promise<RegistroCalidad | null> {
  cancelada(signal)
  if (!uuid(turnoId)) throw new ErrorCalidad('Selecciona un turno válido.')
  const { data, error } = await supabase.from('muestras_calidad').select(seleccion).eq('turno_id',turnoId).is('eliminado_en',null)
    .order('capturado_en',{ascending:false}).order('id',{ascending:false}).limit(1).abortSignal(signal).maybeSingle()
  if (error) fallo(error,'No se pudo consultar la última muestra del turno.')
  if (data === null) return null
  const r = leerRegistroCalidad(data)
  if (r.lectura.turno_id !== turnoId) throw new ErrorCalidad('La muestra pertenece a otro turno. Actualiza.')
  return r
}
export async function consultarHistorialCalidad(signal: AbortSignal): Promise<RegistroCalidad[]> {
  cancelada(signal)
  const lotes = await Promise.all((['calderas','ptar'] as const).map(async area => {
    const { data, error } = await supabase.from('muestras_calidad').select(seleccion).eq('turno.area',area).is('eliminado_en',null)
      .order('capturado_en',{ascending:false}).order('id',{ascending:false}).limit(20).abortSignal(signal)
    if (error) fallo(error,'No se pudo consultar el historial de Calidad.')
    if (!Array.isArray(data)) throw new ErrorCalidad('No se pudo comprobar el historial de Calidad.')
    const registros = data.map(v => leerRegistroCalidad(v))
    if (registros.some(r => r.turno.area !== area) || new Set(registros.map(r => r.lectura.id)).size !== registros.length) throw new ErrorCalidad('El historial contiene muestras de otra área o repetidas.')
    return registros
  }))
  return lotes.flat()
}
export async function guardarLecturaCalidad(cuentaId: string, solicitud: SolicitudGuardadoCalidad, signal: AbortSignal): Promise<LecturaCalidad> {
  cancelada(signal)
  const { valores, original } = solicitud
  if (!uuid(cuentaId) || !uuid(solicitud.id) || !uuid(solicitud.turnoId) || !valores.resultados.length
    || valores.resultados.some(r => !uuid(r.id) || !uuid(r.punto_id) || !uuid(r.parametro_id) || !numero(r.valor))
    || new Set(valores.resultados.map(r => r.id)).size !== valores.resultados.length
    || new Set(valores.resultados.map(r => claveResultadoCalidad(r.punto_id,r.parametro_id))).size !== valores.resultados.length
    || (valores.notas !== null && typeof valores.notas !== 'string')
    || (original && (original.id !== solicitud.id || original.turno_id !== solicitud.turnoId || original.creado_por !== cuentaId))) throw new ErrorCalidad('Revisa la cuenta, turno y resultados antes de guardar.')
  try {
    const { data, error } = await supabase.rpc('guardar_muestra_calidad_online', {
      p_id: solicitud.id, p_turno_id: solicitud.turnoId, p_resultados: valores.resultados.map(({id,punto_id,parametro_id,valor}) => ({id,punto_id,parametro_id,valor})),
      p_notas: valores.notas?.trim() || null, p_original: original ? originalCalidad(original) : null,
    }).abortSignal(signal)
    if (error) fallo(error,'No se pudo confirmar la muestra. Reintenta la misma solicitud.',true)
    const m = leerRegistroCalidad(data,true).lectura
    const orden = (v: ValoresCalidad) => JSON.stringify(v.resultados.slice().sort((a,b) => a.id.localeCompare(b.id)))
    if (m.id !== solicitud.id || m.turno_id !== solicitud.turnoId || m.creado_por !== cuentaId || m.notas !== (valores.notas?.trim() || null)
      || orden(extraerValoresCalidad(m)) !== orden(valores) || (original && (m.hora_muestra !== original.hora_muestra
        || m.capturado_en !== original.capturado_en || m.recibido_en !== original.recibido_en
        || m.resultados.some(r => { const previo = original.resultados.find(p => p.id === r.id)
          return !previo || previo.limite_min_aplicado !== r.limite_min_aplicado || previo.limite_max_aplicado !== r.limite_max_aplicado })))) throw new ErrorCalidad('No se pudo comprobar la confirmación. Reintenta la misma solicitud.',true)
    return m
  } catch (e) {
    if (e instanceof ErrorCalidad) throw e
    throw new ErrorCalidad('No llegó la confirmación de la muestra. Reintenta la misma solicitud.',true)
  }
}
