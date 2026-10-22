import { supabase } from './supabase'
import { useAuthStore } from '../stores/authStore'
import { exigirAdminRevision } from './revisionCapturas'
import { leerReporteCalderas } from './bitacoraTecnicaCalderas'
import type { ReporteTecnicoCalderas, ResumenReporteCalderas } from './bitacoraTecnicaCalderas'
import { leerReportePTAR } from './bitacoraTecnicaPTAR'
import type { ReporteTecnicoPTAR } from './bitacoraTecnicaPTAR'
import { equiposCalderas, pilasCalderas, equiposAguaCalderas } from './tiposBitacoraCalderas'
import type { BorradorBitacoraCalderas } from './tiposBitacoraCalderas'
import { medicionesBitacoraPTAR, bombasBitacoraPTAR, prensasBitacoraPTAR } from './tiposBitacoraPTAR'
import type { BorradorBitacoraPTAR } from './tiposBitacoraPTAR'
import type { AreaOperativa } from './tiposTurno'

export type FilaTecnicaAdmin = ResumenReporteCalderas & { area: AreaOperativa }
export type DetalleTecnicoAdmin = { area: 'calderas'; reporte: ReporteTecnicoCalderas; fila: FilaTecnicaAdmin }
  | { area: 'ptar'; reporte: ReporteTecnicoPTAR; fila: FilaTecnicaAdmin }
export interface RevisionTecnica { id: string; motivo: string; responsable_nombre: string; creado_en: string; antes: unknown; despues: unknown }
export interface SolicitudTecnica { cuenta: string; id: string; detalle: DetalleTecnicoAdmin; rpc: string; datos: Record<string, unknown>; motivo: string }
const pendientes = new Map<string, SolicitudTecnica>(), enCurso = new Set<string>()
const modulo = (area: AreaOperativa) => `bitacora_${area}`
const objeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(v)
export const pendienteTecnica = (cuenta: string) => pendientes.get(cuenta) ?? null
useAuthStore.subscribe(() => {
  for (const cuenta of pendientes.keys()) { try { exigirAdminRevision(cuenta) } catch { pendientes.delete(cuenta) } }
})

export function leerDetalleTecnico(snapshot: unknown, fila: FilaTecnicaAdmin): DetalleTecnicoAdmin {
  const detalle: DetalleTecnicoAdmin = fila.area === 'calderas'
    ? { area: 'calderas', fila, reporte: leerReporteCalderas(snapshot, fila.turnoId) }
    : { area: 'ptar', fila, reporte: leerReportePTAR(snapshot, fila.turnoId) }
  if (detalle.reporte.id !== fila.id) throw new Error('El detalle no corresponde al reporte seleccionado.')
  return detalle
}
export async function consultarTecnicoAdmin(cuenta: string, fila: FilaTecnicaAdmin, signal: AbortSignal) {
  exigirAdminRevision(cuenta)
  const r = await supabase.rpc('consultar_bitacora_tecnica', { p_modulo: modulo(fila.area), p_id: fila.id }).abortSignal(signal)
  exigirAdminRevision(cuenta); signal.throwIfAborted()
  if (r.error || !objeto(r.data) || r.data.modulo !== modulo(fila.area) || !objeto(r.data.turno)
    || r.data.turno.id !== fila.turnoId || r.data.turno.area !== fila.area) throw new Error('No se pudo consultar el reporte técnico autorizado.')
  return leerDetalleTecnico(r.data.snapshot, fila)
}
export async function consultarHistorialTecnico(cuenta: string, detalle: DetalleTecnicoAdmin, pagina: number, signal: AbortSignal) {
  exigirAdminRevision(cuenta)
  const r = await supabase.rpc('consultar_revisiones_bitacora_tecnica_admin', {
    p_modulo: modulo(detalle.area), p_reporte_id: detalle.reporte.id, p_limite: 25, p_offset: pagina * 25,
  }).abortSignal(signal)
  exigirAdminRevision(cuenta); signal.throwIfAborted()
  if (r.error || !objeto(r.data) || !Array.isArray(r.data.filas) || typeof r.data.mas !== 'boolean' || r.data.filas.length > 25) throw new Error('No se pudo consultar el historial técnico. Comprueba que la RPC existente esté instalada.')
  const filas = r.data.filas.map((v: unknown) => {
    if (!objeto(v) || !uuid(v.id) || v.modulo !== modulo(detalle.area) || v.registro_id !== detalle.reporte.id
      || v.accion !== 'corregir' || typeof v.motivo !== 'string' || typeof v.responsable_nombre !== 'string'
      || typeof v.creado_en !== 'string' || !Number.isFinite(Date.parse(v.creado_en))) throw new Error('Historial técnico inválido.')
    leerDetalleTecnico(v.antes, detalle.fila); leerDetalleTecnico(v.despues, detalle.fila)
    return v as unknown as RevisionTecnica
  })
  if (new Set(filas.map(v => v.id)).size !== filas.length) throw new Error('El historial contiene revisiones duplicadas. Actualiza.')
  return { filas, mas: r.data.mas }
}

// Las RPC de corrección exigen JSON normalizado completo, incluyendo NULL explícitos.
// Rechazar decimales que JSON/Number redondearía evita enviar una corrección silenciosa.
function decimalCanonico(v: string): string {
  const m = v.match(/^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i)
  if (!m || !(m[2] + (m[3] ?? '')).length) throw new Error('Revisa las mediciones numéricas.')
  let digitos = (m[2] + (m[3] ?? '')).replace(/^0+/, ''), exp = Number(m[4] ?? 0) - (m[3]?.length ?? 0)
  if (!digitos) return '0'
  while (digitos.endsWith('0')) { digitos = digitos.slice(0, -1); exp++ }
  return `${m[1] === '-' ? '-' : ''}${digitos}e${exp}`
}
const texto = (v: string) => v.trim() || null
function numero(v: string) {
  if (!v.trim()) return null
  const n = Number(v)
  if (!Number.isFinite(n) || decimalCanonico(v.trim()) !== decimalCanonico(String(n))) throw new Error('Una medición no puede enviarse sin perder precisión. Revisa el valor antes de corregir.')
  return n
}
function datosCalderas(b: BorradorBitacoraCalderas, formato: 1 | 2) {
  if (equiposCalderas.some(e => e.id.startsWith('caldera_') && b.equipos[e.id].presion.trim())) throw new Error('Las Calderas no registran presión.')
  const datos: Record<string, unknown> = {
    mediciones: Object.fromEntries(Object.entries(b.mediciones).map(([k, v]) => [k, numero(v)])),
    equipos: Object.fromEntries(equiposCalderas.map(e => [e.id, { estado: texto(b.equipos[e.id].estado), presion: numero(b.equipos[e.id].presion) }])),
    pilas: Object.fromEntries(pilasCalderas.map(p => [p.id, { nivel: numero(b.pilas[p.id].nivel), bomba: texto(b.pilas[p.id].bomba), presion: numero(b.pilas[p.id].presion) }])),
    compresores: Object.fromEntries(Object.entries(b.compresores).map(([k, v]) => [k, texto(v)])), estadoUF: texto(b.estadoUF), comentariosUF: texto(b.comentariosUF),
  }
  if (formato === 2) Object.assign(datos, { versionFormato: 2, servicioAgua: Object.fromEntries(equiposAguaCalderas.map(e => [e.id, b.servicioAgua[e.id] ? true : null])) })
  return datos
}
function datosPTAR(b: BorradorBitacoraPTAR): Record<string, unknown> {
  return {
    mediciones: Object.fromEntries(medicionesBitacoraPTAR.map(m => [m.campo, numero(b.mediciones[m.campo])])),
    bombas: Object.fromEntries(bombasBitacoraPTAR.map(k => [k, b.bombas[k] === 'Automático (A)' ? 'A' : b.bombas[k] === 'Manual (M)' ? 'M' : null])),
    prensas: Object.fromEntries(prensasBitacoraPTAR.map(k => [k, texto(b.prensas[k])])),
    estadoAgitador: texto(b.estadoAgitador), destinoDescarga: texto(b.destinoDescarga), comentarioPrensas: texto(b.comentarioPrensas),
  }
}
export function prepararCorreccionTecnica(cuenta: string, detalle: DetalleTecnicoAdmin, b: BorradorBitacoraCalderas | BorradorBitacoraPTAR, motivo: string): SolicitudTecnica {
  exigirAdminRevision(cuenta)
  if (pendienteTecnica(cuenta)) throw new Error('Primero confirma la corrección pendiente.')
  if (!motivo.trim() || motivo.trim().length > 4000) throw new Error('Escribe el motivo obligatorio (hasta 4,000 caracteres).')
  if (JSON.stringify(b) === JSON.stringify(detalle.reporte.borrador)) throw new Error('No hay cambios para guardar.')
  const original = detalle.reporte.borrador, relevante = texto(b.reporteRelevante)
  const legadoCalderas = detalle.area === 'calderas' && detalle.reporte.versionFormato === 1
  if (b.reporteRelevante.trim().length > 4000 || (!relevante && !!original.reporteRelevante)) throw new Error('El reporte relevante del turno es obligatorio (hasta 4,000 caracteres).')
  if (legadoCalderas && b.reporteRelevante !== original.reporteRelevante) throw new Error('La RPC original conserva el reporte relevante del formato 1.')
  if (legadoCalderas && 'servicioAgua' in b && 'servicioAgua' in original && equiposAguaCalderas.some(e => b.servicioAgua[e.id] !== original.servicioAgua[e.id])) throw new Error('El formato 1 no permite modificar selecciones en servicio.')
  const datos = detalle.area === 'calderas' && 'equipos' in b ? datosCalderas(b, detalle.reporte.versionFormato)
    : detalle.area === 'ptar' && 'bombas' in b ? datosPTAR(b) : null
  if (!datos) throw new Error('Los campos no corresponden al área del reporte.')
  let rpc = 'corregir_bitacora_tecnica_admin'
  if (detalle.area === 'calderas' && !legadoCalderas) rpc = relevante ? 'corregir_bitacora_calderas_admin_v3' : 'corregir_bitacora_calderas_admin_v2'
  if (detalle.area === 'ptar' && relevante) rpc = 'corregir_bitacora_ptar_admin_v2'
  if (!legadoCalderas && relevante) datos.reporteRelevante = relevante
  return Object.freeze(JSON.parse(JSON.stringify({ cuenta, id: crypto.randomUUID(), detalle, rpc, datos, motivo: motivo.trim() })) as SolicitudTecnica)
}
export async function guardarCorreccionTecnica(s: SolicitudTecnica): Promise<DetalleTecnicoAdmin> {
  exigirAdminRevision(s.cuenta)
  if (!['corregir_bitacora_tecnica_admin', 'corregir_bitacora_calderas_admin_v2', 'corregir_bitacora_calderas_admin_v3', 'corregir_bitacora_ptar_admin_v2'].includes(s.rpc)) throw new Error('Operación de corrección no reconocida.')
  if (enCurso.has(s.cuenta)) throw new Error('La corrección se está procesando.')
  if (pendienteTecnica(s.cuenta) && pendienteTecnica(s.cuenta)?.id !== s.id) throw new Error('Primero confirma la corrección pendiente.')
  enCurso.add(s.cuenta); pendientes.set(s.cuenta, s)
  const control = new AbortController(), limite = setTimeout(() => control.abort(), 25000)
  const baja = useAuthStore.subscribe(() => { try { exigirAdminRevision(s.cuenta) } catch { control.abort() } })
  try {
    const args: Record<string, unknown> = { p_id: s.id, p_reporte_id: s.detalle.reporte.id, p_revision_esperada: s.detalle.reporte.revision, p_datos: s.datos, p_motivo: s.motivo }
    if (s.rpc === 'corregir_bitacora_tecnica_admin' || s.rpc === 'corregir_bitacora_ptar_admin_v2') args.p_modulo = modulo(s.detalle.area)
    const r = await supabase.rpc(s.rpc, args).abortSignal(control.signal)
    exigirAdminRevision(s.cuenta)
    if (r.error) {
      const definido = ['42501', '22023', '22P02', '23505', '23514', '40001', 'PGRST202', 'PGRST203'].includes(r.error.code)
      if (definido) pendientes.delete(s.cuenta)
      throw new Error(r.error.code === 'PGRST202' ? 'La RPC de corrección necesaria no está instalada. No se intentará otra escritura.'
        : r.error.code === '40001' ? 'El reporte cambió. Actualiza el detalle antes de corregir.'
          : definido ? r.error.message : 'No se confirmó la corrección. Usa Comprobar / reintentar.')
    }
    if (!objeto(r.data) || r.data.id !== s.id || r.data.confirmado !== true || typeof r.data.reintento !== 'boolean') throw new Error('La respuesta no confirma esta solicitud. Usa Comprobar / reintentar.')
    const resultado = leerDetalleTecnico(r.data.snapshot, s.detalle.fila), antes = s.detalle.reporte, despues = resultado.reporte
    if (despues.revision < antes.revision + 1 || despues.cuentaId !== antes.cuentaId || despues.creadoEn !== antes.creadoEn
      || (resultado.area === 'calderas' && s.detalle.area === 'calderas' && resultado.reporte.versionFormato !== s.detalle.reporte.versionFormato)) throw new Error('No se pudo comprobar la revisión confirmada. Usa Comprobar / reintentar.')
    pendientes.delete(s.cuenta)
    return resultado
  } catch (e) { if (e instanceof Error) throw e; throw new Error('No se confirmó la corrección. Usa Comprobar / reintentar.') }
  finally { clearTimeout(limite); baja(); enCurso.delete(s.cuenta) }
}
