import { useEffect } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { useTurnoStore } from '../../stores/turnoStore'
import { usePozosStore } from '../../stores/pozosStore'
import {
  actualizarDatosPozos,
  cancelarGestionPozos,
  obtenerContextoPozos,
  sincronizarContextoPozos,
} from '../../hooks/usePozos'

// Montar una sola vez en App, fuera de las rutas.
// Al navegar se conserva la solicitud pendiente de la cuenta actual.
export function ControlPozos() {
  useEffect(() => {
    let activo = true
    let temporizador: number | null = null

    const sincronizar = () => {
      if (activo) sincronizarContextoPozos()
    }

    function puedeActualizar(): boolean {
      const datos = usePozosStore.getState()
      return activo && document.visibilityState === 'visible'
        && obtenerContextoPozos() !== null && !datos.guardando
        && datos.estadoCarga !== 'cargando'
    }

    const actualizarAlVolver = () => {
      if (!puedeActualizar() || temporizador !== null) return
      // Focus y visibilitychange pueden llegar juntos; agrupamos la consulta.
      temporizador = window.setTimeout(() => {
        temporizador = null
        if (puedeActualizar()) void actualizarDatosPozos()
      }, 0)
    }

    const desuscribirAuth = useAuthStore.subscribe(sincronizar)
    const desuscribirTurno = useTurnoStore.subscribe(sincronizar)
    sincronizar()
    window.addEventListener('focus', actualizarAlVolver)
    document.addEventListener('visibilitychange', actualizarAlVolver)

    return () => {
      activo = false
      desuscribirAuth()
      desuscribirTurno()
      window.removeEventListener('focus', actualizarAlVolver)
      document.removeEventListener('visibilitychange', actualizarAlVolver)
      if (temporizador !== null) window.clearTimeout(temporizador)
      cancelarGestionPozos()
    }
  }, [])

  return null
}
