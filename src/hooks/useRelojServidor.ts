import { useEffect, useState } from 'react'
import { useAuthStore } from '../stores/authStore'
import { supabase } from '../lib/supabase'
import { esFechaOperativa } from '../lib/turnos'

type EstadoReloj = 'cargando' | 'listo' | 'error'

interface VistaReloj {
  cuentaId: string | null
  fecha: string | null
  hora: string | null
  estado: EstadoReloj
}

function cuentaActiva(auth: ReturnType<typeof useAuthStore.getState>): string | null {
  const { estado, sesion, perfil } = auth
  if (estado !== 'autenticado' || !sesion || !perfil || perfil.activo !== true
    || perfil.id !== sesion.user.id || (perfil.rol !== 'calderas' && perfil.rol !== 'ptar')) return null
  return perfil.id
}

export function useRelojServidor(): Omit<VistaReloj, 'cuentaId'> {
  const cuentaId = cuentaActiva(useAuthStore())
  const [vista, setVista] = useState<VistaReloj>({
    cuentaId: null, fecha: null, hora: null, estado: 'cargando',
  })

  useEffect(() => {
    if (!cuentaId) return
    let vigente = true
    let revision = 0
    let control: AbortController | null = null
    let siguiente: number | null = null

    function cancelar(): void {
      revision += 1
      control?.abort()
      control = null
      if (siguiente !== null) window.clearTimeout(siguiente)
      siguiente = null
    }

    async function consultar(): Promise<void> {
      if (!vigente || document.visibilityState !== 'visible' || control !== null
        || cuentaActiva(useAuthStore.getState()) !== cuentaId) return
      if (siguiente !== null) window.clearTimeout(siguiente)
      siguiente = null
      const actual = ++revision
      const peticion = new AbortController()
      control = peticion
      setVista(anterior => anterior.cuentaId === cuentaId && anterior.estado === 'listo'
        ? anterior : { cuentaId, fecha: null, hora: null, estado: 'cargando' })
      let limite: number | null = null
      let alCancelar: (() => void) | null = null
      const espera = new Promise<never>((_resolver, rechazar) => {
        alCancelar = () => rechazar(new Error('Consulta cancelada'))
        peticion.signal.addEventListener('abort', alCancelar, { once: true })
        limite = window.setTimeout(() => {
          rechazar(new Error('Consulta sin respuesta'))
          peticion.abort()
        }, 15000)
      })
      function esActual(): boolean {
        return vigente && actual === revision
          && cuentaActiva(useAuthStore.getState()) === cuentaId
      }
      try {
        const { data, error } = await Promise.race([
          Promise.resolve(supabase.rpc('consultar_reloj_operativo').abortSignal(peticion.signal)),
          espera,
        ])
        if (!esActual()) return
        if (error || !data || typeof data !== 'object' || Array.isArray(data)
          || !esFechaOperativa(data.fecha) || typeof data.hora !== 'string'
          || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(data.hora)) {
          throw new Error('Respuesta de reloj inválida')
        }
        const [anio, mes, dia] = data.fecha.split('-')
        setVista({ cuentaId, fecha: `${dia}/${mes}/${anio}`, hora: data.hora, estado: 'listo' })
      } catch {
        if (esActual()) setVista({ cuentaId, fecha: null, hora: null, estado: 'error' })
      } finally {
        if (limite !== null) window.clearTimeout(limite)
        if (alCancelar) peticion.signal.removeEventListener('abort', alCancelar)
        if (vigente && actual === revision) {
          control = null
          if (document.visibilityState === 'visible'
            && cuentaActiva(useAuthStore.getState()) === cuentaId) {
            siguiente = window.setTimeout(() => { siguiente = null; void consultar() }, 60000)
          }
        }
      }
    }

    function alVolver(): void {
      if (document.visibilityState === 'visible') void consultar()
    }
    function alCambiarVisibilidad(): void {
      if (document.visibilityState === 'visible') {
        alVolver()
      } else {
        cancelar()
      }
    }

    void consultar()
    window.addEventListener('focus', alVolver)
    document.addEventListener('visibilitychange', alCambiarVisibilidad)
    return () => {
      vigente = false
      cancelar()
      window.removeEventListener('focus', alVolver)
      document.removeEventListener('visibilitychange', alCambiarVisibilidad)
    }
  }, [cuentaId])

  if (!cuentaId || vista.cuentaId !== cuentaId) {
    return { fecha: null, hora: null, estado: 'cargando' }
  }
  return { fecha: vista.fecha, hora: vista.hora, estado: vista.estado }
}
