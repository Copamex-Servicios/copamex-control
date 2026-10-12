import { useSyncExternalStore } from 'react'

function suscribir(alCambiar: () => void) {
  window.addEventListener('online', alCambiar)
  window.addEventListener('offline', alCambiar)
  return () => {
    window.removeEventListener('online', alCambiar)
    window.removeEventListener('offline', alCambiar)
  }
}

export function EstadoRed() {
  const disponible = useSyncExternalStore(suscribir, () => navigator.onLine, () => true)
  return <span className={`estado-red ${disponible ? '' : 'sin-red'}`} role="status">
    <span aria-hidden="true" />{disponible ? 'Red disponible' : 'Sin conexión'}
  </span>
}
