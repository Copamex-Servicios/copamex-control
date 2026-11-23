export type AreaBitacora = 'calderas' | 'ptar'

const PREFIJO = 'copamex:borrador-bitacora:v1:'
const VERSION = 1
const VIGENCIA_MS = 30 * 24 * 60 * 60 * 1000
const TAMANO_MAXIMO = 128_000

interface SobreBorrador {
  version: number
  cuentaId: string
  turnoId: string
  actualizadoEn: number
  borrador: unknown
}

function clave(area: AreaBitacora, cuentaId: string, turnoId: string) {
  return `${PREFIJO}${area}:${cuentaId}:${turnoId}`
}

function normalizar<T>(plantilla: T, valor: unknown): T | null {
  if (typeof plantilla === 'string') return typeof valor === 'string' ? valor as T : null
  if (typeof plantilla === 'boolean') return typeof valor === 'boolean' ? valor as T : null

  if (typeof plantilla !== 'object' || plantilla === null || Array.isArray(plantilla)) return null
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return null

  const fuente = valor as Record<string, unknown>
  const resultado: Record<string, unknown> = {}
  for (const [campo, valorPredeterminado] of Object.entries(plantilla)) {
    if (fuente[campo] === undefined) {
      resultado[campo] = valorPredeterminado
      continue
    }
    const campoNormalizado = normalizar(valorPredeterminado, fuente[campo])
    if (campoNormalizado === null) return null
    resultado[campo] = campoNormalizado
  }

  // Este campo es opcional en los borradores antiguos y admite comentarios incompletos.
  if (fuente.reportesOperadores !== undefined) {
    const reportes: unknown = fuente.reportesOperadores
    if (!Array.isArray(reportes) || reportes.length !== 2 || reportes.some(reporte => {
      if (!reporte || typeof reporte !== 'object' || Array.isArray(reporte)) return true
      const comentario = reporte as Record<string, unknown>
      return typeof comentario.nombre !== 'string' || typeof comentario.comentario !== 'string'
    })) return null
    resultado.reportesOperadores = reportes.map(reporte => {
      const comentario = reporte as { nombre: string; comentario: string }
      return { nombre: comentario.nombre, comentario: comentario.comentario }
    })
  }

  return resultado as T
}

function leerSobre(storage: Storage, item: string): SobreBorrador | null {
  try {
    const texto = storage.getItem(item)
    if (!texto || texto.length > TAMANO_MAXIMO) return null
    const valor: unknown = JSON.parse(texto)
    if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return null
    const sobre = valor as Partial<SobreBorrador>
    if (sobre.version !== VERSION || typeof sobre.cuentaId !== 'string' || typeof sobre.turnoId !== 'string'
      || typeof sobre.actualizadoEn !== 'number' || !Number.isFinite(sobre.actualizadoEn)
      || sobre.actualizadoEn > Date.now() + 5 * 60 * 1000 || !('borrador' in sobre)) return null
    return sobre as SobreBorrador
  } catch {
    return null
  }
}

function limpiarVencidos(storage: Storage) {
  const ahora = Date.now()
  for (let indice = storage.length - 1; indice >= 0; indice--) {
    const item = storage.key(indice)
    if (!item?.startsWith(PREFIJO)) continue
    const sobre = leerSobre(storage, item)
    if (!sobre || ahora - sobre.actualizadoEn > VIGENCIA_MS) storage.removeItem(item)
  }
}

export function leerBorradorBitacoraLocal<T>(
  area: AreaBitacora,
  cuentaId: string,
  turnoId: string,
  plantilla: T,
): T | null {
  if (typeof window === 'undefined') return null
  try {
    const storage = window.localStorage
    limpiarVencidos(storage)
    const item = clave(area, cuentaId, turnoId)
    const sobre = leerSobre(storage, item)
    if (!sobre || sobre.cuentaId !== cuentaId || sobre.turnoId !== turnoId) {
      storage.removeItem(item)
      return null
    }
    const borrador = normalizar(plantilla, sobre.borrador)
    if (borrador === null) storage.removeItem(item)
    return borrador
  } catch {
    return null
  }
}

export function guardarBorradorBitacoraLocal<T>(
  area: AreaBitacora,
  cuentaId: string,
  turnoId: string,
  borrador: T,
): boolean {
  if (typeof window === 'undefined') return false
  try {
    const texto = JSON.stringify({ version: VERSION, cuentaId, turnoId, actualizadoEn: Date.now(), borrador })
    if (texto.length > TAMANO_MAXIMO) return false
    window.localStorage.setItem(clave(area, cuentaId, turnoId), texto)
    return true
  } catch {
    return false
  }
}

export function eliminarBorradorBitacoraLocal(area: AreaBitacora, cuentaId: string, turnoId: string) {
  if (typeof window === 'undefined') return
  try { window.localStorage.removeItem(clave(area, cuentaId, turnoId)) } catch { /* El envío confirmado sigue siendo la fuente oficial. */ }
}
