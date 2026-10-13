import { supabase } from './supabase'

export const CONCESION_ANUAL_POZOS = 277_000
export interface ConsumoConcesion { id: string; consumo_pozo1: number; consumo_pozo2: number }
export interface ResumenConcesion { acumulado: number; restante: number; excedente: number; porcentaje: number; lecturas: number }

export function resumirConcesion(consumos: ConsumoConcesion[]): ResumenConcesion {
  const ids = new Set<string>()
  let acumulado = 0, compensacion = 0
  for (const lectura of consumos) {
    if (!lectura.id || ids.has(lectura.id)) throw new Error('La consulta contiene lecturas repetidas.')
    ids.add(lectura.id)
    for (const valor of [lectura.consumo_pozo1, lectura.consumo_pozo2]) {
      if (!Number.isFinite(valor) || valor < 0) throw new Error('No se pudo comprobar el consumo de Pozos.')
      const siguiente = valor - compensacion
      const suma = acumulado + siguiente
      compensacion = (suma - acumulado) - siguiente
      acumulado = suma
    }
  }
  if (!Number.isFinite(acumulado)) throw new Error('No se pudo comprobar el acumulado de Pozos.')
  return { acumulado, restante: Math.max(0, CONCESION_ANUAL_POZOS - acumulado),
    excedente: Math.max(0, acumulado - CONCESION_ANUAL_POZOS),
    porcentaje: acumulado / CONCESION_ANUAL_POZOS * 100, lecturas: consumos.length }
}

// Consulta independiente del historial de 20 registros. Solo lee datos permitidos por RLS.
export async function consultarConcesionPozos(anio: number, signal: AbortSignal): Promise<ResumenConcesion> {
  if (!Number.isInteger(anio) || anio < 2000 || anio > 9998) throw new Error('El año de consulta no es válido.')
  const consumos: ConsumoConcesion[] = []
  let total: number | null = null
  while (true) {
    signal.throwIfAborted()
    const { data, error, count } = await supabase.from('lecturas_pozos')
      .select('id,consumo_pozo1,consumo_pozo2,turno:turnos_operativos!inner(fecha_operativa,area)', { count: 'exact' })
      .eq('turno.area', 'calderas').is('eliminado_en', null)
      .gte('turno.fecha_operativa', `${anio}-01-01`).lt('turno.fecha_operativa', `${anio + 1}-01-01`)
      .order('id').range(consumos.length, consumos.length + 199).abortSignal(signal)
    signal.throwIfAborted()
    if (error || !Array.isArray(data) || count === null || !Number.isInteger(count) || count < 0) {
      throw new Error('No se pudo consultar el consumo anual. Usa Actualizar Pozos para reintentar.')
    }
    if (total !== null && total !== count) throw new Error('Las lecturas cambiaron durante la consulta. Actualiza Pozos.')
    total = count
    for (const fila of data) {
      if (typeof fila.id !== 'string' || typeof fila.consumo_pozo1 !== 'number' || typeof fila.consumo_pozo2 !== 'number') {
        throw new Error('No se pudo comprobar el consumo anual.')
      }
      consumos.push({ id: fila.id, consumo_pozo1: fila.consumo_pozo1, consumo_pozo2: fila.consumo_pozo2 })
    }
    if (consumos.length === total) return resumirConcesion(consumos)
    if (!data.length || consumos.length > total) throw new Error('La consulta anual está incompleta. Actualiza Pozos.')
  }
}
