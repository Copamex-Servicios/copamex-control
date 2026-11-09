import { supabase } from './supabase'
import { useAuthStore } from '../stores/authStore'
import { cacheConsultas } from './cacheConsultas'

export const areasBitacora = { ptar: 'PTAR', calderas: 'Calderas', obra_civil: 'Obra Civil' } as const
export type AreaBitacora = keyof typeof areasBitacora
export interface ActividadAdministrativa {
  id: string; area: AreaBitacora; actividad: string; fecha: string
  creado_en: string; actualizado_en: string; revision: number
}
export interface FiltroBitacora { mes: string; area: AreaBitacora | 'todas'; recientes?: boolean }
export interface CursorBitacora { creado_en: string; id: string }
export interface PaginaBitacora {
  filas: ActividadAdministrativa[]; mas: boolean; mes: string; ahora: string; version: string | null
}
export interface SolicitudBitacora {
  cuenta: string; solicitud: string; id: string; area: AreaBitacora; actividad: string; revision: number | null
}
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(v)
const objeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const instante = (v: unknown): v is string => typeof v === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v))
// PostgreSQL conserva microsegundos: no redondear los cursores a milisegundos.
const ordenInstante = (v: string) => Date.parse(v) * 1000 + Number(((v.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0').slice(3, 6)))
export const mesValido = (v: string) => /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(v)
const areaValida = (v: unknown): v is AreaBitacora => typeof v === 'string' && Object.hasOwn(areasBitacora, v)
export const mensajeRegistroDiario = 'Ya existe una actividad para esta fecha y área. Usa Corregir en el historial.'
export const eventoBitacora = 'copamex:bitacora-administrativa'
const cache = cacheConsultas<PaginaBitacora>('bitacora-administrativa')
let revisionLectura = 0, generacion = 0
const pendientes = new Map<string, SolicitudBitacora>(), enCurso = new Set<string>()
function identidad() {
  const a = useAuthStore.getState()
  return a.estado === 'autenticado' && a.perfil?.activo && a.perfil.id === a.sesion?.user.id
    ? `${a.perfil.id}:${a.perfil.rol}` : null
}
let identidadAnterior = identidad()
const clavePendiente = (cuenta: string) => `copamex:bitacora-administrativa:pendiente:${cuenta}`
function persistir(cuenta: string, solicitud: SolicitudBitacora | null) {
  if (typeof sessionStorage === 'undefined') return
  if (solicitud) sessionStorage.setItem(clavePendiente(cuenta), JSON.stringify(solicitud))
  else sessionStorage.removeItem(clavePendiente(cuenta))
}
useAuthStore.subscribe(() => {
  const siguiente = identidad()
  if (siguiente !== identidadAnterior) {
    const anterior = identidadAnterior?.split(':')[0]
    if (anterior) { try { persistir(anterior, null) } catch { /* No conservar datos entre cuentas. */ } }
    pendientes.clear(); generacion++; revisionLectura++; identidadAnterior = siguiente
  }
})
export function exigirBitacora(admin = false) {
  const a = useAuthStore.getState(), clave = identidad()
  if (!clave || !a.perfil || !['admin', 'calderas', 'ptar', 'calidad'].includes(a.perfil.rol)
    || (admin && a.perfil.rol !== 'admin')) throw new Error('No tienes permiso para esta operación.')
  return { cuenta: a.perfil.id, rol: a.perfil.rol, clave: `${clave}:${generacion}` }
}
export function validarActividad(area: string, actividad: string) {
  const texto = actividad.trim().toLocaleUpperCase('es-MX')
  if (!areaValida(area) || !texto || texto.length > 10000) {
    throw new Error('Selecciona un área y escribe la actividad (máximo 10,000 caracteres).')
  }
  return { area, actividad: texto }
}
function leerActividad(v: unknown, rol: string): ActividadAdministrativa {
  if (!objeto(v) || !uuid(v.id) || !areaValida(v.area) || (rol !== 'admin' && v.area === 'obra_civil')
    || typeof v.actividad !== 'string' || !v.actividad.trim() || v.actividad.length > 10000
    || !instante(v.creado_en) || !instante(v.actualizado_en)
    || typeof v.fecha !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(v.fecha)
    || !Number.isInteger(v.revision) || (v.revision as number) < 0) throw new Error('La actividad recibida no es válida o no está autorizada.')
  return { id: v.id, area: v.area, actividad: v.actividad, fecha: v.fecha, creado_en: v.creado_en,
    actualizado_en: v.actualizado_en, revision: v.revision as number }
}
function mensajeError(e: { code?: string; message?: string } | null) {
  if (e?.code === 'PGRST202' || e?.code === '42P01') return 'La Bitácora administrativa requiere aplicar su migración en Supabase.'
  if (e?.code === '23505' && e.message === mensajeRegistroDiario) return mensajeRegistroDiario
  if (e?.code === '40001') return 'La actividad cambió. Actualiza el historial antes de corregirla.'
  if (e?.code === '42501') return 'Tu cuenta no tiene permiso para esta operación.'
  return 'No se pudo completar la operación. Comprueba la conexión y reintenta.'
}
export async function consultarPaginaBitacora(filtro: FiltroBitacora, cursor: CursorBitacora | null,
  signal: AbortSignal, fresca = false): Promise<PaginaBitacora> {
  const contexto = exigirBitacora(), limite = filtro.recientes ? 5 : 25
  if ((filtro.mes && !mesValido(filtro.mes)) || (filtro.area !== 'todas' && !areaValida(filtro.area))
    || (filtro.area === 'obra_civil' && contexto.rol !== 'admin')
    || (cursor && (!uuid(cursor.id) || !instante(cursor.creado_en)))) throw new Error('Revisa el mes y el área de consulta.')
  signal.throwIfAborted()
  const clave = JSON.stringify([filtro, cursor, revisionLectura]), guardarcache = cache.preparar()
  if (!fresca) { const anterior = cache.leer(clave); if (anterior) return anterior }
  const r = await supabase.rpc('consultar_bitacora_administrativa', {
    p_mes: filtro.mes || null, p_area: filtro.area, p_recientes: !!filtro.recientes,
    p_antes: cursor?.creado_en ?? null, p_antes_id: cursor?.id ?? null, p_limite: limite,
  }).abortSignal(signal)
  if (exigirBitacora().clave !== contexto.clave) throw new Error('La cuenta cambió durante la consulta.')
  signal.throwIfAborted()
  if (r.error) throw new Error(mensajeError(r.error))
  const d: unknown = r.data
  if (!objeto(d) || !Array.isArray(d.filas) || d.filas.length > limite || typeof d.mas !== 'boolean'
    || typeof d.mes !== 'string' || !mesValido(d.mes) || !instante(d.ahora)
    || (d.version !== null && !instante(d.version))) throw new Error('La página de actividades está incompleta.')
  const filas = d.filas.map(v => leerActividad(v, contexto.rol))
  if ((d.mas && filas.length !== limite) || new Set(filas.map(f => f.id)).size !== filas.length
    || (filtro.mes && d.mes !== filtro.mes)) throw new Error('La página de actividades está incompleta.')
  let anterior = cursor
  for (const fila of filas) {
    if ((filtro.area !== 'todas' && fila.area !== filtro.area) || (!filtro.recientes && !fila.fecha.startsWith(d.mes))) throw new Error('La actividad no corresponde al filtro.')
    if (anterior && (ordenInstante(fila.creado_en) > ordenInstante(anterior.creado_en)
      || (ordenInstante(fila.creado_en) === ordenInstante(anterior.creado_en) && fila.id >= anterior.id))) throw new Error('El orden de actividades no es válido.')
    anterior = fila
  }
  const salida = { filas, mas: d.mas, mes: d.mes, ahora: d.ahora, version: d.version }
  guardarcache(clave, salida)
  return salida
}
// Disponibilidad, no listado completo: basta el último registro del área con fecha de servidor.
export async function consultarRegistroDiario(area: AreaBitacora, signal: AbortSignal) {
  exigirBitacora(true)
  const pagina = await consultarPaginaBitacora({ mes: '', area, recientes: true }, null, signal, true)
  const partes = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(pagina.ahora))
  const valor = (tipo: string) => partes.find(p => p.type === tipo)!.value
  const fecha = valor('year') + '-' + valor('month') + '-' + valor('day')
  return { fecha, registro: pagina.filas.find(f => f.fecha === fecha) ?? null }
}
export function pendienteBitacora(): SolicitudBitacora | null {
  const { cuenta } = exigirBitacora(true)
  if (pendientes.has(cuenta)) return pendientes.get(cuenta)!
  if (typeof sessionStorage === 'undefined') return null
  let v: unknown
  try { const texto = sessionStorage.getItem(clavePendiente(cuenta)); if (!texto) return null; v = JSON.parse(texto) } catch { return null }
  if (!objeto(v) || v.cuenta !== cuenta || !uuid(v.solicitud) || !uuid(v.id)
    || !areaValida(v.area) || typeof v.actividad !== 'string' || !v.actividad.trim() || v.actividad.length > 10000
    || !(v.revision === null || (Number.isInteger(v.revision) && (v.revision as number) >= 0))) throw new Error('No se pudo recuperar el guardado pendiente.')
  const solicitud = v as unknown as SolicitudBitacora
  pendientes.set(cuenta, solicitud)
  return solicitud
}
export function prepararActividad(area: string, actividad: string, original: ActividadAdministrativa | null): SolicitudBitacora {
  const { cuenta } = exigirBitacora(true)
  if (pendienteBitacora()) throw new Error('Confirma primero el guardado pendiente.')
  const valores = validarActividad(area, actividad)
  const s = Object.freeze({ cuenta, solicitud: crypto.randomUUID(), id: original?.id ?? crypto.randomUUID(),
    ...valores, revision: original?.revision ?? null })
  // Persistir la misma solicitud antes de enviarla; recargar no crea otro identificador.
  try { persistir(cuenta, s) } catch { throw new Error('Permite el almacenamiento de la pestaña para guardar sin duplicar solicitudes.') }
  pendientes.set(cuenta, s)
  return s
}
export async function guardarActividad(s: SolicitudBitacora): Promise<ActividadAdministrativa> {
  const contexto = exigirBitacora(true)
  if (s.cuenta !== contexto.cuenta || JSON.stringify(pendienteBitacora()) !== JSON.stringify(s)) throw new Error('La solicitud no corresponde a la cuenta actual.')
  if (enCurso.has(s.cuenta)) throw new Error('El guardado ya está en curso.')
  enCurso.add(s.cuenta)
  const control = new AbortController(), limite = setTimeout(() => control.abort(), 20000)
  try {
    const r = await supabase.rpc('guardar_bitacora_administrativa', {
      p_solicitud: s.solicitud, p_id: s.id, p_area: s.area, p_actividad: s.actividad, p_revision: s.revision,
    }).abortSignal(control.signal)
    if (exigirBitacora(true).clave !== contexto.clave) throw new Error('La cuenta cambió durante el guardado.')
    if (r.error) {
      // Estos rechazos SQL no confirmaron ninguna escritura; se puede corregir la solicitud.
      if (['22023', '42501', '40001', '23505', 'PGRST202', '42P01'].includes(r.error.code)) {
        pendientes.delete(s.cuenta); persistir(s.cuenta, null)
      }
      throw new Error(mensajeError(r.error))
    }
    const fila = leerActividad(r.data, 'admin')
    if (fila.id !== s.id || fila.area !== s.area || fila.actividad !== s.actividad
      || fila.revision !== (s.revision === null ? 0 : s.revision + 1)) throw new Error('No se pudo confirmar la respuesta. Reintenta el mismo guardado.')
    pendientes.delete(s.cuenta); persistir(s.cuenta, null); revisionLectura++
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(eventoBitacora))
    return fila
  } finally { clearTimeout(limite); enCurso.delete(s.cuenta) }
}

// Datos listos para Word: sin generador, dependencias ni controles de exportación incompletos.
export async function recuperarMesAdministrativo(mes: string, area: AreaBitacora | 'todas', signal: AbortSignal) {
  const contexto = exigirBitacora(true)
  if (!mesValido(mes)) throw new Error('Selecciona un mes válido.')
  const todas: ActividadAdministrativa[] = [], ids = new Set<string>()
  let cursor: CursorBitacora | null = null, version: string | null | undefined
  do {
    const pagina = await consultarPaginaBitacora({ mes, area }, cursor, signal, true)
    if (exigirBitacora(true).clave !== contexto.clave) throw new Error('La cuenta cambió durante la consulta.')
    if (version !== undefined && version !== pagina.version) throw new Error('Las actividades cambiaron durante la consulta. Vuelve a preparar el mes.')
    version = pagina.version
    for (const fila of pagina.filas) {
      if (ids.has(fila.id)) throw new Error('La consulta contiene actividades repetidas.')
      ids.add(fila.id); todas.push(fila)
    }
    cursor = pagina.mas ? pagina.filas.at(-1)! : null
  } while (cursor)
  return { mes, areas: (Object.keys(areasBitacora) as AreaBitacora[]).filter(a => area === 'todas' || a === area).map(a => ({
    area: a, nombre: areasBitacora[a], actividades: todas.filter(f => f.area === a).sort((a, b) => ordenInstante(a.creado_en) - ordenInstante(b.creado_en) || a.id.localeCompare(b.id)),
  })) }
}
