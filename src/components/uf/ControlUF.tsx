import { useEffect } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { useTurnoStore } from '../../stores/turnoStore'
import { useUFStore } from '../../stores/ufStore'
import {
  actualizarDatosUF,
  cancelarGestionUF,
  obtenerContextoUF,
  sincronizarContextoUF,
} from '../../hooks/useUF'

// Montar una sola vez en App, fuera de las rutas.
// Al navegar se conserva la solicitud pendiente de la cuenta actual.
export function ControlUF() {
  useEffect(() => {
    let activo = true
    let temporizador: number | null = null

    const sincronizar = () => {
      if (activo) sincronizarContextoUF()
    }

    function puedeActualizar(): boolean {
      const datos = useUFStore.getState()
      return activo && document.visibilityState === 'visible'
        && obtenerContextoUF() !== null && !datos.guardando
        && datos.estadoCarga !== 'cargando'
    }

    const actualizarAlVolver = () => {
      if (!puedeActualizar() || temporizador !== null) return
      // Focus y visibilitychange pueden llegar juntos; agrupamos la consulta.
      temporizador = window.setTimeout(() => {
        temporizador = null
        if (puedeActualizar()) void actualizarDatosUF()
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
      cancelarGestionUF()
    }
  }, [])

  return null
}
