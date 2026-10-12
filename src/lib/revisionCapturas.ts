import { supabase } from './supabase'
import { useAuthStore } from '../stores/authStore'
import { esFechaOperativa } from './turnos'
export type ModuloRevision = 'bitacora' | 'pozos' | 'uf' | 'calidad' | 'ptar'
export interface FiltrosRevision { desde: string; hasta: string; area: string; turno: string; modulo: string; estado: string; operador: string }
export interface SnapshotRevision { registro: Record<string, unknown>; resultados: Record<string, unknown>[] }
export interface CapturaRevision { id: string; modulo: ModuloRevision; turno: { id: string; area: string; turno: string; fecha_operativa: string }; operador: string; snapshot: SnapshotRevision; nombres_resultados: { id: string; punto: string; parametro: string; unidad: string | null }[] }
export interface Revision { id: string; modulo: ModuloRevision; registro_id: string; accion: string; motivo: string; creado_por: string; responsable_nombre: string; creado_en: string; antes: SnapshotRevision; despues: SnapshotRevision }
export interface SolicitudRevision { cuenta: string; id: string; captura: string; modulo: ModuloRevision; original: SnapshotRevision; accion: 'corregir' | 'anular'; datos: Record<string, unknown>; motivo: string }
export interface CampoRevision { clave: string; nombre: string; texto?: boolean; nullable?: boolean }
export const nombresRevision: Record<ModuloRevision, string> = { bitacora: 'Bitácora', pozos: 'Pozos', uf: 'Ultrafiltración', calidad: 'Calidad', ptar: 'PTAR' }
export const camposRevision: Record<ModuloRevision, CampoRevision[]> = {
  bitacora: [{ clave: 'texto', nombre: 'Nota de Bitácora', texto: true }],
  pozos: [['pozo1_ini','Pozo 1 · Inicial (m³)'],['pozo1_fin','Pozo 1 · Final (m³)'],['pozo2_ini','Pozo 2 · Inicial (m³)'],['pozo2_fin','Pozo 2 · Final (m³)']].map(([clave,nombre])=>({clave,nombre})),
  uf: [['alim_ini','Alimentación · Inicial (m³)'],['alim_fin','Alimentación · Final (m³)'],['acep_ini','Aceptación · Inicial (m³)'],['acep_fin','Aceptación · Final (m³)']].map(([clave,nombre])=>({clave,nombre})),
  calidad: [],
  ptar: ['dqo','sst'].flatMap(p=>[['sand_float','Sand Float'],['t03_04','T03 / T04'],['colector','Colector'],['pila','Pila']].map(([k,n])=>({clave:`${p}_${k}`,nombre:`${p.toUpperCase()} · ${n} (mg/L)`,nullable:true}))),
}
for (const m of ['pozos','uf','calidad','ptar'] as const) camposRevision[m].push({ clave:'notas', nombre:'Notas', texto:true, nullable:true })
const uuid = (s: unknown): s is string => typeof s==='string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(s)
const instante = (s: unknown): s is string => typeof s==='string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(s) && Number.isFinite(Date.parse(s))
const objeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v==='object' && !Array.isArray(v)
const modulo = (v: unknown): v is ModuloRevision => typeof v==='string' && Object.hasOwn(nombresRevision,v)
export class ErrorRevision extends Error { readonly incierto: boolean; constructor(m: string, incierto=false) { super(m); this.incierto=incierto } }
export function exigirAdminRevision(cuenta: string) {
  const a=useAuthStore.getState()
  if(a.estado!=='autenticado' || a.perfil?.activo!==true || a.perfil.rol!=='admin' || a.perfil.id!==cuenta || a.sesion?.user.id!==cuenta) throw new ErrorRevision('La sesión cambió o no tiene permiso de administración.')
}
export function leerSnapshotRevision(v: unknown): SnapshotRevision {
  if(!objeto(v) || !objeto(v.registro) || !Array.isArray(v.resultados) || !v.resultados.every(objeto)) throw new ErrorRevision('Datos originales inválidos.')
  const r=v.registro
  if(!uuid(r.id) || !uuid(r.turno_id) || !uuid(r.creado_por) || !instante(r.capturado_en) || !instante(r.recibido_en)
    || !Number.isSafeInteger(r.revision_admin) || Number(r.revision_admin)<0
    || (r.eliminado_en!==null && !instante(r.eliminado_en)) || (r.eliminado_por!==null && !uuid(r.eliminado_por))) throw new ErrorRevision('No se pudieron comprobar la captura y su versión.')
  if(v.resultados.some(e=>!uuid(e.id) || e.muestra_id!==r.id || !uuid(e.punto_id) || !uuid(e.parametro_id)
    || typeof e.valor!=='number' || !Number.isFinite(e.valor) || Math.abs(e.valor)>Number.MAX_SAFE_INTEGER
    || [e.limite_min_aplicado,e.limite_max_aplicado].some(x=>x!==null && (typeof x!=='number' || !Number.isFinite(x))))) throw new ErrorRevision('Resultados originales inválidos.')
  if(new Set(v.resultados.map(e=>e.id)).size!==v.resultados.length) throw new ErrorRevision('Resultados duplicados.')
  return {registro:r,resultados:v.resultados}
}
export function leerCapturaRevision(v: unknown): CapturaRevision {
  if(!objeto(v) || !uuid(v.id) || !modulo(v.modulo) || !objeto(v.turno) || !uuid(v.turno.id)
    || !['calderas','ptar'].includes(String(v.turno.area)) || !['dia','tarde','noche'].includes(String(v.turno.turno))
    || typeof v.turno.fecha_operativa!=='string' || !esFechaOperativa(v.turno.fecha_operativa) || typeof v.operador!=='string' || !v.operador.trim()
    || !Array.isArray(v.nombres_resultados)) throw new ErrorRevision('Captura administrativa inválida.')
  const snapshot=leerSnapshotRevision(v.snapshot)
  if(snapshot.registro.id!==v.id || snapshot.registro.turno_id!==v.turno.id) throw new ErrorRevision('La captura no corresponde al turno.')
  const nombres=v.nombres_resultados
  if(nombres.some(n=>!objeto(n) || !uuid(n.id) || typeof n.punto!=='string' || typeof n.parametro!=='string' || (n.unidad!==null && typeof n.unidad!=='string'))
    || (v.modulo==='calidad' && (nombres.length!==snapshot.resultados.length || snapshot.resultados.some(r=>!nombres.some(n=>n.id===r.id))))) throw new ErrorRevision('Nombres de resultados inválidos.')
  return {...v,snapshot} as unknown as CapturaRevision
}
export function validarFiltrosRevision(f: FiltrosRevision) {
  if(!esFechaOperativa(f.desde) || !esFechaOperativa(f.hasta) || f.hasta<f.desde || (Date.parse(f.hasta)-Date.parse(f.desde))/86400000>30
    || !['todas','calderas','ptar'].includes(f.area) || !['todos','dia','tarde','noche'].includes(f.turno)
    || (f.modulo!=='todos' && !modulo(f.modulo)) || !['vigentes','anuladas','todos'].includes(f.estado) || f.operador.length>200) throw new ErrorRevision('Revisa los filtros. Consulta hasta 31 días por período.')
}
export async function consultarCapturasRevision(cuenta: string, f: FiltrosRevision, pagina: number, signal: AbortSignal) {
  exigirAdminRevision(cuenta); validarFiltrosRevision(f); signal.throwIfAborted()
  if(!Number.isInteger(pagina) || pagina<1 || pagina>4001) throw new ErrorRevision('Página inválida.')
  const r=await supabase.rpc('consultar_capturas_admin',{p_desde:f.desde,p_hasta:f.hasta,p_area:f.area,p_turno:f.turno,p_modulo:f.modulo,p_estado:f.estado,p_operador:f.operador.trim(),p_offset:(pagina-1)*25}).abortSignal(signal)
  exigirAdminRevision(cuenta); signal.throwIfAborted()
  if(r.error || !objeto(r.data) || !Array.isArray(r.data.filas) || typeof r.data.mas!=='boolean' || r.data.filas.length>25) throw new ErrorRevision(r.error?.code==='PGRST202'?'Aplica primero el SQL 035 de revisión administrativa.':'No se pudieron consultar las capturas. Actualiza para reintentar.')
  const filas=r.data.filas.map(leerCapturaRevision)
  if(new Set(filas.map(c=>`${c.modulo}:${c.id}`)).size!==filas.length) throw new ErrorRevision('La consulta cambió. Actualiza.')
  return {filas,mas:r.data.mas}
}
export async function consultarHistorialRevision(cuenta: string, captura: CapturaRevision, signal: AbortSignal): Promise<Revision[]> {
  exigirAdminRevision(cuenta)
  const r=await supabase.from('revisiones_captura').select('id,modulo,registro_id,accion,motivo,creado_por,responsable_nombre,creado_en,antes,despues')
    .eq('modulo',captura.modulo).eq('registro_id',captura.id).order('creado_en',{ascending:false}).order('id').limit(101).abortSignal(signal)
  exigirAdminRevision(cuenta); signal.throwIfAborted()
  if(r.error || !Array.isArray(r.data)) throw new ErrorRevision('No se pudo consultar el historial administrativo.')
  if(r.data.length>100) throw new ErrorRevision('Este registro supera 100 revisiones. Se requiere consultar su auditoría completa.')
  return r.data.map(v=>{
    if(!objeto(v) || !uuid(v.id) || v.modulo!==captura.modulo || v.registro_id!==captura.id || !['corregir','anular'].includes(String(v.accion))
      || !uuid(v.creado_por) || !instante(v.creado_en) || typeof v.motivo!=='string' || typeof v.responsable_nombre!=='string') throw new ErrorRevision('Historial administrativo inválido.')
    return {...v,antes:leerSnapshotRevision(v.antes),despues:leerSnapshotRevision(v.despues)} as unknown as Revision
  })
}
export function datosEdicionRevision(c: CapturaRevision): Record<string,string> {
  const d: Record<string,string>={}
  for(const f of camposRevision[c.modulo]) d[f.clave]=c.snapshot.registro[f.clave]===null?'':String(c.snapshot.registro[f.clave]??'')
  for(const r of c.snapshot.resultados) d[`resultado:${r.id}`]=String(r.valor)
  return d
}
function numero(v: string, nullable=false): number|null {
  if(nullable && !v.trim()) return null
  if(!/^\d+(?:[.,]\d+)?$/.test(v.trim())) throw new ErrorRevision('Usa números no negativos, sin separadores de miles.')
  const n=Number(v.trim().replace(',','.'))
  if(!Number.isFinite(n) || n>Number.MAX_SAFE_INTEGER) throw new ErrorRevision('Número fuera del rango permitido.')
  return n
}
const pendientes=new Map<string,SolicitudRevision>()
export const pendienteRevision=(cuenta:string)=>pendientes.get(cuenta)??null
export function prepararRevision(cuenta: string,c: CapturaRevision,accion: 'corregir'|'anular',campos:Record<string,string>,motivo:string): SolicitudRevision {
  exigirAdminRevision(cuenta); leerCapturaRevision(c)
  if(pendienteRevision(cuenta)) throw new ErrorRevision('Primero confirma el guardado pendiente.')
  if(!motivo.trim() || motivo.trim().length>4000 || c.snapshot.registro.eliminado_en!==null) throw new ErrorRevision('Escribe el motivo para una captura vigente.')
  const datos: Record<string,unknown>={}
  if(accion==='corregir') {
    for(const f of camposRevision[c.modulo]){
      const v=campos[f.clave]??''
      if(f.texto){ if((!f.nullable&&!v.trim()) || v.length>20000) throw new ErrorRevision('Revisa el texto o las notas.'); datos[f.clave]=v.trim()||null }
      else datos[f.clave]=numero(v,!!f.nullable)
    }
    if(c.modulo==='calidad') datos.resultados=c.snapshot.resultados.map(r=>({id:r.id,valor:numero(campos[`resultado:${r.id}`]??'')}))
    if(c.modulo==='pozos' && (Number(datos.pozo1_fin)<Number(datos.pozo1_ini)||Number(datos.pozo2_fin)<Number(datos.pozo2_ini))) throw new ErrorRevision('La lectura final debe ser mayor o igual que la inicial.')
    if(c.modulo==='uf' && (Number(datos.alim_fin)<Number(datos.alim_ini)||Number(datos.acep_fin)<Number(datos.acep_ini))) throw new ErrorRevision('La lectura final debe ser mayor o igual que la inicial.')
    if(c.modulo==='ptar' && !Object.entries(datos).some(([k,v])=>k!=='notas' && v!==null)) throw new ErrorRevision('Completa al menos una medición PTAR.')
    const previo=datosEdicionRevision(c)
    if(Object.keys(previo).every(k=>(campos[k]??'').trim()===previo[k].trim())) throw new ErrorRevision('No hay cambios para guardar.')
  }
  return Object.freeze(JSON.parse(JSON.stringify({cuenta,id:crypto.randomUUID(),captura:c.id,modulo:c.modulo,original:c.snapshot,accion,datos,motivo:motivo.trim()})) as SolicitudRevision)
}
export async function guardarRevision(s: SolicitudRevision): Promise<void> {
  exigirAdminRevision(s.cuenta)
  if(pendienteRevision(s.cuenta) && pendienteRevision(s.cuenta)?.id!==s.id) throw new ErrorRevision('Primero confirma el guardado pendiente.')
  pendientes.set(s.cuenta,s)
  const control=new AbortController(), baja=useAuthStore.subscribe(()=>{try{exigirAdminRevision(s.cuenta)}catch{control.abort()}})
  try {
    const r=await supabase.rpc('revisar_captura_admin',{p_id:s.id,p_modulo:s.modulo,p_registro:s.captura,p_original:s.original,p_accion:s.accion,p_datos:s.datos,p_motivo:s.motivo}).abortSignal(control.signal)
    exigirAdminRevision(s.cuenta)
    if(r.error){const definido=['42501','22023','22P02','23505','23514','40001','PGRST202'].includes(r.error.code);if(definido)pendientes.delete(s.cuenta);throw new ErrorRevision(r.error.code==='PGRST202'?'Aplica primero el SQL 035.':definido?r.error.message:'No se confirmó el cambio. Usa Comprobar / reintentar.',!definido)}
    if(r.data!==s.id) throw new ErrorRevision('La respuesta no confirma esta solicitud. Usa Comprobar / reintentar.',true)
    pendientes.delete(s.cuenta)
  } catch(e) { if(e instanceof ErrorRevision)throw e;throw new ErrorRevision('No se confirmó el cambio. Usa Comprobar / reintentar.',true) }
  finally { baja() }
}
