import { supabase } from './supabase'
import { exigirAdminRevision } from './revisionCapturas'
import { fechaMexicoAdmin, instanteMexicoAdmin } from './administracion'
import { leerAlerta } from './alertas'
import type { Alerta } from './alertas'
import { leerTurnoPlanta, nombresModulo } from './planta'
import type { TurnoPlanta } from './planta'

export interface FuenteDashboard<T> { valor: T | null; error: string | null }
export interface TurnoDashboard extends TurnoPlanta { completados: ModuloDashboard[] }
export interface ActividadDashboard { id: string; fecha: string; tipo: string; descripcion: string }
export interface DatosDashboard {
  fecha: string
  consultado: string
  turnos: FuenteDashboard<{ filas: TurnoDashboard[]; total: number }>
  abiertas: FuenteDashboard<number>
  alertas: FuenteDashboard<Alerta[]>
  capturas: FuenteDashboard<number>
  actividad: ActividadDashboard[]
  actividadParcial: boolean
}
export const modulosArea: Record<'calderas' | 'ptar', readonly ModuloDashboard[]> = {
  calderas: ['reporte_calderas', 'pozos', 'uf', 'calidad'], ptar: ['reporte_ptar', 'ptar', 'calidad'],
}
export const nombresModuloDashboard = { ...nombresModulo, reporte_calderas: 'Reporte técnico', reporte_ptar: 'Reporte técnico' }
const tablas = { reporte_calderas: 'bitacora_calderas', reporte_ptar: 'bitacora_ptar', pozos: 'lecturas_pozos', uf: 'lecturas_uf', calidad: 'muestras_calidad', ptar: 'lecturas_ptar' } as const
export type ModuloDashboard = keyof typeof tablas
const modulos = Object.keys(tablas) as ModuloDashboard[]
const tecnico = (m: ModuloDashboard) => m === 'reporte_calderas' || m === 'reporte_ptar'
const columnasTurno = 'id,fecha_operativa,area,turno,operador_id,iniciado_por,iniciado_en,finalizado_en,notas_cierre,operador:operadores!inner(id,nombre)'
const columnasAlerta = 'id,registro_id,mensaje,valor,limite,estado,creado_en,actualizado_en,origen_estado,detalle,reconocido_por,reconocido_en,cerrado_por,cerrado_en,comentario'
const texto = (v: unknown): v is string => typeof v === 'string' && !!v.trim()
const fecha = (v: unknown): v is string => texto(v) && Number.isFinite(Date.parse(v))
function objeto(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Respuesta inválida.')
  return v as Record<string, unknown>
}
function filas(r: { data: unknown; error: unknown }): Record<string, unknown>[] {
  if (r.error || !Array.isArray(r.data)) throw new Error('Consulta no disponible.')
  return r.data.map(objeto)
}
function conteo(r: { count: number | null; error: unknown }): number {
  if (r.error || r.count === null || !Number.isSafeInteger(r.count) || r.count < 0) throw new Error('Conteo no disponible.')
  return r.count
}
async function fuente<T>(consulta: PromiseLike<T>, error: string): Promise<FuenteDashboard<T>> {
  try { return { valor: await consulta, error: null } } catch { return { valor: null, error } }
}

// Un módulo tiene avance cuando existe al menos una captura vigente en ese turno.
// Los embeds se limitan a un ID por módulo y turno: no se descarga el historial.
async function turnosActivos(signal: AbortSignal) {
  let q = supabase.from('turnos_operativos').select(`${columnasTurno},${modulos.map(m => `${m}:${tablas[m]}(id)`).join(',')}`, { count: 'exact' })
    .is('finalizado_en', null).in('area', ['calderas', 'ptar'])
  for (const m of modulos) {
    if (!tecnico(m)) q = q.is(`${m}.eliminado_en`, null)
    q = q.limit(1, { referencedTable: m })
  }
  const r = await q.order('iniciado_en', { ascending: false }).order('id').limit(50).abortSignal(signal)
  return { total: conteo(r), filas: filas(r).map(v => {
    const t = leerTurnoPlanta(v)
    if (t.turno.finalizado_en !== null) throw new Error('Turno no activo.')
    const completados = modulosArea[t.turno.area].filter(m => {
      // PostgREST devuelve objeto/null para las relaciones uno a uno (Pozos y UF).
      const relacion = v[m]
      const capturas = relacion === null ? [] : Array.isArray(relacion) ? relacion : [objeto(relacion)]
      if (capturas.length > 1 || capturas.some(e => !texto(objeto(e).id))) throw new Error('Avance no disponible.')
      return capturas.length > 0
    })
    return { ...t, completados }
  }) }
}
export function intervaloHoyDashboard(ahora: Date) {
  const hoy = fechaMexicoAdmin(ahora.toISOString()).slice(0, 10)
  const siguiente = new Date(`${hoy}T12:00:00Z`)
  siguiente.setUTCDate(siguiente.getUTCDate() + 1)
  return { fecha: hoy, desde: instanteMexicoAdmin(`${hoy}T00:00`), hasta: instanteMexicoAdmin(`${siguiente.toISOString().slice(0, 10)}T00:00`) }
}
async function contarCapturas(m: ModuloDashboard, desde: string, hasta: string, signal: AbortSignal) {
  let q = supabase.from(tablas[m]).select('id', { count: 'exact', head: true })
  if (!tecnico(m)) q = q.is('eliminado_en', null)
  const campo = tecnico(m) ? 'creado_en' : 'capturado_en'
  return conteo(await q.gte(campo, desde).lt(campo, hasta).abortSignal(signal))
}
async function capturasRecientes(m: ModuloDashboard, signal: AbortSignal): Promise<ActividadDashboard[]> {
  const campo = tecnico(m) ? 'creado_en' : 'capturado_en'
  let q = supabase.from(tablas[m]).select(`id,${campo},turno:turnos_operativos!inner(area,operador:operadores!inner(nombre))`)
  if (!tecnico(m)) q = q.is('eliminado_en', null)
  const r = await q.order(campo, { ascending: false }).order('id').limit(5).abortSignal(signal)
  return filas(r).map(v => {
    const t = objeto(v.turno), o = objeto(t.operador)
    if (!texto(v.id) || !fecha(v[campo]) || !texto(o.nombre) || !['calderas', 'ptar'].includes(String(t.area))) throw new Error('Actividad inválida.')
    return { id: `${m}:${v.id}`, fecha: v[campo] as string, tipo: nombresModuloDashboard[m], descripcion: `Captura registrada · ${t.area === 'calderas' ? 'Calderas' : 'PTAR'} · ${o.nombre}` }
  })
}
async function movimientosTurno(cierre: boolean, signal: AbortSignal): Promise<ActividadDashboard[]> {
  const campo = cierre ? 'finalizado_en' : 'iniciado_en'
  let q = supabase.from('turnos_operativos').select(columnasTurno)
  if (cierre) q = q.not('finalizado_en', 'is', null)
  const r = await q.order(campo, { ascending: false }).order('id').limit(5).abortSignal(signal)
  return filas(r).map(v => {
    const t = leerTurnoPlanta(v)
    const instante = cierre ? t.turno.finalizado_en : t.turno.iniciado_en
    if (!instante) throw new Error('Movimiento no disponible.')
    return { id: `${campo}:${t.turno.id}`, fecha: instante, tipo: 'Turno', descripcion: `${cierre ? 'Cierre' : 'Inicio'} de turno · ${t.turno.area === 'calderas' ? 'Calderas' : 'PTAR'} · ${t.operadorNombre}` }
  })
}
const nombresRevisionDashboard = { ...nombresModulo, bitacora_calderas: 'Reporte técnico Calderas', bitacora_ptar: 'Reporte técnico PTAR' }
async function movimientosAdmin(atenciones: boolean, signal: AbortSignal): Promise<ActividadDashboard[]> {
  const r = await supabase.from(atenciones ? 'atenciones_alerta' : 'revisiones_captura')
    .select(`id,accion,responsable_nombre,creado_en${atenciones ? '' : ',modulo'}`)
    .order('creado_en', { ascending: false }).order('id').limit(5).abortSignal(signal)
  return filas(r).map(v => {
    const acciones = atenciones ? { reconocer: 'Alerta reconocida', cerrar: 'Alerta cerrada' } : { corregir: 'Captura corregida', anular: 'Captura anulada' }
    const accion = acciones[v.accion as keyof typeof acciones]
    if (!accion || !texto(v.id) || !fecha(v.creado_en) || !texto(v.responsable_nombre)
      || (!atenciones && !Object.hasOwn(nombresRevisionDashboard, String(v.modulo)))) throw new Error('Movimiento inválido.')
    return { id: `${atenciones ? 'alerta' : 'revision'}:${v.id}`, fecha: v.creado_en, tipo: atenciones ? 'Alertas' : nombresRevisionDashboard[v.modulo as keyof typeof nombresRevisionDashboard], descripcion: `${accion} · ${v.responsable_nombre}` }
  })
}
export async function consultarDashboardAdministracion(cuenta: string, signal: AbortSignal, ahora = new Date()): Promise<DatosDashboard> {
  exigirAdminRevision(cuenta); signal.throwIfAborted()
  const hoy = intervaloHoyDashboard(ahora)
  const [turnos, abiertas, alertas, capturasPorModulo, actividades] = await Promise.all([
    fuente(turnosActivos(signal), 'No se pudieron consultar los turnos y su avance.'),
    fuente((async () => conteo(await supabase.from('alertas_operativas').select('id', { count: 'exact', head: true })
      .eq('tipo', 'calidad_fuera_norma_v1').eq('estado', 'abierta').abortSignal(signal)))(), 'No se pudo consultar el número de alertas abiertas.'),
    fuente((async () => filas(await supabase.from('alertas_operativas').select(columnasAlerta).eq('tipo', 'calidad_fuera_norma_v1')
      .in('estado', ['abierta', 'reconocida']).order('creado_en', { ascending: false }).order('id').limit(5).abortSignal(signal)).map(leerAlerta))(), 'Las alertas recientes no están disponibles.'),
    Promise.all(modulos.map(m => fuente(contarCapturas(m, hoy.desde, hoy.hasta, signal), `Conteo de ${nombresModuloDashboard[m]} no disponible.`))),
    Promise.all([...modulos.map(m => fuente(capturasRecientes(m, signal), nombresModuloDashboard[m])),
      fuente(movimientosTurno(false, signal), 'Inicio de turnos'), fuente(movimientosTurno(true, signal), 'Cierre de turnos'),
      fuente(movimientosAdmin(false, signal), 'Revisiones'), fuente(movimientosAdmin(true, signal), 'Atención de alertas')]),
  ])
  signal.throwIfAborted(); exigirAdminRevision(cuenta)
  const conteosCompletos = capturasPorModulo.every(f => f.valor !== null)
  return { fecha: hoy.fecha, consultado: ahora.toISOString(), turnos, abiertas, alertas,
    capturas: { valor: conteosCompletos ? capturasPorModulo.reduce((n, f) => n + f.valor!, 0) : null,
      error: conteosCompletos ? null : capturasPorModulo.filter(f => f.error).map(f => f.error).join(' ') },
    actividad: actividades.flatMap(f => f.valor ?? []).sort((a, b) => Date.parse(b.fecha) - Date.parse(a.fecha) || a.id.localeCompare(b.id)).slice(0, 5),
    actividadParcial: actividades.some(f => f.error),
  }
}
