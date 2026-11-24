import { invalidarCacheAvisosActivos } from './informacionDia'

const evento = 'copamex:informacion-actualizada'
const canal = 'copamex:informacion-dia'
// Cinco minutos para avisos del día, producción y eventos.
export const intervaloInformacion = 300000
// Tres minutos para el aviso general que se comparte con operadores.
export const intervaloAviso = 180000

// Agrupa notificaciones de foco, visibilidad y cambios que llegan en el mismo ciclo.
export function crearActualizadorAgrupado(actualizar: () => void) {
  let temporizador: number | null = null
  return {
    solicitar() {
      if (document.visibilityState === 'hidden' || temporizador !== null) return
      temporizador = window.setTimeout(() => {
        temporizador = null
        if (document.visibilityState === 'visible') actualizar()
      }, 50)
    },
    limpiar() {
      if (temporizador !== null) window.clearTimeout(temporizador)
      temporizador = null
    },
  }
}

export function escucharReactivacionInformacion(actualizar: () => void): () => void {
  const alVolver = () => {
    if (document.visibilityState === 'visible') actualizar()
  }
  window.addEventListener('focus', alVolver)
  window.addEventListener('online', alVolver)
  document.addEventListener('visibilitychange', alVolver)
  return () => {
    window.removeEventListener('focus', alVolver)
    window.removeEventListener('online', alVolver)
    document.removeEventListener('visibilitychange', alVolver)
  }
}

// Solo comunica que hay cambios: se consultan los datos con la sesión y RLS vigentes.
export function notificarInformacionActualizada(): void {
  if (typeof window === 'undefined') return
  invalidarCacheAvisosActivos()
  window.dispatchEvent(new Event(evento))
  try {
    const emisor = new window.BroadcastChannel(canal)
    emisor.postMessage(null)
    emisor.close()
  } catch { /* Se conserva la consulta periódica si BroadcastChannel no está disponible. */ }
}

export function escucharCambiosInformacion(actualizar: () => void): () => void {
  let receptor: BroadcastChannel | null = null
  const alCambiar = () => {
    invalidarCacheAvisosActivos()
    actualizar()
  }
  window.addEventListener(evento, alCambiar)
  window.addEventListener('copamex:avisos-actualizados', alCambiar)
  try {
    receptor = new window.BroadcastChannel(canal)
    receptor.addEventListener('message', alCambiar)
  } catch { /* Se conserva el evento local y la consulta periódica. */ }
  return () => {
    window.removeEventListener(evento, alCambiar)
    window.removeEventListener('copamex:avisos-actualizados', alCambiar)
    receptor?.close()
  }
}
