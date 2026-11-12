import { useEffect } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { useTurnoStore } from '../../stores/turnoStore'
import { finProgramadoTurno } from '../../lib/horarioTurno'
import {
  actualizarDatosTurno,
  cancelarGestionTurno,
  obtenerContextoTurno,
  sincronizarContextoTurno,
} from '../../hooks/useTurno'

export function ControlTurno() {
  const turno = useTurnoStore(datos => datos.turno)
  const accionEnCurso = useTurnoStore(datos => datos.accionEnCurso)
  const turnoId = turno?.id
  const finProgramado = turno ? finProgramadoTurno(turno) : null
  const finalizadoEn = turno?.finalizado_en

  useEffect(() => {
    if (!turnoId || finalizadoEn !== null || finProgramado === null || accionEnCurso) return
    let activo = true
    let siguiente: number | null = null
    async function comprobarCierre() {
      if (!activo || !obtenerContextoTurno()) return
      await actualizarDatosTurno(true)
      const actual = useTurnoStore.getState()
      // Cron puede estar terminando su ejecución; volver a leer sin simular un cierre.
      if (activo && actual.turno && actual.turno.id === turnoId && actual.turno.finalizado_en === null) {
        siguiente = window.setTimeout(() => { void comprobarCierre() }, 60000)
      }
    }
    siguiente = window.setTimeout(() => { void comprobarCierre() },
      Math.min(2147483647, Math.max(1500, finProgramado - Date.now() + 1500)))
    return () => { activo = false; if (siguiente !== null) window.clearTimeout(siguiente) }
  }, [turnoId, finProgramado, finalizadoEn, accionEnCurso])

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
