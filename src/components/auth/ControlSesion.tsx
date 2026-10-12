import { useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import {
  cancelarComprobacion,
  comprobarAcceso,
} from '../../lib/autenticacion'
import { useAuthStore } from '../../stores/authStore'

export function ControlSesion() {
  useEffect(() => {
    let activo = true
    let temporizador: number | null = null

    function programarComprobacion(): void {
      if (!activo) return

      cancelarComprobacion()
      if (temporizador !== null) window.clearTimeout(temporizador)

      // Consultar la sesión fuera del callback de Auth y descartar respuestas anteriores.
      temporizador = window.setTimeout(() => {
        temporizador = null
        if (activo) void comprobarAcceso(true)
      }, 0)
    }

    function revisarAlVolver(): void {
      if (document.visibilityState !== 'visible') return
      if (!useAuthStore.getState().sesion) return
      programarComprobacion()
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      // Los avisos de otras pestañas también requieren consultar nuestra sesión real.
      programarComprobacion()
    })

    window.addEventListener('focus', revisarAlVolver)
    document.addEventListener('visibilitychange', revisarAlVolver)
    programarComprobacion()

    return () => {
      activo = false
      subscription.unsubscribe()
      window.removeEventListener('focus', revisarAlVolver)
      document.removeEventListener('visibilitychange', revisarAlVolver)
      if (temporizador !== null) window.clearTimeout(temporizador)
      cancelarComprobacion()
    }
  }, [])

  return null
}
