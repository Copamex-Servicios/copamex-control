import { useEffect } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { useTurnoStore } from '../../stores/turnoStore'
import { usePTARStore } from '../../stores/ptarStore'
import {
  actualizarDatosPTAR,
  cancelarGestionPTAR,
  obtenerContextoPTAR,
  sincronizarContextoPTAR,
} from '../../hooks/usePTAR'

// Montar una sola vez en App, fuera de las rutas.
// Al navegar se conserva la solicitud pendiente de la cuenta actual.
export function ControlPTAR() {
  useEffect(() => {
    let activo = true
    let temporizador: number | null = null

    const sincronizar = () => {
      if (activo) sincronizarContextoPTAR()
    }

    function puedeActualizar(): boolean {
      const datos = usePTARStore.getState()
      return activo && document.visibilityState === 'visible'
        && obtenerContextoPTAR() !== null && !datos.guardando
        && (datos.estadoCarga === 'error' || datos.estadoCarga === 'sin-cuenta')
    }

    const actualizarAlVolver = () => {
      if (!puedeActualizar() || temporizador !== null) return
      // Focus y visibilitychange pueden llegar juntos; agrupamos la consulta.
      temporizador = window.setTimeout(() => {
        temporizador = null
        if (puedeActualizar()) void actualizarDatosPTAR()
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
      cancelarGestionPTAR()
    }
  }, [])

  return null
}
