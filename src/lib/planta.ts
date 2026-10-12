import { supabase } from './supabase'
import { esFechaOperativa, esTipoTurno } from './turnos'
import { leerRegistroBitacora } from './bitacora'
import { leerRegistroPozosPlanta } from './pozos'
import { leerRegistroUFPlanta } from './uf'
import { leerRegistroCalidad } from './calidad'
import { leerRegistroPTAR } from './ptar'
import type { RegistroBitacora } from './tiposBitacora'
import type { RegistroPozos } from './pozos'
import type { RegistroUF } from './uf'
import type { RegistroCalidad } from './tiposCalidad'
import type { RegistroPTAR } from './tiposPTAR'
import type { AreaOperativa, TipoTurno, TurnoOperativo } from './tiposTurno'

export type ModuloPlanta = 'bitacora' | 'pozos' | 'uf' | 'calidad' | 'ptar'
export interface FiltrosPlanta { desde: string; hasta: string; area: AreaOperativa | 'todas'; turno: TipoTurno | 'todos' }
export interface TurnoPlanta { turno: TurnoOperativo; operadorNombre: string }
export type CapturaPlanta =
  | { modulo: 'bitacora'; registro: RegistroBitacora }
  | { modulo: 'pozos'; registro: RegistroPozos }
  | { modulo: 'uf'; registro: RegistroUF }
  | { modulo: 'calidad'; registro: RegistroCalidad }
  | { modulo: 'ptar'; registro: RegistroPTAR }
export interface FuentePlanta<T> { elementos: T[]; error: boolean; incompleta: boolean }
export interface DatosPlanta { turnos: FuentePlanta<TurnoPlanta>; fuentes: Record<ModuloPlanta, FuentePlanta<CapturaPlanta>> }
export const nombresModulo: Record<ModuloPlanta, string> = { bitacora: 'Bitácora', pozos: 'Pozos', uf: 'Ultrafiltración', calidad: 'Calidad', ptar: 'PTAR' }
export const nombresTurno: Record<TipoTurno, string> = { dia: 'Día', tarde: 'Tarde', noche: 'Noche' }
export const modulosPlanta = Object.keys(nombresModulo) as ModuloPlanta[]
const columnasTurno = 'id,fecha_operativa,area,turno,operador_id,iniciado_por,iniciado_en,finalizado_en,notas_cierre'
const relacionTurno = `turno:turnos_operativos!inner(${columnasTurno},operador:operadores!inner(id,nombre))`
const metadata = 'id,turno_id,capturado_en,recibido_en,creado_por,eliminado_en,eliminado_por'
const configuracion = {
  bitacora: { tabla: 'bitacora', columnas: `${metadata},texto`, leer: (v: unknown): CapturaPlanta => ({ modulo: 'bitacora', registro: leerRegistroBitacora(v) }) },
  pozos: { tabla: 'lecturas_pozos', columnas: `${metadata},pozo1_ini,pozo1_fin,consumo_pozo1,pozo2_ini,pozo2_fin,consumo_pozo2,notas`, leer: (v: unknown): CapturaPlanta => ({ modulo: 'pozos', registro: leerRegistroPozosPlanta(v) }) },
  uf: { tabla: 'lecturas_uf', columnas: `${metadata},alim_ini,alim_fin,alimentado,acep_ini,acep_fin,aceptado,rechazo,rendimiento,notas`, leer: (v: unknown): CapturaPlanta => ({ modulo: 'uf', registro: leerRegistroUFPlanta(v) }) },
  calidad: { tabla: 'muestras_calidad', columnas: `${metadata},hora_muestra,notas,resultados:resultados_calidad(id,muestra_id,punto_id,parametro_id,valor,limite_min_aplicado,limite_max_aplicado,fuera_norma,punto:puntos_muestreo(id,nombre,area),parametro:parametros_calidad(id,nombre,unidad))`, leer: (v: unknown): CapturaPlanta => ({ modulo: 'calidad', registro: leerRegistroCalidad(v) }) },
  ptar: { tabla: 'lecturas_ptar', columnas: `${metadata},dqo_sand_float,dqo_t03_04,dqo_colector,dqo_pila,sst_sand_float,sst_t03_04,sst_colector,sst_pila,notas`, leer: (v: unknown): CapturaPlanta => ({ modulo: 'ptar', registro: leerRegistroPTAR(v) }) },
} as const

export function filtrosInicialesPlanta(ahora = new Date()): FiltrosPlanta {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(ahora)
  const valor = (tipo: string) => partes.find(p => p.type === tipo)?.value
  const hasta = `${valor('year')}-${valor('month')}-${valor('day')}`
  const anterior = new Date(`${hasta}T12:00:00Z`); anterior.setUTCDate(anterior.getUTCDate() - 6)
  return { desde: anterior.toISOString().slice(0, 10), hasta, area: 'todas', turno: 'todos' }
}
export function validarFiltrosPlanta(f: FiltrosPlanta): void {
  if (!esFechaOperativa(f.desde) || !esFechaOperativa(f.hasta) || f.hasta < f.desde) throw new Error('Revisa las fechas del período.')
  if ((Date.parse(f.hasta) - Date.parse(f.desde)) / 86400000 > 30) throw new Error('Consulta hasta 31 días por período.')
  if (!['todas', 'calderas', 'ptar'].includes(f.area) || (f.turno !== 'todos' && !esTipoTurno(f.turno))) throw new Error('Revisa el área y el turno.')
}
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(v)
const instante = (v: unknown): v is string => typeof v === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(v) && Number.isFinite(Date.parse(v))
function objeto(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Respuesta inválida.')
  return v as Record<string, unknown>
}
export function leerTurnoPlanta(v: unknown): TurnoPlanta {
  const t = objeto(v), o = objeto(t.operador)
  if (!uuid(t.id) || !esFechaOperativa(t.fecha_operativa) || (t.area !== 'calderas' && t.area !== 'ptar') || !esTipoTurno(t.turno)
    || !uuid(t.operador_id) || !uuid(t.iniciado_por) || !instante(t.iniciado_en)
    || (t.finalizado_en !== null && (!instante(t.finalizado_en) || Date.parse(t.finalizado_en) < Date.parse(t.iniciado_en)))
    || (t.notas_cierre !== null && typeof t.notas_cierre !== 'string') || o.id !== t.operador_id || typeof o.nombre !== 'string' || !o.nombre.trim()) throw new Error('Turno inválido.')
  return { turno: { id: t.id, fecha_operativa: t.fecha_operativa, area: t.area, turno: t.turno, operador_id: t.operador_id, iniciado_por: t.iniciado_por,
    iniciado_en: t.iniciado_en, finalizado_en: t.finalizado_en, notas_cierre: t.notas_cierre }, operadorNombre: o.nombre }
}
function corresponde(t: TurnoOperativo, f: FiltrosPlanta): boolean {
  return t.fecha_operativa >= f.desde && t.fecha_operativa <= f.hasta && (f.area === 'todas' || t.area === f.area) && (f.turno === 'todos' || t.turno === f.turno)
}
async function consultarTurnos(f: FiltrosPlanta, signal: AbortSignal): Promise<FuentePlanta<TurnoPlanta>> {
  let q = supabase.from('turnos_operativos').select(`${columnasTurno},operador:operadores!inner(id,nombre)`)
    .gte('fecha_operativa', f.desde).lte('fecha_operativa', f.hasta)
  if (f.area !== 'todas') q = q.eq('area', f.area)
  if (f.turno !== 'todos') q = q.eq('turno', f.turno)
  const r = await q.order('iniciado_en', { ascending: false }).order('id', { ascending: false }).range(0, 249).abortSignal(signal)
  if (r.error || !Array.isArray(r.data)) throw new Error('No se pudieron consultar los turnos.')
  const elementos = r.data.map(leerTurnoPlanta)
  if (elementos.some(e => !corresponde(e.turno, f)) || new Set(elementos.map(e => e.turno.id)).size !== elementos.length) throw new Error('Actualiza los turnos.')
  return { elementos, error: false, incompleta: elementos.length === 250 }
}
async function consultarCapturas(modulo: ModuloPlanta, f: FiltrosPlanta, signal: AbortSignal): Promise<FuentePlanta<CapturaPlanta>> {
  const c = configuracion[modulo], elementos: CapturaPlanta[] = [], ids = new Set<string>()
  // Páginas pequeñas para evitar el límite de filas del API. El límite visible evita consultas sin fin.
  for (let inicio = 0; inicio < 1000; inicio += 200) {
    signal.throwIfAborted()
    let q = supabase.from(c.tabla).select(`${c.columnas},${relacionTurno}`).is('eliminado_en', null)
      .gte('turno.fecha_operativa', f.desde).lte('turno.fecha_operativa', f.hasta)
    if (f.area !== 'todas') q = q.eq('turno.area', f.area)
    if (f.turno !== 'todos') q = q.eq('turno.turno', f.turno)
    const r = await q.order('capturado_en', { ascending: false }).order('id', { ascending: false }).range(inicio, inicio + 199).abortSignal(signal)
    if (r.error || !Array.isArray(r.data)) throw new Error('Consulta no disponible.')
    for (const v of r.data) {
      const e = c.leer(v)
      if (!corresponde(e.registro.turno, f) || ids.has(e.registro.lectura.id)) throw new Error('El historial cambió durante la consulta. Actualiza.')
      ids.add(e.registro.lectura.id); elementos.push(e)
    }
    if (r.data.length < 200) return { elementos, error: false, incompleta: false }
  }
  return { elementos, error: false, incompleta: true }
}
export async function consultarPlanta(f: FiltrosPlanta, signal: AbortSignal): Promise<DatosPlanta> {
  validarFiltrosPlanta(f); signal.throwIfAborted()
  const resultados = await Promise.allSettled([consultarTurnos(f, signal), ...modulosPlanta.map(m => consultarCapturas(m, f, signal))])
  signal.throwIfAborted()
  const turnos = resultados[0]
  const fuentes = {} as DatosPlanta['fuentes']
  modulosPlanta.forEach((m, i) => {
    const r = resultados[i + 1]
    fuentes[m] = r.status === 'fulfilled' ? r.value as FuentePlanta<CapturaPlanta> : { elementos: [], error: true, incompleta: false }
  })
  return { turnos: turnos.status === 'fulfilled' ? turnos.value as FuentePlanta<TurnoPlanta> : { elementos: [], error: true, incompleta: false }, fuentes }
}
export function capturasPlanta(d: DatosPlanta): CapturaPlanta[] {
  return modulosPlanta.flatMap(m => d.fuentes[m].elementos).sort((a, b) => Date.parse(b.registro.lectura.capturado_en) - Date.parse(a.registro.lectura.capturado_en) || a.modulo.localeCompare(b.modulo) || a.registro.lectura.id.localeCompare(b.registro.lectura.id))
}
export function resumenCaptura(e: CapturaPlanta): string {
  switch (e.modulo) {
    case 'bitacora': return e.registro.lectura.texto
    case 'pozos': return `Pozo 1: ${e.registro.lectura.consumo_pozo1} m³ · Pozo 2: ${e.registro.lectura.consumo_pozo2} m³ ${e.registro.lectura.notas ?? ''}`
    case 'uf': return `Alimentado: ${e.registro.lectura.alimentado} m³ · Aceptado: ${e.registro.lectura.aceptado} m³ · Rendimiento: ${e.registro.lectura.rendimiento === null ? 'Sin alimentación' : `${e.registro.lectura.rendimiento}%`} ${e.registro.lectura.notas ?? ''}`
    case 'calidad': return e.registro.lectura.resultados.map(r => `${r.punto.nombre} · ${r.parametro.nombre}: ${r.valor}${r.parametro.unidad ? ` ${r.parametro.unidad}` : ''}${r.fuera_norma === true ? ' · Fuera de límite' : r.fuera_norma === null ? ' · Sin límites' : ''}`).join(' / ') + ` ${e.registro.lectura.notas ?? ''}`
    case 'ptar': return `DQO y SST: consulta las mediciones ${e.registro.lectura.notas ?? ''}`
  }
}
export function filtrarCapturas(capturas: CapturaPlanta[], modulo: ModuloPlanta | 'todos', busqueda: string): CapturaPlanta[] {
  const texto = busqueda.trim().toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return capturas.filter(e => (modulo === 'todos' || e.modulo === modulo) && `${e.registro.operadorNombre} ${e.registro.turno.area} ${nombresTurno[e.registro.turno.turno]} ${e.registro.turno.fecha_operativa} ${nombresModulo[e.modulo]} ${resumenCaptura(e)}`.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(texto))
}
// Suma las representaciones decimales sin agregar ruido de punto flotante al volumen mostrado.
export function sumarVolumenPlanta(numeros: number[]): string {
  const decimales = numeros.map(n => {
    const [mantisa, exponente = '0'] = String(n).toLowerCase().split('e'), [entera, fraccion = ''] = mantisa.split('.')
    const escala = fraccion.length - Number(exponente)
    return { numero: BigInt(entera + fraccion), escala }
  })
  const escala = Math.max(0, ...decimales.map(d => d.escala))
  const suma = decimales.reduce((s, d) => s + d.numero * 10n ** BigInt(escala - d.escala), 0n)
  const texto = suma.toString().padStart(escala + 1, '0')
  return escala ? `${texto.slice(0, -escala)}.${texto.slice(-escala)}`.replace(/0+$/, '').replace(/\.$/, '') : texto
}
