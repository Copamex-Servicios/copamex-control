import { supabase } from './supabase'
import { useAuthStore } from '../stores/authStore'
export type EstadoAlerta = 'abierta' | 'reconocida' | 'cerrada'
export interface DetalleAlerta { muestra_id: string; turno_id: string; operador_id: string; operador: string; area: 'calderas' | 'ptar'; turno: 'dia' | 'tarde' | 'noche'; fecha_operativa: string; capturado_en: string; cuenta_captura: string; punto_id: string; punto: string; parametro_id: string; parametro: string; unidad: string | null; limite_min: number | null; limite_max: number | null; historica: boolean }
export interface Alerta { id: string; registro_id: string; mensaje: string; valor: number; limite: number; estado: EstadoAlerta; creado_en: string; actualizado_en: string; origen_estado: 'vigente' | 'corregido' | 'anulado'; detalle: DetalleAlerta; reconocido_por: string | null; reconocido_en: string | null; cerrado_por: string | null; cerrado_en: string | null; comentario: string | null }
export interface AtencionAlerta { id: string; alerta_id: string; accion: 'reconocer' | 'cerrar'; estado_anterior: EstadoAlerta; estado_nuevo: EstadoAlerta; version_esperada: string; comentario: string; creado_por: string; responsable_nombre: string; creado_en: string }
export interface FiltrosAlertas { area: 'todas' | 'calderas' | 'ptar'; estado: 'pendientes' | 'todas' | EstadoAlerta }
export interface SolicitudAtencion { cuenta: string; id: string; alerta: string; estado: EstadoAlerta; version: string; accion: 'reconocer' | 'cerrar'; comentario: string }
export class ErrorAlerta extends Error { readonly incierto: boolean; constructor(mensaje: string, incierto = false) { super(mensaje); this.incierto = incierto } }
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(v)
const fecha = (v: unknown): v is string => typeof v === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(v) && Number.isFinite(Date.parse(v))
const texto = (v: unknown): v is string => typeof v === 'string' && !!v.trim()
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER
const estado = (v: unknown): v is EstadoAlerta => ['abierta','reconocida','cerrada'].includes(String(v))
const pendientes = new Map<string, SolicitudAtencion>()
export const pendienteAtencion = (cuenta: string) => pendientes.get(cuenta) ?? null
export function exigirCuentaAlerta(cuenta: string, admin = false) {
  const a = useAuthStore.getState()
  if (a.estado !== 'autenticado' || a.perfil?.activo !== true || a.perfil.id !== cuenta || a.sesion?.user.id !== cuenta || !['admin','calderas','ptar'].includes(a.perfil.rol) || (admin && a.perfil.rol !== 'admin')) throw new ErrorAlerta('La sesión cambió o no tiene permiso para esta acción.')
}
export function leerAlerta(v: unknown): Alerta {
  if (!v || typeof v !== 'object') throw new ErrorAlerta('Respuesta de alertas inválida.')
  const a = v as Alerta, d = a.detalle
  if (!uuid(a.id) || !uuid(a.registro_id) || !texto(a.mensaje) || !num(a.valor) || !num(a.limite) || !estado(a.estado) || !fecha(a.creado_en) || !fecha(a.actualizado_en)
    || !['vigente','corregido','anulado'].includes(a.origen_estado) || !d || typeof d !== 'object'
    || ![d.muestra_id,d.turno_id,d.operador_id,d.cuenta_captura,d.punto_id,d.parametro_id].every(uuid)
    || ![d.operador,d.punto,d.parametro].every(texto) || !['calderas','ptar'].includes(d.area) || !['dia','tarde','noche'].includes(d.turno)
    || !/^\d{4}-\d{2}-\d{2}$/.test(d.fecha_operativa) || !fecha(d.capturado_en) || typeof d.historica !== 'boolean'
    || (d.unidad !== null && typeof d.unidad !== 'string') || (d.limite_min !== null && !num(d.limite_min)) || (d.limite_max !== null && !num(d.limite_max))
    || Date.parse(a.actualizado_en)<Date.parse(a.creado_en)
    || (d.limite_min !== null && d.limite_max !== null && d.limite_min>d.limite_max)
    || a.limite !== (d.limite_min !== null && a.valor<d.limite_min ? d.limite_min : d.limite_max)
    || !(d.limite_min !== null && a.valor < d.limite_min || d.limite_max !== null && a.valor > d.limite_max)
    || [a.reconocido_por,a.cerrado_por].some(x => x !== null && !uuid(x)) || [a.reconocido_en,a.cerrado_en].some(x => x !== null && !fecha(x))
    || (a.comentario !== null && typeof a.comentario !== 'string')
    || (a.estado === 'abierta' && (a.reconocido_por !== null || a.reconocido_en !== null || a.cerrado_por !== null || a.cerrado_en !== null))
    || (a.estado !== 'abierta' && (!a.reconocido_por || !a.reconocido_en)) || (a.estado === 'cerrada' && (!a.cerrado_por || !a.cerrado_en))
    || (a.estado !== 'cerrada' && (a.cerrado_por !== null || a.cerrado_en !== null))) throw new ErrorAlerta('No se pudieron comprobar la alerta y sus datos originales.')
  return a
}
const columnas = 'id,registro_id,mensaje,valor,limite,estado,creado_en,actualizado_en,origen_estado,detalle,reconocido_por,reconocido_en,cerrado_por,cerrado_en,comentario'
export async function consultarAlertas(cuenta: string, filtros: FiltrosAlertas, signal: AbortSignal): Promise<{ filas: Alerta[]; limitada: boolean }> {
  exigirCuentaAlerta(cuenta); signal.throwIfAborted()
  if (!['todas','calderas','ptar'].includes(filtros.area) || !['pendientes','todas','abierta','reconocida','cerrada'].includes(filtros.estado)) throw new ErrorAlerta('Revisa los filtros de alertas.')
  const filas: Alerta[] = [], ids = new Set<string>()
  for (let offset = 0; offset < 1000; offset += 200) {
    let q = supabase.from('alertas_operativas').select(columnas).eq('tipo','calidad_fuera_norma_v1').order('creado_en',{ascending:false}).order('id').range(offset,offset+199)
    if (filtros.area !== 'todas') q = q.eq('detalle->>area',filtros.area)
    if (filtros.estado === 'pendientes') q = q.in('estado',['abierta','reconocida'])
    else if (filtros.estado !== 'todas') q = q.eq('estado',filtros.estado)
    const r = await q.abortSignal(signal)
    exigirCuentaAlerta(cuenta); signal.throwIfAborted()
    if (r.error || !Array.isArray(r.data)) throw new ErrorAlerta(r.error?.code === '42703' ? 'Aplica primero el SQL 034 de Alertas en Supabase.' : 'No se pudieron consultar las alertas. Actualiza para reintentar.')
    for (const v of r.data) { const a = leerAlerta(v); if(ids.has(a.id)) throw new ErrorAlerta('Las alertas cambiaron durante la consulta. Actualiza.'); ids.add(a.id); filas.push(a) }
    if(r.data.length<200) return { filas, limitada:false }
  }
  return { filas, limitada:true }
}
export async function consultarAtenciones(cuenta: string, alerta: string, signal: AbortSignal): Promise<AtencionAlerta[]> {
  exigirCuentaAlerta(cuenta); signal.throwIfAborted()
  if(!uuid(alerta)) throw new ErrorAlerta('Alerta inválida.')
  const r = await supabase.from('atenciones_alerta').select('id,alerta_id,accion,estado_anterior,estado_nuevo,version_esperada,comentario,creado_por,responsable_nombre,creado_en').eq('alerta_id',alerta).order('creado_en').order('id').limit(3).abortSignal(signal)
  exigirCuentaAlerta(cuenta); signal.throwIfAborted()
  if(r.error || !Array.isArray(r.data) || r.data.length>2) throw new ErrorAlerta('No se pudo comprobar el historial de atención.')
  const filas = r.data.map(v => {
    const a = v as AtencionAlerta
    if(!uuid(a.id) || a.alerta_id!==alerta || !uuid(a.creado_por) || !texto(a.responsable_nombre) || !texto(a.comentario) || !fecha(a.creado_en) || !fecha(a.version_esperada)
      || !(a.accion==='reconocer' && a.estado_anterior==='abierta' && a.estado_nuevo==='reconocida' || a.accion==='cerrar' && a.estado_anterior==='reconocida' && a.estado_nuevo==='cerrada')) throw new ErrorAlerta('Historial de atención inválido.')
    return a
  })
  if(new Set(filas.map(a=>a.id)).size!==filas.length) throw new ErrorAlerta('Historial duplicado.')
  return filas
}
export function prepararAtencion(cuenta: string, alerta: Alerta, comentario: string): SolicitudAtencion {
  exigirCuentaAlerta(cuenta,true)
  if(pendienteAtencion(cuenta)) throw new ErrorAlerta('Primero confirma el guardado pendiente.')
  leerAlerta(alerta)
  if(alerta.estado==='cerrada' || !comentario.trim() || comentario.trim().length>4000) throw new ErrorAlerta('Escribe un comentario de atención para una alerta pendiente.')
  return Object.freeze({cuenta,id:crypto.randomUUID(),alerta:alerta.id,estado:alerta.estado,version:alerta.actualizado_en,accion:alerta.estado==='abierta'?'reconocer':'cerrar',comentario:comentario.trim()})
}
export async function guardarAtencion(s: SolicitudAtencion): Promise<void> {
  exigirCuentaAlerta(s.cuenta,true)
  const p = pendienteAtencion(s.cuenta)
  if(p && p.id!==s.id) throw new ErrorAlerta('Primero confirma el guardado pendiente.')
  pendientes.set(s.cuenta,s)
  const controller = new AbortController(), baja = useAuthStore.subscribe(()=>{try{exigirCuentaAlerta(s.cuenta,true)}catch{controller.abort()}})
  try {
    const r = await supabase.rpc('atender_alerta_calidad',{p_id:s.id,p_alerta_id:s.alerta,p_estado_esperado:s.estado,p_version_esperada:s.version,p_accion:s.accion,p_comentario:s.comentario}).abortSignal(controller.signal)
    exigirCuentaAlerta(s.cuenta,true)
    if(r.error){const definido = ['42501','22023','23505','40001','PGRST202'].includes(r.error.code); if(definido) pendientes.delete(s.cuenta); throw new ErrorAlerta(r.error.code==='PGRST202'?'Aplica primero el SQL 034 de Alertas.':definido?r.error.message:'No se confirmó la atención. Usa Comprobar / reintentar.',!definido)}
    if(r.data!==s.id) throw new ErrorAlerta('La respuesta no confirma esta solicitud. Usa Comprobar / reintentar.',true)
    pendientes.delete(s.cuenta)
  } catch(e){if(e instanceof ErrorAlerta)throw e;throw new ErrorAlerta('No se confirmó la atención. Usa Comprobar / reintentar.',true)}
  finally { baja() }
}
