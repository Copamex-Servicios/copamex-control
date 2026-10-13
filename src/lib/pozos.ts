import { supabase } from './supabase'
import { esFechaOperativa, esTipoTurno } from './turnos'
import type { CamposPozos, LecturaPozos, ValoresPozos } from './tiposPozos'
import type { TurnoOperativo } from './tiposTurno'

export interface RegistroPozos {
  lectura: LecturaPozos
  turno: TurnoOperativo
  operadorNombre: string
}

// Conservar esta solicitud completa si no llega la confirmación.
// Un reintento usa el mismo UUID, valores y original; nunca un UUID nuevo.
export interface SolicitudGuardadoPozos {
  id: string
  turnoId: string
  valores: ValoresPozos
  original: LecturaPozos | null
}

export class ErrorPozos extends Error {
  readonly resultadoIncierto: boolean

  constructor(mensaje: string, resultadoIncierto = false) {
    super(mensaje)
    this.name = 'ErrorPozos'
    this.resultadoIncierto = resultadoIncierto
  }
}

const columnasLectura = 'id,turno_id,pozo1_ini,pozo1_fin,consumo_pozo1,pozo2_ini,pozo2_fin,consumo_pozo2,notas,capturado_en,recibido_en,creado_por,eliminado_en,eliminado_por'
const columnasTurno = 'id,fecha_operativa,area,turno,operador_id,iniciado_por,iniciado_en,finalizado_en,notas_cierre'
const seleccion = `${columnasLectura},turno:turnos_operativos!inner(${columnasTurno},operador:operadores!inner(id,nombre))`

function esUuid(valor: unknown): valor is string {
  return typeof valor === 'string'
    && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(valor)
}

function esInstante(valor: unknown): valor is string {
  return typeof valor === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(valor)
    && Number.isFinite(Date.parse(valor))
}

function esNumero(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isFinite(valor)
    && Math.abs(valor) <= Number.MAX_SAFE_INTEGER
}

// Representación decimal sin exponentes, ceros sobrantes ni redondeo.
function decimalCanonico(texto: string): string {
  let valor = texto.replace(',', '.').replace(/^\+/, '')
  const negativo = valor.startsWith('-')
  if (negativo) valor = valor.slice(1)
  const [mantisa, exponente = '0'] = valor.toLowerCase().split('e')
  const [entera, fraccion = ''] = mantisa.split('.')
  const digitos = entera + fraccion
  const posicion = entera.length + Number(exponente)
  let decimal = posicion <= 0 ? `0.${'0'.repeat(-posicion)}${digitos}`
    : posicion >= digitos.length ? digitos + '0'.repeat(posicion - digitos.length)
      : `${digitos.slice(0, posicion)}.${digitos.slice(posicion)}`
  decimal = decimal.replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  if (decimal.startsWith('.')) decimal = `0${decimal}`
  if (!decimal || /^0(?:\.0*)?$/.test(decimal)) return '0'
  return negativo ? `-${decimal}` : decimal
}

function leerCampo(texto: string, etiqueta: string): number {
  const limpio = texto.trim()
  if (!limpio) throw new ErrorPozos(`Completa ${etiqueta}.`)
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(limpio)) {
    throw new ErrorPozos(`Escribe un número en ${etiqueta}, sin separadores de miles.`)
  }
  const numero = Number(limpio.replace(',', '.'))
  if (!esNumero(numero) || decimalCanonico(limpio) !== decimalCanonico(String(numero))) {
    throw new ErrorPozos(`La lectura de ${etiqueta} tiene más cifras de las que se pueden conservar. Revisa el valor.`)
  }
  return numero === 0 ? 0 : numero
}

function comprobarValores(valores: ValoresPozos): void {
  if (![valores.pozo1_ini, valores.pozo1_fin, valores.pozo2_ini, valores.pozo2_fin].every(esNumero)
    || (valores.notas !== null && typeof valores.notas !== 'string')) {
    throw new ErrorPozos('Completa las cuatro lecturas con números válidos.')
  }
  if (valores.pozo1_fin < valores.pozo1_ini || valores.pozo2_fin < valores.pozo2_ini) {
    throw new ErrorPozos('La lectura final de cada pozo debe ser mayor o igual que la inicial.')
  }
  if (valores.pozo1_fin - valores.pozo1_ini > Number.MAX_SAFE_INTEGER
    || valores.pozo2_fin - valores.pozo2_ini > Number.MAX_SAFE_INTEGER) {
    throw new ErrorPozos('El consumo supera las cifras que se pueden conservar. Revisa las lecturas.')
  }
}

export function validarCamposPozos(campos: CamposPozos): ValoresPozos {
  const valores = {
    pozo1_ini: leerCampo(campos.pozo1Inicial, 'la lectura inicial del Pozo 1'),
    pozo1_fin: leerCampo(campos.pozo1Final, 'la lectura final del Pozo 1'),
    pozo2_ini: leerCampo(campos.pozo2Inicial, 'la lectura inicial del Pozo 2'),
    pozo2_fin: leerCampo(campos.pozo2Final, 'la lectura final del Pozo 2'),
    notas: campos.notas.trim() || null,
  }
  comprobarValores(valores)
  return valores
}

function restarDecimal(final: number, inicial: number): string {
  const textos = [final, inicial].map((numero) => decimalCanonico(String(numero)))
  const escala = Math.max(...textos.map((texto) => texto.split('.')[1]?.length ?? 0))
  const enteros = textos.map((texto) => {
    const [entera, fraccion = ''] = texto.split('.')
    return BigInt(entera + fraccion.padEnd(escala, '0'))
  })
  const resultado = enteros[0] - enteros[1]
  const digitos = resultado.toString().padStart(escala + 1, '0')
  return escala === 0 ? digitos
    : decimalCanonico(`${digitos.slice(0, -escala)}.${digitos.slice(-escala)}`)
}

// Solo vista previa. El resultado guardado procede de las columnas generadas.
export function calcularConsumosPozos(valores: ValoresPozos): { pozo1: string; pozo2: string } {
  comprobarValores(valores)
  return {
    pozo1: restarDecimal(valores.pozo1_fin, valores.pozo1_ini),
    pozo2: restarDecimal(valores.pozo2_fin, valores.pozo2_ini),
  }
}

export function extraerValoresPozos(lectura: ValoresPozos): ValoresPozos {
  return {
    pozo1_ini: lectura.pozo1_ini, pozo1_fin: lectura.pozo1_fin,
    pozo2_ini: lectura.pozo2_ini, pozo2_fin: lectura.pozo2_fin,
    notas: lectura.notas,
  }
}

function fila(valor: unknown, incierto = false): Record<string, unknown> {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new ErrorPozos('No se pudo comprobar la información de Pozos. Actualiza la consulta.', incierto)
  }
  return valor as Record<string, unknown>
}

function consumoCoherente(inicial: number, final: number, consumo: number): boolean {
  const esperado = Number(restarDecimal(final, inicial))
  // Margen de representación JSON/number; no modifica el consumo recibido.
  return Math.abs(consumo - esperado)
    <= 8 * Number.EPSILON * Math.max(1, Math.abs(esperado), Math.abs(consumo))
}

function leerLectura(valor: unknown, incierto = false): LecturaPozos {
  const datos = fila(valor, incierto)
  const { id, turno_id, pozo1_ini, pozo1_fin, consumo_pozo1, pozo2_ini,
    pozo2_fin, consumo_pozo2, notas, capturado_en, recibido_en,
    creado_por, eliminado_en, eliminado_por } = datos
  if (!esUuid(id) || !esUuid(turno_id) || !esUuid(creado_por)
    || !esNumero(pozo1_ini) || !esNumero(pozo1_fin) || !esNumero(consumo_pozo1)
    || !esNumero(pozo2_ini) || !esNumero(pozo2_fin) || !esNumero(consumo_pozo2)
    || pozo1_fin < pozo1_ini || pozo2_fin < pozo2_ini || consumo_pozo1 < 0 || consumo_pozo2 < 0
    || (notas !== null && typeof notas !== 'string')
    || !esInstante(capturado_en) || !esInstante(recibido_en)
    || Date.parse(recibido_en) < Date.parse(capturado_en)
    || eliminado_en !== null || eliminado_por !== null) {
    throw new ErrorPozos('No se pudo comprobar la lectura guardada. Actualiza la consulta.', incierto)
  }
  if (!consumoCoherente(pozo1_ini, pozo1_fin, consumo_pozo1)
    || !consumoCoherente(pozo2_ini, pozo2_fin, consumo_pozo2)) {
    throw new ErrorPozos('No se pudieron comprobar los consumos guardados. Actualiza la consulta.', incierto)
  }
  return { id, turno_id, pozo1_ini, pozo1_fin, consumo_pozo1, pozo2_ini,
    pozo2_fin, consumo_pozo2, notas, capturado_en, recibido_en,
    creado_por, eliminado_en, eliminado_por }
}

function leerRegistro(valor: unknown): RegistroPozos {
  const datos = fila(valor)
  const lectura = leerLectura(datos)
  const t = fila(datos.turno)
  const o = fila(t.operador)
  const { id, fecha_operativa, area, turno, operador_id, iniciado_por,
    iniciado_en, finalizado_en, notas_cierre } = t
  if (!esUuid(id) || id !== lectura.turno_id || !esFechaOperativa(fecha_operativa)
    || area !== 'calderas' || !esTipoTurno(turno) || !esUuid(operador_id)
    || !esUuid(iniciado_por) || iniciado_por !== lectura.creado_por
    || !esInstante(iniciado_en) || Date.parse(lectura.capturado_en) < Date.parse(iniciado_en)
    || (finalizado_en !== null && (!esInstante(finalizado_en)
      || Date.parse(finalizado_en) < Date.parse(lectura.capturado_en)))
    || (notas_cierre !== null && typeof notas_cierre !== 'string')
    || o.id !== operador_id || typeof o.nombre !== 'string' || !o.nombre.trim()) {
    throw new ErrorPozos('No se pudo comprobar el turno y operador de la lectura. Actualiza la consulta.')
  }
  return {
    lectura,
    turno: { id, fecha_operativa, area, turno, operador_id, iniciado_por,
      iniciado_en, finalizado_en, notas_cierre },
    operadorNombre: o.nombre,
  }
}

function comprobarCancelacion(signal: AbortSignal): void {
  if (signal.aborted) throw new ErrorPozos('La operación fue cancelada antes de enviarse.')
}

function lanzarFallo(fallo: unknown, mensaje: string, mutacion = false): never {
  const datos = fallo && typeof fallo === 'object' ? fallo as Record<string, unknown> : null
  const codigo = typeof datos?.code === 'string' ? datos.code : ''
  const texto = typeof datos?.message === 'string' ? datos.message : ''
  if (mutacion && codigo === '23505' && /unique constraint "lecturas_pozos_turno_id_key"/.test(texto)) {
    throw new ErrorPozos('Ya existe una lectura de Pozos para este turno. Actualiza Pozos para consultarla. Si no aparece, pide al administrador revisar las capturas anuladas; no se puede crear otra lectura en el mismo turno.', false)
  }
  const rechazoConfirmado = /^[\dA-Z]{5}$/.test(codigo)
    || ['PGRST202', 'PGRST203', 'PGRST301', 'PGRST302'].includes(codigo)
  const propio = ['22023', '42501', '23505', '40001'].includes(codigo)
    && /^(Solo una cuenta|Completa las cuatro|La lectura final|Actualiza la lectura|La lectura debe|Ese turno ya|Esta lectura no|La captura ya|La lectura cambió|Terminó la hora|No se pudo corregir|No se encontró la lectura|El turno ya|Ese identificador|No se puede guardar)/.test(texto)
  throw new ErrorPozos(propio ? texto : mensaje, mutacion && !rechazoConfirmado)
}

export async function consultarLecturaPozos(
  turnoId: string, signal: AbortSignal,
): Promise<RegistroPozos | null> {
  if (!esUuid(turnoId)) throw new ErrorPozos('Selecciona un turno válido para consultar Pozos.')
  comprobarCancelacion(signal)
  try {
    const { data, error } = await supabase.from('lecturas_pozos').select(seleccion)
      .eq('turno_id', turnoId).eq('turno.area', 'calderas')
      .is('eliminado_en', null).abortSignal(signal).maybeSingle()
    if (error) lanzarFallo(error, 'No se pudo consultar la lectura de Pozos. Reintenta.')
    if (data === null) return null
    const registro = leerRegistro(data)
    if (registro.lectura.turno_id !== turnoId) throw new ErrorPozos('La lectura recibida pertenece a otro turno. Actualiza la consulta.')
    return registro
  } catch (fallo) {
    if (fallo instanceof ErrorPozos) throw fallo
    throw new ErrorPozos('No se pudo consultar Pozos. Revisa la conexión e intenta de nuevo.')
  }
}

// También incluye turnos cerrados: cerrar no elimina la captura ni renueva el plazo.
export async function consultarHistorialPozos(signal: AbortSignal): Promise<RegistroPozos[]> {
  comprobarCancelacion(signal)
  try {
    const { data, error } = await supabase.from('lecturas_pozos').select(seleccion)
      .eq('turno.area', 'calderas').is('eliminado_en', null)
      .order('capturado_en', { ascending: false }).order('id', { ascending: false })
      .limit(20).abortSignal(signal)
    if (error) lanzarFallo(error, 'No se pudo consultar el historial de Pozos. Reintenta.')
    if (!Array.isArray(data)) throw new ErrorPozos('No se pudo comprobar el historial de Pozos. Actualiza la consulta.')
    const registros = data.map(leerRegistro)
    if (new Set(registros.map((registro) => registro.lectura.turno_id)).size !== registros.length) {
      throw new ErrorPozos('Se recibieron lecturas repetidas. Actualiza la consulta.')
    }
    return registros
  } catch (fallo) {
    if (fallo instanceof ErrorPozos) throw fallo
    throw new ErrorPozos('No se pudo consultar el historial de Pozos. Revisa la conexión e intenta de nuevo.')
  }
}

export async function guardarLecturaPozos(
  cuentaId: string, solicitud: SolicitudGuardadoPozos, signal: AbortSignal,
): Promise<LecturaPozos> {
  comprobarCancelacion(signal)
  if (!esUuid(cuentaId) || !esUuid(solicitud.id) || !esUuid(solicitud.turnoId)) {
    throw new ErrorPozos('Se necesita una cuenta y un turno válidos para guardar Pozos.')
  }
  comprobarValores(solicitud.valores)
  const valores = { ...extraerValoresPozos(solicitud.valores), notas: solicitud.valores.notas?.trim() || null }
  const original = solicitud.original === null ? null : leerLectura(solicitud.original)
  if (original && (original.id !== solicitud.id || original.turno_id !== solicitud.turnoId
    || original.creado_por !== cuentaId)) {
    throw new ErrorPozos('La lectura original no corresponde a esta cuenta y turno. Actualiza la consulta.')
  }
  try {
    const { data, error } = await supabase.rpc('guardar_lectura_pozos', {
      p_id: solicitud.id, p_turno_id: solicitud.turnoId,
      p_pozo1_ini: valores.pozo1_ini, p_pozo1_fin: valores.pozo1_fin,
      p_pozo2_ini: valores.pozo2_ini, p_pozo2_fin: valores.pozo2_fin,
      p_notas: valores.notas, p_original: original ? extraerValoresPozos(original) : null,
    }).abortSignal(signal).single()
    if (error) lanzarFallo(error, 'No se pudo confirmar el guardado de Pozos. Reintenta la misma solicitud.', true)
    const lectura = leerLectura(data, true)
    if (lectura.id !== solicitud.id || lectura.turno_id !== solicitud.turnoId
      || lectura.creado_por !== cuentaId
      || lectura.pozo1_ini !== valores.pozo1_ini || lectura.pozo1_fin !== valores.pozo1_fin
      || lectura.pozo2_ini !== valores.pozo2_ini || lectura.pozo2_fin !== valores.pozo2_fin
      || lectura.notas !== valores.notas
      || (original && (lectura.capturado_en !== original.capturado_en
        || lectura.recibido_en !== original.recibido_en))) {
      throw new ErrorPozos('La respuesta no permite confirmar esta captura. Reintenta la misma solicitud.', true)
    }
    return lectura
  } catch (fallo) {
    if (fallo instanceof ErrorPozos) throw fallo
    throw new ErrorPozos('No llegó la confirmación del guardado. Revisa la conexión y reintenta la misma solicitud.', true)
  }
}

// La consulta de Planta reutiliza la validación de registros existente.
export { leerRegistro as leerRegistroPozosPlanta }
