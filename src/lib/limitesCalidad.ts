import { supabase } from './supabase'
import { useAuthStore } from '../stores/authStore'

export interface LimiteCalidad { id: string; punto_id: string; parametro_id: string; limite_min: number | null; limite_max: number | null; vigente_desde: string; vigente_hasta: string | null; creado_en: string; creado_por: string | null; activo: boolean }
export interface CambioLimite { cuenta: string; id: string; original: string | null; punto: string; parametro: string; minimo: number | null; maximo: number | null }
export class ErrorLimite extends Error { readonly incierto: boolean; constructor(mensaje: string, incierto = false) { super(mensaje); this.incierto = incierto } }
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(v)
const fecha = (v: unknown): v is string => typeof v === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(v) && Number.isFinite(Date.parse(v))
const numero = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER
const columnas = 'id,punto_id,parametro_id,limite_min,limite_max,vigente_desde,vigente_hasta,creado_en,creado_por,activo'
const pendientes = new Map<string, CambioLimite>()
const disenosPendientes = new Set<string>()
export const pendienteDisenoLimite = (cuenta: string) => disenosPendientes.has(cuenta)
export const pendienteLimite = (cuenta: string) => pendientes.get(cuenta) ?? null
export function exigirSesionLimite(cuenta: string, admin = false) {
  const a = useAuthStore.getState()
  if (a.estado !== 'autenticado' || a.perfil?.activo !== true || a.perfil.id !== cuenta || a.sesion?.user.id !== cuenta || (admin && a.perfil.rol !== 'admin')) throw new ErrorLimite('La sesión cambió. Inicia sesión con la cuenta autorizada.')
}
export function leerLimite(v: unknown): LimiteCalidad {
  if (!v || typeof v !== 'object') throw new ErrorLimite('Respuesta de límites inválida.')
  const r = v as LimiteCalidad
  if (!uuid(r.id) || !uuid(r.punto_id) || !uuid(r.parametro_id) || !fecha(r.vigente_desde) || !fecha(r.creado_en)
    || (r.vigente_hasta !== null && (!fecha(r.vigente_hasta) || Date.parse(r.vigente_hasta) <= Date.parse(r.vigente_desde)))
    || (r.creado_por !== null && !uuid(r.creado_por)) || r.activo !== (r.vigente_hasta === null)
    || (r.limite_min !== null && !numero(r.limite_min)) || (r.limite_max !== null && !numero(r.limite_max))
    || (r.limite_min === null && r.limite_max === null) || (r.limite_min !== null && r.limite_max !== null && r.limite_min > r.limite_max)) throw new ErrorLimite('No se pudo comprobar la versión del límite.')
  return r
}
export function numeroLimite(texto: string): number | null {
  const s = texto.trim()
  if (!s) return null
  const n = Number(s.replace(',', '.'))
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(s) || !numero(n)) throw new ErrorLimite('Escribe números válidos sin separadores de miles.')
  // Misma comprobación de conservación decimal que usa la captura de Calidad.
  const normal = (t: string) => {
    const limpio = t.replace(',', '.').replace(/^\+/, ''), negativo = limpio.startsWith('-')
    const [mantisa, exp = '0'] = limpio.replace(/^-/, '').toLowerCase().split('e')
    const [entera, fraccion = ''] = mantisa.split('.'), digitos = entera + fraccion, posicion = entera.length + Number(exp)
    const valor = (posicion <= 0 ? `0.${'0'.repeat(-posicion)}${digitos}` : posicion >= digitos.length ? digitos + '0'.repeat(posicion - digitos.length) : `${digitos.slice(0,posicion)}.${digitos.slice(posicion)}`).replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
    return `${negativo && !/^0(?:\.0*)?$/.test(valor) ? '-' : ''}${valor.startsWith('.') ? '0' : ''}${valor}`
  }
  if (Math.abs(n) !== 0 && normal(s) !== normal(String(n))) throw new ErrorLimite('El límite tiene más cifras de las que se pueden conservar.')
  return n === 0 ? 0 : n
}
export const evaluarLimite = (valor: number, minimo: number | null, maximo: number | null): boolean | null => minimo === null && maximo === null ? null : (minimo !== null && valor < minimo) || (maximo !== null && valor > maximo)
export const textoLimite = (min: number | null, max: number | null) => [min !== null ? `≥ ${min}` : '', max !== null ? `≤ ${max}` : ''].filter(Boolean).join(' · ') || 'Sin límite definido'
export async function consultarLimites(cuenta: string, historial: boolean, signal: AbortSignal): Promise<LimiteCalidad[]> {
  exigirSesionLimite(cuenta, historial); signal.throwIfAborted()
  const filas: LimiteCalidad[] = [], ids = new Set<string>()
  for (let offset = 0; offset < 10000; offset += 200) {
    let q = supabase.from('limites_calidad').select(columnas).order('vigente_desde', { ascending: false }).order('id').range(offset, offset + 199)
    if (!historial) q = q.is('vigente_hasta', null)
    const r = await q.abortSignal(signal)
    exigirSesionLimite(cuenta, historial); signal.throwIfAborted()
    if (r.error || !Array.isArray(r.data)) throw new ErrorLimite('No se pudieron consultar los límites. Actualiza para reintentar.')
    for (const v of r.data) { const l = leerLimite(v); if (ids.has(l.id)) throw new ErrorLimite('Los límites cambiaron durante la consulta. Actualiza.'); ids.add(l.id); filas.push(l) }
    if (r.data.length < 200) {
      const abiertas = filas.filter(l => l.vigente_hasta === null).map(l => `${l.punto_id}:${l.parametro_id}`)
      if (new Set(abiertas).size !== abiertas.length) throw new ErrorLimite('Hay versiones activas duplicadas. Revisa la configuración.')
      return filas
    }
  }
  throw new ErrorLimite('El historial supera la consulta disponible; no se presenta como completo.')
}
export function prepararCambioLimite(cuenta: string, punto: string, parametro: string, original: string | null, min: string, max: string): CambioLimite {
  exigirSesionLimite(cuenta, true)
  if (pendienteLimite(cuenta) || pendienteDisenoLimite(cuenta)) throw new ErrorLimite('Primero confirma el guardado pendiente.')
  const minimo = numeroLimite(min), maximo = numeroLimite(max)
  if (!uuid(punto) || !uuid(parametro) || (original !== null && !uuid(original)) || (minimo === null && maximo === null) || (minimo !== null && maximo !== null && minimo > maximo)) throw new ErrorLimite('Define al menos un límite y verifica que mínimo ≤ máximo.')
  return Object.freeze({ cuenta, punto, parametro, original, minimo, maximo, id: crypto.randomUUID() })
}
export async function guardarCambioLimite(s: CambioLimite): Promise<string> {
  exigirSesionLimite(s.cuenta, true)
  const previo = pendienteLimite(s.cuenta)
  if (previo && previo.id !== s.id) throw new ErrorLimite('Primero confirma el guardado pendiente.')
  pendientes.set(s.cuenta, s)
  const controller = new AbortController()
  const baja = useAuthStore.subscribe(() => { try { exigirSesionLimite(s.cuenta, true) } catch { controller.abort() } })
  try {
    const r = await supabase.rpc('guardar_limite_calidad_versionado', { p_id: s.id, p_version_esperada: s.original, p_punto_id: s.punto, p_parametro_id: s.parametro, p_limite_min: s.minimo, p_limite_max: s.maximo }).abortSignal(controller.signal)
    exigirSesionLimite(s.cuenta, true)
    if (r.error) {
      const definido = ['42501','22023','23505','40001','PGRST202'].includes(r.error.code)
      if (definido) pendientes.delete(s.cuenta)
      throw new ErrorLimite(r.error.code === 'PGRST202' ? 'Primero aplica el SQL de límites 033 en Supabase.' : definido ? r.error.message : 'No se confirmó el cambio. Usa Comprobar / reintentar.', !definido)
    }
    if (r.data !== s.id) throw new ErrorLimite('La respuesta no confirma esta solicitud. Comprueba el guardado.', true)
    pendientes.delete(s.cuenta)
    return s.id
  } catch (e) { if (e instanceof ErrorLimite) throw e; throw new ErrorLimite('No se confirmó el cambio. Usa Comprobar / reintentar.', true) }
  finally { baja() }
}
export async function cargarDisenoLimites(cuenta: string): Promise<void> {
  exigirSesionLimite(cuenta, true)
  if (pendienteLimite(cuenta)) throw new ErrorLimite('Primero confirma el guardado pendiente.')
  disenosPendientes.add(cuenta)
  const controller = new AbortController()
  const baja = useAuthStore.subscribe(() => { try { exigirSesionLimite(cuenta, true) } catch { controller.abort() } })
  try {
    const r = await supabase.rpc('cargar_limites_diseno_calidad').abortSignal(controller.signal)
    exigirSesionLimite(cuenta, true)
    if (r.error || !Number.isInteger(r.data) || r.data < 0 || r.data > 9) {
      const definido = !!r.error && ['42501','22023','PGRST202'].includes(r.error.code)
      if (definido) disenosPendientes.delete(cuenta)
      throw new ErrorLimite(r.error?.code === 'PGRST202' ? 'Primero aplica el SQL de límites 033 en Supabase.' : 'No se confirmó la carga. Usa Comprobar carga del diseño; conserva cualquier límite existente.', !definido)
    }
    disenosPendientes.delete(cuenta)
  } catch(e) { if(e instanceof ErrorLimite) throw e; throw new ErrorLimite('No se confirmó la carga. Usa Comprobar carga del diseño.', true) }
  finally { baja() }
}
