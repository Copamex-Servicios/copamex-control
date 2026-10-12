import { useEffect } from 'react'
import { useAuthStore } from '../../stores/authStore'
import {
  actualizarDatosTurno,
  cancelarGestionTurno,
  obtenerContextoTurno,
  sincronizarContextoTurno,
} from '../../hooks/useTurno'

export function ControlTurno() {
  useEffect(() => {
    let activo = true
    let temporizador: number | null = null

    const sincronizarCuenta = () => {
      if (activo) sincronizarContextoTurno()
    }

    const actualizarAlVolver = () => {
      if (!activo || document.visibilityState !== 'visible'
        || !obtenerContextoTurno() || temporizador !== null) return

      // Focus y visibilitychange pueden llegar juntos; hacemos una sola consulta.
      temporizador = window.setTimeout(() => {
        temporizador = null
        if (!activo || document.visibilityState !== 'visible' || !obtenerContextoTurno()) return
        void actualizarDatosTurno(true)
      }, 0)
    }

    const desuscribir = useAuthStore.subscribe(sincronizarCuenta)
    sincronizarCuenta()
    window.addEventListener('focus', actualizarAlVolver)
    document.addEventListener('visibilitychange', actualizarAlVolver)

    return () => {
      activo = false
      desuscribir()
      window.removeEventListener('focus', actualizarAlVolver)
      document.removeEventListener('visibilitychange', actualizarAlVolver)
      if (temporizador !== null) window.clearTimeout(temporizador)
      cancelarGestionTurno()
    }
  }, [])

  return null
}
