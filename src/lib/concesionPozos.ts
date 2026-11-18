import { supabase } from './supabase'

export const CONCESION_ANUAL_POZOS = 277_000

export interface BaseHistoricaPozos {
  anio: number
  fechaCorte: string
  pozo1: number
  pozo2: number
  consumoHistorico: number
}

export interface ResumenConcesion {
  acumulado: number
  restante: number
  excedente: number
  porcentaje: number
  lecturas: number
  consumoHistorico: number
  fechaCorte: string | null
}

function esNumeroNoNegativo(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isFinite(valor) && valor >= 0
}

function fila(valor: unknown): Record<string, unknown> {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new Error('No se pudo comprobar el consumo anual de Pozos.')
  }
  return valor as Record<string, unknown>
}

export async function consultarBaseHistoricaPozos(
  anio: number, signal: AbortSignal,
): Promise<BaseHistoricaPozos | null> {
  if (!Number.isInteger(anio) || anio < 2000 || anio > 9998) throw new Error('El año de consulta no es válido.')
  signal.throwIfAborted()
  const { data, error } = await supabase.rpc('consultar_base_historica_pozos', { p_anio: anio })
    .abortSignal(signal)
  signal.throwIfAborted()
  if (error) throw new Error('No se pudo consultar la base inicial de Pozos. Reintenta la consulta.')
  if (data === null) return null

  const valor = fila(data)
  const fechaCorte = valor.fecha_corte
  if (valor.anio !== anio || typeof fechaCorte !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(fechaCorte)
    || !esNumeroNoNegativo(valor.pozo1_lectura_inicial)
    || !esNumeroNoNegativo(valor.pozo2_lectura_inicial)
    || !esNumeroNoNegativo(valor.consumo_historico_m3)) {
    throw new Error('La base inicial de Pozos recibida no es válida.')
  }
  return {
    anio,
    fechaCorte,
    pozo1: valor.pozo1_lectura_inicial,
    pozo2: valor.pozo2_lectura_inicial,
    consumoHistorico: valor.consumo_historico_m3,
  }
}

export async function consultarConcesionPozos(anio: number, signal: AbortSignal): Promise<ResumenConcesion> {
  if (!Number.isInteger(anio) || anio < 2000 || anio > 9998) throw new Error('El año de consulta no es válido.')
  signal.throwIfAborted()
  const { data, error } = await supabase.rpc('consultar_concesion_pozos', { p_anio: anio })
    .abortSignal(signal)
  signal.throwIfAborted()
  if (error) throw new Error('No se pudo consultar el consumo anual. Usa Actualizar Pozos para reintentar.')

  const valor = fila(data)
  const historico = valor.consumo_historico_m3
  const operativo = valor.consumo_operativo_m3
  const lecturas = valor.lecturas
  const fechaCorte = valor.fecha_corte
  if (valor.anio !== anio || !esNumeroNoNegativo(historico) || !esNumeroNoNegativo(operativo)
    || !Number.isSafeInteger(lecturas) || (lecturas as number) < 0
    || (fechaCorte !== null && (typeof fechaCorte !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fechaCorte)))) {
    throw new Error('La consulta anual de Pozos devolvió datos incompletos.')
  }

  const consumoHistorico = historico
  const acumulado = consumoHistorico + operativo
  if (!Number.isFinite(acumulado)) throw new Error('El acumulado de Pozos excede el rango permitido.')
  return {
    acumulado,
    restante: Math.max(0, CONCESION_ANUAL_POZOS - acumulado),
    excedente: Math.max(0, acumulado - CONCESION_ANUAL_POZOS),
    porcentaje: acumulado / CONCESION_ANUAL_POZOS * 100,
    lecturas: lecturas as number,
    consumoHistorico,
    fechaCorte: fechaCorte as string | null,
  }
}
