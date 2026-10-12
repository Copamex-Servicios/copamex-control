import { supabase } from './supabase'
import type { AreaOperativa } from './tiposTurno'

export interface AvisoDia { id: string; mensaje: string }
export interface ProduccionDia { id: string; maquina: string; papel: string; color: string | null; consumo: string | null }
export interface EventoDia { id: string; fecha: string; tipo: string; area: string; horario: string | null; motivo: string | null }
export interface ResultadoDia<T> { elementos: T[]; error: boolean }
export interface InformacionDia {
  avisos: ResultadoDia<AvisoDia>
  produccion: ResultadoDia<ProduccionDia>
  eventos: ResultadoDia<EventoDia>
}

function fila(valor: unknown): Record<string, unknown> {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new Error('Fila inválida')
  return valor as Record<string, unknown>
}
function texto(valor: unknown): string {
  if (typeof valor !== 'string' || !valor.trim()) throw new Error('Texto inválido')
  return valor
}
function opcional(valor: unknown): string | null {
  if (valor === null) return null
  if (typeof valor !== 'string') throw new Error('Texto inválido')
  return valor.trim() ? valor : null
}
async function leer<T>(
  peticion: PromiseLike<{ data: unknown; error: unknown }>, adaptar: (valor: unknown) => T,
): Promise<ResultadoDia<T>> {
  try {
    const respuesta = await peticion
    if (respuesta.error || !Array.isArray(respuesta.data)) throw new Error('Consulta inválida')
    return { elementos: respuesta.data.map(adaptar), error: false }
  } catch { return { elementos: [], error: true } }
}

export async function consultarInformacionDia(fecha: string, area: AreaOperativa, signal: AbortSignal): Promise<InformacionDia> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || signal.aborted) throw new Error('Consulta cancelada')
  const [avisos, produccion, eventos] = await Promise.all([
    leer(supabase.from('avisos').select('id,mensaje')
      .or('permanente.eq.true,and(or(inicio.is.null,inicio.lte.now),or(fin.is.null,fin.gt.now))')
      .order('creado_en', { ascending: false }).limit(20).abortSignal(signal), valor => {
      const r = fila(valor)
      return { id: texto(r.id), mensaje: texto(r.mensaje) }
    }),
    leer(supabase.from('programa_produccion')
      .select('id,color_objetivo,consumo_objetivo,maquina:maquinas(codigo),papel:catalogo_papeles(nombre)')
      .eq('fecha', fecha).eq('activo', true).order('creado_en').limit(20).abortSignal(signal), valor => {
      const r = fila(valor)
      return { id: texto(r.id), maquina: texto(fila(r.maquina).codigo), papel: texto(fila(r.papel).nombre),
        color: opcional(r.color_objetivo), consumo: opcional(r.consumo_objetivo) }
    }),
    leer(supabase.from('eventos_calendario').select('id,fecha,tipo,area,horario,motivo')
      .gte('fecha', fecha).in('area', [area, area.toUpperCase(), area === 'calderas' ? 'Calderas' : 'PTAR', 'TODOS', 'Todos', 'todos', 'TODAS', 'Todas', 'todas'])
      .order('fecha').order('creado_en').limit(8).abortSignal(signal), valor => {
      const r = fila(valor), fechaEvento = texto(r.fecha)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaEvento)) throw new Error('Fecha inválida')
      return { id: texto(r.id), fecha: fechaEvento, tipo: texto(r.tipo), area: texto(r.area),
        horario: opcional(r.horario), motivo: opcional(r.motivo) }
    }),
  ])
  return { avisos, produccion, eventos }
}
