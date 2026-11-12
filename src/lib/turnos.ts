import { supabase } from './supabase'
import type { AreaOperativa, Operador, TipoTurno, TurnoOperativo } from './tiposTurno'

export interface ContextoCuentaTurno {
  cuentaId: string
  area: AreaOperativa
}

export interface SolicitudInicioTurno {
  id: string
  tipoTurno: TipoTurno
  nombreOperador: string
  operadorId: string
  numeroEmpleado: string
  nombreOperadorAcompanante: string
  operadorAcompananteId: string
  numeroEmpleadoAcompanante: string
  turnoAnterior: string | null
}

export interface DatosConsultadosTurno {
  operadores: Operador[]
  turno: TurnoOperativo | null
}

export class ErrorTurnos extends Error {
  readonly resultadoIncierto: boolean

  constructor(mensaje: string, resultadoIncierto = false) {
    super(mensaje)
    this.name = 'ErrorTurnos'
    this.resultadoIncierto = resultadoIncierto
  }
}

const columnasOperador = 'id,nombre,numero_empleado,activo,creado_en'
const columnasTurno = 'id,fecha_operativa,area,turno,operador_id,operador_acompanante_id,iniciado_por,iniciado_en,finalizado_en,notas_cierre'

function esUuid(valor: unknown): valor is string {
  return typeof valor === 'string'
    && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(valor)
}

export function esTipoTurno(valor: unknown): valor is TipoTurno {
  return valor === 'dia' || valor === 'tarde' || valor === 'noche'
}

export function tipoTurnoPorHora(hora: string | null): TipoTurno | null {
  if (!hora || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(hora)) return null
  if (hora >= '07:01' && hora < '15:01') return 'dia'
  if (hora >= '15:01' && hora < '21:01') return 'tarde'
  return 'noche'
}

export function esFechaOperativa(valor: unknown): valor is string {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false
  const fecha = new Date(`${valor}T00:00:00Z`)
  return Number.isFinite(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor
}

export function normalizarNombreOperador(nombre: string): string {
  return nombre.replace(/\s+/gu, ' ').trim()
}

function esInstante(valor: unknown): valor is string {
  return typeof valor === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(valor)
    && Number.isFinite(Date.parse(valor))
}

function leerFila(valor: unknown, incierto = false): Record<string, unknown> {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new ErrorTurnos('No se pudo comprobar la información del turno. Revisa la información antes de continuar.', incierto)
  }
  return valor as Record<string, unknown>
}

function leerOperador(valor: unknown): Operador {
  const { id, nombre, numero_empleado, activo, creado_en } = leerFila(valor)
  if (!esUuid(id) || typeof nombre !== 'string' || !nombre.trim()
    || (numero_empleado !== null && typeof numero_empleado !== 'string')
    || typeof activo !== 'boolean' || !esInstante(creado_en)) {
    throw new ErrorTurnos('No se pudo comprobar el catálogo de operadores. Reintenta la consulta.')
  }
  return { id, nombre, numero_empleado, activo, creado_en }
}

function leerTurno(valor: unknown, incierto = false): TurnoOperativo {
  const { id, fecha_operativa, area, turno, operador_id, operador_acompanante_id, iniciado_por,
    iniciado_en, finalizado_en, notas_cierre } = leerFila(valor, incierto)
  if (!esUuid(id) || !esFechaOperativa(fecha_operativa)
    || (area !== 'calderas' && area !== 'ptar') || !esTipoTurno(turno)
    || !esUuid(operador_id) || (operador_acompanante_id !== null && !esUuid(operador_acompanante_id))
    || operador_acompanante_id === operador_id || !esUuid(iniciado_por) || !esInstante(iniciado_en)
    || (finalizado_en !== null && (!esInstante(finalizado_en)
      || Date.parse(finalizado_en) < Date.parse(iniciado_en)))
    || (notas_cierre !== null && typeof notas_cierre !== 'string')) {
    throw new ErrorTurnos('No se pudo comprobar la información del turno. Revisa la información antes de continuar.', incierto)
  }
  return { id, fecha_operativa, area, turno, operador_id, operador_acompanante_id, iniciado_por,
    iniciado_en, finalizado_en, notas_cierre }
}

function comprobarContexto(contexto: ContextoCuentaTurno): void {
  if (!esUuid(contexto.cuentaId) || (contexto.area !== 'calderas' && contexto.area !== 'ptar')) {
    throw new ErrorTurnos('Se necesita una cuenta de área activa para gestionar el turno.')
  }
}

function comprobarCancelacion(signal: AbortSignal): void {
  if (signal.aborted) throw new ErrorTurnos('La operación fue cancelada antes de enviarse.')
}

function lanzarFallo(fallo: unknown, mensaje: string, mutacion = false): never {
  const fila = fallo && typeof fallo === 'object' ? fallo as Record<string, unknown> : null
  const codigo = typeof fila?.code === 'string' ? fila.code : ''
  const mensajeServidor = typeof fila?.message === 'string' ? fila.message : ''
  if (codigo === 'PGRST202' || codigo === '42883') throw new ErrorTurnos('Falta instalar la migración de inicio de turno con dos operadores en Supabase.')
  const respuestaDeBase = /^[\dA-Z]{5}$/.test(codigo) || /^PGRST\d{3}$/.test(codigo)
  // Las funciones propias devuelven mensajes en español para estos errores.
  const mensajePropio = ['22023', '42501', '23505'].includes(codigo)
    && /^(Solo una cuenta|Identifica dos operadores|Selecciona dos operadores|Escribe el número|No se encontró ese número|El operador cambió|Escribe el nombre|Hay varios operadores|Ese operador|Selecciona el tipo de turno|Selecciona el turno que corresponde al horario actual del servidor\.|Ese identificador|Ya existe ese tipo|Hay un turno abierto|Ese turno pertenece|El turno anterior|No se pudo cerrar|Indica el turno|No se encontró el turno|Esta cuenta|El turno ya)/.test(mensajeServidor)
  throw new ErrorTurnos(mensajePropio ? mensajeServidor : mensaje, mutacion && !respuestaDeBase)
}

export async function consultarDatosTurno(
  area: AreaOperativa, signal: AbortSignal,
): Promise<DatosConsultadosTurno> {
  if (area !== 'calderas' && area !== 'ptar') throw new ErrorTurnos('Selecciona un área válida.')
  comprobarCancelacion(signal)
  try {
    const [catalogo, abierto] = await Promise.all([
      supabase.from('operadores').select(columnasOperador).order('nombre').abortSignal(signal),
      supabase.from('turnos_operativos').select(columnasTurno)
        .eq('area', area).is('finalizado_en', null).abortSignal(signal).maybeSingle(),
    ])
    if (catalogo.error) lanzarFallo(catalogo.error, 'No se pudieron consultar los operadores. Reintenta.')
    if (abierto.error) lanzarFallo(abierto.error, 'No se pudo consultar el turno abierto. Reintenta.')
    if (!Array.isArray(catalogo.data)) throw new ErrorTurnos('No se pudo comprobar el catálogo de operadores. Reintenta.')
    const operadores = catalogo.data.map(leerOperador)
    const turno = abierto.data === null ? null : leerTurno(abierto.data)
    if (turno && (turno.area !== area || turno.finalizado_en !== null)) {
      throw new ErrorTurnos('La información recibida no corresponde al turno abierto del área. Reintenta.')
    }
    if (turno && !operadores.some((operador) => operador.id === turno.operador_id)) {
      throw new ErrorTurnos('No se pudo obtener el nombre del operador del turno. Reintenta la consulta.')
    }
    if (turno?.operador_acompanante_id && !operadores.some((operador) => operador.id === turno.operador_acompanante_id)) {
      throw new ErrorTurnos('No se pudo obtener el nombre del segundo operador del turno. Reintenta la consulta.')
    }
    return { operadores, turno }
  } catch (fallo) {
    if (fallo instanceof ErrorTurnos) throw fallo
    throw new ErrorTurnos('No se pudo consultar el turno. Revisa la conexión e intenta de nuevo.')
  }
}

export async function iniciarTurno(
  contexto: ContextoCuentaTurno, solicitud: SolicitudInicioTurno, signal: AbortSignal,
): Promise<TurnoOperativo> {
  comprobarContexto(contexto)
  comprobarCancelacion(signal)
  const nombre = normalizarNombreOperador(solicitud.nombreOperador)
  const nombreAcompanante = normalizarNombreOperador(solicitud.nombreOperadorAcompanante)
  if (!esUuid(solicitud.id) || !esTipoTurno(solicitud.tipoTurno) || !nombre || !esUuid(solicitud.operadorId) || !solicitud.numeroEmpleado.trim()
    || !nombreAcompanante || !esUuid(solicitud.operadorAcompananteId) || !solicitud.numeroEmpleadoAcompanante.trim()
    || solicitud.operadorId === solicitud.operadorAcompananteId
    || (solicitud.turnoAnterior !== null && !esUuid(solicitud.turnoAnterior))) {
    throw new ErrorTurnos('Selecciona el tipo de turno e identifica dos operadores distintos.')
  }
  try {
    const { data, error } = await supabase.rpc('iniciar_turno_pareja_empleado', {
      p_id: solicitud.id,
      p_turno: solicitud.tipoTurno,
      p_numero_empleado: solicitud.numeroEmpleado.trim(),
      p_operador: solicitud.operadorId,
      p_nombre_operador: nombre,
      p_numero_empleado_acompanante: solicitud.numeroEmpleadoAcompanante.trim(),
      p_operador_acompanante: solicitud.operadorAcompananteId,
      p_nombre_operador_acompanante: nombreAcompanante,
      p_turno_anterior: solicitud.turnoAnterior,
    }).abortSignal(signal).single()
    if (error) lanzarFallo(error, 'No se pudo iniciar el turno. Revisa la información antes de reintentar.', true)
    const turno = leerTurno(data, true)
    if (turno.id.toLowerCase() !== solicitud.id.toLowerCase()
      || turno.area !== contexto.area || turno.iniciado_por.toLowerCase() !== contexto.cuentaId.toLowerCase()
      || turno.turno !== solicitud.tipoTurno || turno.operador_id !== solicitud.operadorId
      || turno.operador_acompanante_id !== solicitud.operadorAcompananteId) {
      throw new ErrorTurnos('No se pudo comprobar el turno guardado. Revisa la información antes de continuar.', true)
    }
    return turno
  } catch (fallo) {
    if (fallo instanceof ErrorTurnos) throw fallo
    // Cancelar HTTP o perder la respuesta no garantiza que el servidor haya revertido.
    throw new ErrorTurnos('No se recibió la confirmación del turno. Revisa la información antes de reintentar.', true)
  }
}

export async function cerrarTurno(
  contexto: ContextoCuentaTurno, id: string, notas: string, signal: AbortSignal,
): Promise<TurnoOperativo> {
  comprobarContexto(contexto)
  comprobarCancelacion(signal)
  if (!esUuid(id)) throw new ErrorTurnos('Indica un turno válido para cerrar.')
  const notasCierre = notas.trim() || null
  try {
    const { data, error } = await supabase.rpc('cerrar_turno', {
      p_id: id, p_notas: notasCierre,
    }).abortSignal(signal).single()
    if (error) lanzarFallo(error, 'No se pudo cerrar el turno. Revisa la información antes de reintentar.', true)
    const turno = leerTurno(data, true)
    if (turno.id.toLowerCase() !== id.toLowerCase() || turno.area !== contexto.area
      || turno.iniciado_por.toLowerCase() !== contexto.cuentaId.toLowerCase()
      || turno.finalizado_en === null || turno.notas_cierre !== notasCierre) {
      throw new ErrorTurnos('No se pudo comprobar el cierre guardado. Revisa la información antes de continuar.', true)
    }
    return turno
  } catch (fallo) {
    if (fallo instanceof ErrorTurnos) throw fallo
    throw new ErrorTurnos('No se recibió la confirmación del cierre. Revisa la información antes de reintentar.', true)
  }
}
