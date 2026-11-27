import { supabase } from './supabase'
import type { AreaOperativa } from './tiposTurno'

export interface AvisoDia { id: string; mensaje: string; fin?: string }
export interface ProduccionDia { id: string; maquina: string; papel: string; color: string | null; consumo: string | null }
export interface EventoDia { id: string; fecha: string; tipo: string; area: string; horario: string | null; motivo: string | null }
export interface ResultadoDia<T> { elementos: T[]; error: boolean }
export interface InformacionDia {
  avisos: ResultadoDia<AvisoDia>
  produccion: ResultadoDia<ProduccionDia>
  eventos: ResultadoDia<EventoDia>
}

interface CacheAvisos {
  resultado: ResultadoDia<AvisoDia>
  vence: number
  revision: number
}

interface SolicitudAvisos {
  controlador: AbortController
  promesa: Promise<ResultadoDia<AvisoDia>>
  revision: number
  suscriptores: number
  completa: boolean
  cancelacion: number | null
}

const cacheAvisos = new Map<string, CacheAvisos>()
const solicitudesAvisos = new Map<string, SolicitudAvisos>()
const vigenciaCacheAvisos = 2000
let revisionCacheAvisos = 0

function idSesion(token: string | undefined, ultimoAcceso: string | undefined): string {
  try {
    const parte = token?.split('.')[1]
    if (parte) {
      const normalizada = parte.replace(/-/g, '+').replace(/_/g, '/')
      const datos: unknown = JSON.parse(atob(normalizada.padEnd(Math.ceil(normalizada.length / 4) * 4, '=')))
      if (datos && typeof datos === 'object' && 'session_id' in datos
        && typeof datos.session_id === 'string') return datos.session_id
    }
  } catch { /* Usar el identificador disponible si el token no incluye session_id. */ }
  return ultimoAcceso ?? 'sesion-activa'
}

export function claveCacheAvisos(
  cuentaId: string, token: string | undefined, ultimoAcceso: string | undefined,
  rol: string, area: string,
): string {
  return JSON.stringify([cuentaId, idSesion(token, ultimoAcceso), rol, area])
}

export function invalidarCacheAvisosActivos(): void {
  revisionCacheAvisos += 1
  cacheAvisos.clear()
}

function errorAbortado(): Error {
  const error = new Error('Consulta cancelada')
  error.name = 'AbortError'
  return error
}

function esperarAvisos(solicitud: SolicitudAvisos, signal: AbortSignal): Promise<ResultadoDia<AvisoDia>> {
  if (signal.aborted) return Promise.reject(errorAbortado())
  solicitud.suscriptores += 1
  if (solicitud.cancelacion !== null) window.clearTimeout(solicitud.cancelacion)
  solicitud.cancelacion = null
  return new Promise((resolve, reject) => {
    let liberada = false
    const liberar = () => {
      if (liberada) return
      liberada = true
      signal.removeEventListener('abort', alAbortar)
      solicitud.suscriptores -= 1
      if (solicitud.suscriptores === 0 && !solicitud.completa && solicitud.cancelacion === null) {
        solicitud.cancelacion = window.setTimeout(() => {
          solicitud.cancelacion = null
          if (solicitud.suscriptores === 0 && !solicitud.completa) solicitud.controlador.abort()
        }, 0)
      }
    }
    const alAbortar = () => { liberar(); reject(errorAbortado()) }
    signal.addEventListener('abort', alAbortar, { once: true })
    solicitud.promesa.then(resultado => {
      if (liberada) return
      liberar()
      resolve(resultado)
    }, error => {
      if (liberada) return
      liberar()
      reject(error)
    })
  })
}

function crearSolicitudAvisos(clave: string): SolicitudAvisos {
  const controlador = new AbortController()
  const revision = revisionCacheAvisos
  const solicitud: SolicitudAvisos = {
    controlador,
    promesa: Promise.resolve({ elementos: [], error: true }),
    revision,
    suscriptores: 0,
    completa: false,
    cancelacion: null,
  }
  solicitud.promesa = leer(supabase.from('avisos').select('id,mensaje,permanente,fin')
    .or('permanente.eq.true,and(or(inicio.is.null,inicio.lte.now),or(fin.is.null,fin.gt.now))')
    .order('creado_en', { ascending: false }).limit(20).abortSignal(controlador.signal), valor => {
    const r = fila(valor)
    const fin = r.permanente !== true && typeof r.fin === 'string' && Number.isFinite(Date.parse(r.fin)) ? r.fin : undefined
    return { id: texto(r.id), mensaje: texto(r.mensaje), ...(fin ? { fin } : {}) }
  }).then(resultado => {
    if (!controlador.signal.aborted && !resultado.error && revision === revisionCacheAvisos) {
      cacheAvisos.set(clave, { resultado, vence: Date.now() + vigenciaCacheAvisos, revision })
    }
    return resultado
  }).finally(() => {
    solicitud.completa = true
    if (solicitud.cancelacion !== null) window.clearTimeout(solicitud.cancelacion)
    if (solicitudesAvisos.get(clave) === solicitud) solicitudesAvisos.delete(clave)
  })
  solicitudesAvisos.set(clave, solicitud)
  return solicitud
}

export function consultarAvisosActivos(clave: string, signal: AbortSignal): Promise<ResultadoDia<AvisoDia>> {
  if (!clave || signal.aborted) return Promise.reject(errorAbortado())
  const ahora = Date.now()
  for (const [llave, entrada] of cacheAvisos) {
    if (entrada.revision !== revisionCacheAvisos || entrada.vence <= ahora) cacheAvisos.delete(llave)
  }
  const cache = cacheAvisos.get(clave)
  if (cache && cache.revision === revisionCacheAvisos && cache.vence > ahora) {
    return Promise.resolve(cache.resultado)
  }
  cacheAvisos.delete(clave)
  const pendiente = solicitudesAvisos.get(clave)
  const solicitud = pendiente?.revision === revisionCacheAvisos ? pendiente : crearSolicitudAvisos(clave)
  return esperarAvisos(solicitud, signal)
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

export async function consultarInformacionDia(
  fecha: string, area: AreaOperativa | 'todas', claveAvisos: string, signal: AbortSignal,
): Promise<InformacionDia> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || signal.aborted) throw new Error('Consulta cancelada')
  const [avisos, produccion, eventos] = await Promise.all([
    consultarAvisosActivos(claveAvisos, signal),
    leer(supabase.from('programa_produccion')
      .select('id,color_objetivo,consumo_objetivo,maquina:maquinas(codigo),papel:catalogo_papeles(nombre)')
      .eq('fecha', fecha).eq('activo', true).order('creado_en').limit(20).abortSignal(signal), valor => {
      const r = fila(valor)
      return { id: texto(r.id), maquina: texto(fila(r.maquina).codigo), papel: texto(fila(r.papel).nombre),
        color: opcional(r.color_objetivo), consumo: opcional(r.consumo_objetivo) }
    }),
    leer(supabase.from('eventos_calendario').select('id,fecha,tipo,area,horario,motivo')
      .gte('fecha', fecha).in('area', area === 'todas'
        ? ['calderas', 'CALDERAS', 'Calderas', 'ptar', 'PTAR', 'TODOS', 'Todos', 'todos', 'TODAS', 'Todas', 'todas']
        : [area, area.toUpperCase(), area === 'calderas' ? 'Calderas' : 'PTAR', 'TODOS', 'Todos', 'todos', 'TODAS', 'Todas', 'todas'])
      .order('fecha').order('creado_en').limit(8).abortSignal(signal), valor => {
      const r = fila(valor), fechaEvento = texto(r.fecha)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaEvento)) throw new Error('Fecha inválida')
      return { id: texto(r.id), fecha: fechaEvento, tipo: texto(r.tipo), area: texto(r.area),
        horario: opcional(r.horario), motivo: opcional(r.motivo) }
    }),
  ])
  return { avisos, produccion, eventos }
}
