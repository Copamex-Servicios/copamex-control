const evento = 'copamex:informacion-actualizada'
const canal = 'copamex:informacion-dia'
// Cinco minutos para avisos del día, producción y eventos.
export const intervaloInformacion = 300000
// Tres minutos para el aviso general que se comparte con operadores.
export const intervaloAviso = 180000

// Solo comunica que hay cambios: se consultan los datos con la sesión y RLS vigentes.
export function notificarInformacionActualizada(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(evento))
  try {
    const emisor = new window.BroadcastChannel(canal)
    emisor.postMessage(null)
    emisor.close()
  } catch { /* Se conserva la consulta periódica si BroadcastChannel no está disponible. */ }
}

export function escucharCambiosInformacion(actualizar: () => void): () => void {
  let receptor: BroadcastChannel | null = null
  window.addEventListener(evento, actualizar)
  window.addEventListener('copamex:avisos-actualizados', actualizar)
  try {
    receptor = new window.BroadcastChannel(canal)
    receptor.addEventListener('message', actualizar)
  } catch { /* Se conserva el evento local y la consulta periódica. */ }
  return () => {
    window.removeEventListener(evento, actualizar)
    window.removeEventListener('copamex:avisos-actualizados', actualizar)
    receptor?.close()
  }
}
