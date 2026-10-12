import { supabase } from './supabase'
import { esFechaOperativa, esTipoTurno } from './turnos'
import type { CamposUF, LecturaUF, ValoresUF } from './tiposUF'
import type { TurnoOperativo } from './tiposTurno'

export interface RegistroUF {
  lectura: LecturaUF
  turno: TurnoOperativo
  operadorNombre: string
}

// Conservar esta solicitud completa si no llega la confirmación.
// Un reintento usa el mismo UUID, valores y original; nunca un UUID nuevo.
export interface SolicitudGuardadoUF {
  id: string
  turnoId: string
  valores: ValoresUF
  original: LecturaUF | null
}

export class ErrorUF extends Error {
  readonly resultadoIncierto: boolean

  constructor(mensaje: string, resultadoIncierto = false) {
    super(mensaje)
    this.name = 'ErrorUF'
    this.resultadoIncierto = resultadoIncierto
  }
}

const columnasLectura = 'id,turno_id,alim_ini,alim_fin,alimentado,acep_ini,acep_fin,aceptado,rechazo,rendimiento,notas,capturado_en,recibido_en,creado_por,eliminado_en,eliminado_por'
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
  if (!limpio) throw new ErrorUF(`Completa ${etiqueta}.`)
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(limpio)) {
    throw new ErrorUF(`Escribe un número en ${etiqueta}, sin separadores de miles.`)
  }
  const numero = Number(limpio.replace(',', '.'))
  if (!esNumero(numero) || decimalCanonico(limpio) !== decimalCanonico(String(numero))) {
    throw new ErrorUF(`La lectura de ${etiqueta} tiene más cifras de las que se pueden conservar. Revisa el valor.`)
  }
  return numero === 0 ? 0 : numero
}

function comprobarValores(valores: ValoresUF): void {
  if (![valores.alim_ini, valores.alim_fin, valores.acep_ini, valores.acep_fin].every(esNumero)
    || (valores.notas !== null && typeof valores.notas !== 'string')) {
    throw new ErrorUF('Completa las cuatro lecturas con números válidos.')
  }
  if (valores.alim_fin < valores.alim_ini || valores.acep_fin < valores.acep_ini) {
    throw new ErrorUF('La lectura final de cada medidor debe ser mayor o igual que la inicial.')
  }
  if (valores.alim_fin - valores.alim_ini > Number.MAX_SAFE_INTEGER
    || valores.acep_fin - valores.acep_ini > Number.MAX_SAFE_INTEGER) {
    throw new ErrorUF('El consumo supera las cifras que se pueden conservar. Revisa las lecturas.')
  }
}

export function validarCamposUF(campos: CamposUF): ValoresUF {
  const valores = {
    alim_ini: leerCampo(campos.alimentacionInicial, 'la lectura inicial del Alimentación'),
    alim_fin: leerCampo(campos.alimentacionFinal, 'la lectura final del Alimentación'),
    acep_ini: leerCampo(campos.aceptacionInicial, 'la lectura inicial del Aceptación'),
    acep_fin: leerCampo(campos.aceptacionFinal, 'la lectura final del Aceptación'),
    notas: campos.notas.trim() || null,
  }
  comprobarValores(valores)
  return valores
}

function restarDecimal(final: number | string, inicial: number | string): string {
  const textos = [final, inicial].map((numero) => decimalCanonico(String(numero)))
  const escala = Math.max(...textos.map((texto) => texto.split('.')[1]?.length ?? 0))
  const enteros = textos.map((texto) => {
    const [entera, fraccion = ''] = texto.split('.')
    return BigInt(entera + fraccion.padEnd(escala, '0'))
  })
  const resultado = enteros[0] - enteros[1]
  const signo = resultado < 0n ? '-' : ''
  const digitos = (resultado < 0n ? -resultado : resultado).toString().padStart(escala + 1, '0')
  return escala === 0 ? signo + digitos
    : decimalCanonico(`${signo}${digitos.slice(0, -escala)}.${digitos.slice(-escala)}`)
}

// Solo vista previa. El resultado guardado procede de las columnas generadas.
export function calcularConsumosUF(valores: ValoresUF): { alimentado: string; aceptado: string } {
  comprobarValores(valores)
  return {
    alimentado: restarDecimal(valores.alim_fin, valores.alim_ini),
    aceptado: restarDecimal(valores.acep_fin, valores.acep_ini),
  }
}

export function calcularResultadosUF(valores: ValoresUF): {
  alimentado: string; aceptado: string; rechazo: string; rendimiento: number | null
} {
  const consumos = calcularConsumosUF(valores)
  const alimentado = Number(consumos.alimentado)
  const aceptado = Number(consumos.aceptado)
  const rendimiento = alimentado === 0 ? null : aceptado / alimentado * 100
  if (rendimiento !== null && !Number.isFinite(rendimiento)) {
    throw new ErrorUF('Revisa las lecturas: el rendimiento supera el rango que se puede mostrar.')
  }
  return { ...consumos, rechazo: restarDecimal(consumos.alimentado, consumos.aceptado), rendimiento }
}

export function extraerValoresUF(lectura: ValoresUF): ValoresUF {
  return {
    alim_ini: lectura.alim_ini, alim_fin: lectura.alim_fin,
    acep_ini: lectura.acep_ini, acep_fin: lectura.acep_fin,
    notas: lectura.notas,
  }
}

function fila(valor: unknown, incierto = false): Record<string, unknown> {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new ErrorUF('No se pudo comprobar la información de UF. Actualiza la consulta.', incierto)
  }
  return valor as Record<string, unknown>
}

function consumoCoherente(inicial: number, final: number, consumo: number): boolean {
  const esperado = Number(restarDecimal(final, inicial))
  // Margen de representación JSON/number; no modifica el consumo recibido.
  return Math.abs(consumo - esperado)
    <= 8 * Number.EPSILON * Math.max(1, Math.abs(esperado), Math.abs(consumo))
}

function leerLectura(valor: unknown, incierto = false): LecturaUF {
  const datos = fila(valor, incierto)
  const { id, turno_id, alim_ini, alim_fin, alimentado, acep_ini,
    acep_fin, aceptado, rechazo, rendimiento, notas, capturado_en, recibido_en,
    creado_por, eliminado_en, eliminado_por } = datos
  if (!esUuid(id) || !esUuid(turno_id) || !esUuid(creado_por)
    || !esNumero(alim_ini) || !esNumero(alim_fin) || !esNumero(alimentado)
    || !esNumero(acep_ini) || !esNumero(acep_fin) || !esNumero(aceptado)
    || !esNumero(rechazo)
    || (rendimiento !== null && (typeof rendimiento !== 'number' || !Number.isFinite(rendimiento)))
    || alim_fin < alim_ini || acep_fin < acep_ini || alimentado < 0 || aceptado < 0
    || (notas !== null && typeof notas !== 'string')
    || !esInstante(capturado_en) || !esInstante(recibido_en)
    || Date.parse(recibido_en) < Date.parse(capturado_en)
    || eliminado_en !== null || eliminado_por !== null) {
    throw new ErrorUF('No se pudo comprobar la lectura guardada. Actualiza la consulta.', incierto)
  }
  if (!consumoCoherente(alim_ini, alim_fin, alimentado)
    || !consumoCoherente(acep_ini, acep_fin, aceptado)) {
    throw new ErrorUF('No se pudieron comprobar los consumos guardados. Actualiza la consulta.', incierto)
  }
  const esperado = calcularResultadosUF({ alim_ini, alim_fin, acep_ini, acep_fin, notas })
  const coinciden = (a: number, b: number) => Math.abs(a - b)
    <= 16 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b))
  if (!coinciden(rechazo, Number(esperado.rechazo))
    || (esperado.rendimiento === null ? rendimiento !== null
      : rendimiento === null || !coinciden(rendimiento, esperado.rendimiento))) {
    throw new ErrorUF('No se pudieron comprobar los resultados guardados de UF. Actualiza la consulta.', incierto)
  }
  return { id, turno_id, alim_ini, alim_fin, alimentado, acep_ini,
    acep_fin, aceptado, rechazo, rendimiento, notas, capturado_en, recibido_en,
    creado_por, eliminado_en, eliminado_por }
}

function leerRegistro(valor: unknown): RegistroUF {
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
    throw new ErrorUF('No se pudo comprobar el turno y operador de la lectura. Actualiza la consulta.')
  }
  return {
    lectura,
    turno: { id, fecha_operativa, area, turno, operador_id, iniciado_por,
      iniciado_en, finalizado_en, notas_cierre },
    operadorNombre: o.nombre,
  }
}

function comprobarCancelacion(signal: AbortSignal): void {
  if (signal.aborted) throw new ErrorUF('La operación fue cancelada antes de enviarse.')
}

function lanzarFallo(fallo: unknown, mensaje: string, mutacion = false): never {
  const datos = fallo && typeof fallo === 'object' ? fallo as Record<string, unknown> : null
  const codigo = typeof datos?.code === 'string' ? datos.code : ''
  const texto = typeof datos?.message === 'string' ? datos.message : ''
  const rechazoConfirmado = /^[\dA-Z]{5}$/.test(codigo)
    || ['PGRST202', 'PGRST203', 'PGRST301', 'PGRST302'].includes(codigo)
  const propio = ['22023', '42501', '23505', '40001'].includes(codigo)
    && /^(Solo una cuenta|Completa las cuatro|La lectura final|Actualiza la lectura|La lectura debe|Ese turno ya|Esta lectura no|La captura ya|La lectura cambió|Terminó la hora|No se pudo corregir|No se encontró la lectura|El turno ya|Ese identificador|No se puede guardar)/.test(texto)
  throw new ErrorUF(propio ? texto : mensaje, mutacion && !rechazoConfirmado)
}

export async function consultarLecturaUF(
  turnoId: string, signal: AbortSignal,
): Promise<RegistroUF | null> {
  if (!esUuid(turnoId)) throw new ErrorUF('Selecciona un turno válido para consultar UF.')
  comprobarCancelacion(signal)
  try {
    const { data, error } = await supabase.from('lecturas_uf').select(seleccion)
      .eq('turno_id', turnoId).eq('turno.area', 'calderas')
      .is('eliminado_en', null).abortSignal(signal).maybeSingle()
    if (error) lanzarFallo(error, 'No se pudo consultar la lectura de UF. Reintenta.')
    if (data === null) return null
    const registro = leerRegistro(data)
    if (registro.lectura.turno_id !== turnoId) throw new ErrorUF('La lectura recibida pertenece a otro turno. Actualiza la consulta.')
    return registro
  } catch (fallo) {
    if (fallo instanceof ErrorUF) throw fallo
    throw new ErrorUF('No se pudo consultar UF. Revisa la conexión e intenta de nuevo.')
  }
}

// También incluye turnos cerrados: cerrar no elimina la captura ni renueva el plazo.
export async function consultarHistorialUF(signal: AbortSignal): Promise<RegistroUF[]> {
  comprobarCancelacion(signal)
  try {
    const { data, error } = await supabase.from('lecturas_uf').select(seleccion)
      .eq('turno.area', 'calderas').is('eliminado_en', null)
      .order('capturado_en', { ascending: false }).order('id', { ascending: false })
      .limit(20).abortSignal(signal)
    if (error) lanzarFallo(error, 'No se pudo consultar el historial de UF. Reintenta.')
    if (!Array.isArray(data)) throw new ErrorUF('No se pudo comprobar el historial de UF. Actualiza la consulta.')
    const registros = data.map(leerRegistro)
    if (new Set(registros.map((registro) => registro.lectura.turno_id)).size !== registros.length) {
      throw new ErrorUF('Se recibieron lecturas repetidas. Actualiza la consulta.')
    }
    return registros
  } catch (fallo) {
    if (fallo instanceof ErrorUF) throw fallo
    throw new ErrorUF('No se pudo consultar el historial de UF. Revisa la conexión e intenta de nuevo.')
  }
}

export async function guardarLecturaUF(
  cuentaId: string, solicitud: SolicitudGuardadoUF, signal: AbortSignal,
): Promise<LecturaUF> {
  comprobarCancelacion(signal)
  if (!esUuid(cuentaId) || !esUuid(solicitud.id) || !esUuid(solicitud.turnoId)) {
    throw new ErrorUF('Se necesita una cuenta y un turno válidos para guardar UF.')
  }
  comprobarValores(solicitud.valores)
  const valores = { ...extraerValoresUF(solicitud.valores), notas: solicitud.valores.notas?.trim() || null }
  const original = solicitud.original === null ? null : leerLectura(solicitud.original)
  if (original && (original.id !== solicitud.id || original.turno_id !== solicitud.turnoId
    || original.creado_por !== cuentaId)) {
    throw new ErrorUF('La lectura original no corresponde a esta cuenta y turno. Actualiza la consulta.')
  }
  try {
    const { data, error } = await supabase.rpc('guardar_lectura_uf', {
      p_id: solicitud.id, p_turno_id: solicitud.turnoId,
      p_alim_ini: valores.alim_ini, p_alim_fin: valores.alim_fin,
      p_acep_ini: valores.acep_ini, p_acep_fin: valores.acep_fin,
      p_notas: valores.notas, p_original: original ? extraerValoresUF(original) : null,
    }).abortSignal(signal).single()
    if (error) lanzarFallo(error, 'No se pudo confirmar el guardado de UF. Reintenta la misma solicitud.', true)
    const lectura = leerLectura(data, true)
    if (lectura.id !== solicitud.id || lectura.turno_id !== solicitud.turnoId
      || lectura.creado_por !== cuentaId
      || lectura.alim_ini !== valores.alim_ini || lectura.alim_fin !== valores.alim_fin
      || lectura.acep_ini !== valores.acep_ini || lectura.acep_fin !== valores.acep_fin
      || lectura.notas !== valores.notas
      || (original && (lectura.capturado_en !== original.capturado_en
        || lectura.recibido_en !== original.recibido_en))) {
      throw new ErrorUF('La respuesta no permite confirmar esta captura. Reintenta la misma solicitud.', true)
    }
    return lectura
  } catch (fallo) {
    if (fallo instanceof ErrorUF) throw fallo
    throw new ErrorUF('No llegó la confirmación del guardado. Revisa la conexión y reintenta la misma solicitud.', true)
  }
}

// La consulta de Planta reutiliza la validación de registros existente.
export { leerRegistro as leerRegistroUFPlanta }
