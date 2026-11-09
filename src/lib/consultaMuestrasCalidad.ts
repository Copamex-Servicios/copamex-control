import { supabase } from './supabase'
import { leerRegistroCalidad, seleccionRegistroCalidad } from './calidad'
import { leerTurnoPlanta } from './planta'
import type { TurnoPlanta } from './planta'
import type { RegistroCalidad } from './tiposCalidad'
import type { AreaOperativa, TipoTurno } from './tiposTurno'
import { relacionOperadorAcompanante, relacionOperadorPrincipal } from './tiposTurno'
import { esFechaOperativa } from './turnos'

export interface FiltrosMuestrasCalidad {
  desde: string; hasta: string; area: AreaOperativa | 'todas'; turno: TipoTurno | 'todos'
}
export const gruposPorPaginaCalidad = 10
export const muestrasPorPaginaCalidad = 20
const columnasTurno = `id,fecha_operativa,area,turno,operador_id,operador_acompanante_id,iniciado_por,iniciado_en,finalizado_en,notas_cierre,${relacionOperadorPrincipal},${relacionOperadorAcompanante}`

export function validarFiltrosMuestras(f: FiltrosMuestrasCalidad): void {
  if ((f.desde && !esFechaOperativa(f.desde)) || (f.hasta && !esFechaOperativa(f.hasta))
    || (f.desde && f.hasta && f.desde > f.hasta) || !['todas', 'calderas', 'ptar'].includes(f.area)
    || !['todos', 'dia', 'tarde', 'noche'].includes(f.turno)) throw new Error('Revisa el período, área y turno de Calidad.')
}
function comprobarPagina(pagina: number): void {
  if (!Number.isSafeInteger(pagina) || pagina < 0) throw new Error('Página de Calidad inválida.')
}
function comprobarLote(data: unknown, count: number | null, offset: number, limite: number): asserts data is unknown[] {
  if (!Array.isArray(data) || count === null || !Number.isSafeInteger(count) || count < 0
    || data.length !== Math.max(0, Math.min(limite, count - offset))) {
    throw new Error('La consulta de Calidad está incompleta o cambió. Actualiza antes de continuar.')
  }
}
export async function consultarGruposMuestras(f: FiltrosMuestrasCalidad, pagina: number, signal: AbortSignal) {
  validarFiltrosMuestras(f); comprobarPagina(pagina); signal.throwIfAborted()
  const offset = pagina * gruposPorPaginaCalidad
  // Una fila por turno. El embed solo comprueba que existe una muestra vigente.
  let q = supabase.from('turnos_operativos')
    .select(`${columnasTurno},muestras:muestras_calidad!inner(id)`, { count: 'exact' })
    .is('muestras.eliminado_en', null).limit(1, { referencedTable: 'muestras' })
  if (f.desde) q = q.gte('fecha_operativa', f.desde)
  if (f.hasta) q = q.lte('fecha_operativa', f.hasta)
  if (f.area !== 'todas') q = q.eq('area', f.area)
  if (f.turno !== 'todos') q = q.eq('turno', f.turno)
  const r = await q.order('fecha_operativa', { ascending: false }).order('iniciado_en', { ascending: false })
    .order('id', { ascending: false }).range(offset, offset + gruposPorPaginaCalidad - 1).abortSignal(signal)
  signal.throwIfAborted()
  if (r.error) throw new Error('No se pudieron consultar los turnos con muestras de Calidad.')
  comprobarLote(r.data, r.count, offset, gruposPorPaginaCalidad)
  const grupos = r.data.map(v => {
    const grupo = leerTurnoPlanta(v), t = grupo.turno
    if ((f.desde && t.fecha_operativa < f.desde) || (f.hasta && t.fecha_operativa > f.hasta)
      || (f.area !== 'todas' && t.area !== f.area) || (f.turno !== 'todos' && t.turno !== f.turno)) throw new Error('El turno no corresponde a los filtros de Calidad.')
    return grupo
  })
  if (new Set(grupos.map(g => g.turno.id)).size !== grupos.length) throw new Error('Se recibieron turnos repetidos. Actualiza Calidad.')
  return { grupos, total: r.count!, hayMas: offset + grupos.length < r.count! }
}
export function ordenarMuestrasCalidad(muestras: readonly RegistroCalidad[]): RegistroCalidad[] {
  if (new Set(muestras.map(m => m.lectura.id)).size !== muestras.length) throw new Error('La consulta contiene muestras repetidas. Actualiza el turno.')
  return [...muestras].sort((a, b) => Date.parse(a.lectura.capturado_en) - Date.parse(b.lectura.capturado_en)
    || a.lectura.id.localeCompare(b.lectura.id))
}
export async function consultarPaginaMuestras(grupo: TurnoPlanta, pagina: number, signal: AbortSignal) {
  comprobarPagina(pagina); signal.throwIfAborted()
  const offset = pagina * muestrasPorPaginaCalidad
  const r = await supabase.from('muestras_calidad').select(seleccionRegistroCalidad, { count: 'exact' })
    .eq('turno_id', grupo.turno.id).is('eliminado_en', null)
    .order('capturado_en', { ascending: true }).order('id', { ascending: true })
    .range(offset, offset + muestrasPorPaginaCalidad - 1).abortSignal(signal)
  signal.throwIfAborted()
  if (r.error) throw new Error('No se pudieron consultar las muestras del turno. Reintenta.')
  comprobarLote(r.data, r.count, offset, muestrasPorPaginaCalidad)
  const muestras = ordenarMuestrasCalidad(r.data.map(v => leerRegistroCalidad(v)))
  if (muestras.some(m => m.turno.id !== grupo.turno.id || m.turno.area !== grupo.turno.area
    || m.turno.fecha_operativa !== grupo.turno.fecha_operativa || m.turno.turno !== grupo.turno.turno)) {
    throw new Error('Una muestra no corresponde al turno consultado.')
  }
  return { muestras, total: r.count!, hayMas: offset + muestras.length < r.count! }
}
