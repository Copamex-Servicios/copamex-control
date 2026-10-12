import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { useAuthStore } from '../stores/authStore'
import type { EstadoAuth, Perfil } from './tiposAuth'

let revision = 0
let consultaActiva: AbortController | null = null

export function cancelarComprobacion(): void {
  revision += 1
  consultaActiva?.abort()
  consultaActiva = null
}

export function invalidarAcceso(): void {
  cancelarComprobacion()
  useAuthStore.getState().establecerEstado({
    sesion: null,
    perfil: null,
    estado: 'cargando',
    mensaje: null,
  })
}

function esPerfilValido(datos: unknown, usuarioId: string): datos is Perfil {
  if (!datos || typeof datos !== 'object') return false

  const perfil = datos as Record<string, unknown>
  return perfil.id === usuarioId
    && typeof perfil.nombre === 'string'
    && perfil.nombre.trim().length > 0
    && typeof perfil.activo === 'boolean'
    && (perfil.rol === 'calderas' || perfil.rol === 'ptar' || perfil.rol === 'admin' || perfil.rol === 'calidad')
}

// Ejecutar fuera del callback de onAuthStateChange.
export async function comprobarAcceso(conservarVista = false): Promise<void> {
  cancelarComprobacion()
  const version = revision
  const controlador = new AbortController()
  consultaActiva = controlador

  const anterior = useAuthStore.getState()
  const conservar = conservarVista && anterior.estado === 'autenticado'
    && anterior.sesion !== null && anterior.perfil?.activo === true
  let sesion: Session | null = null

  function establecer(
    estado: EstadoAuth,
    perfil: Perfil | null = null,
    mensaje: string | null = null,
  ): void {
    if (version !== revision) return
    useAuthStore.getState().establecerEstado({ sesion, perfil, estado, mensaje })
  }

  if (!conservar) establecer('cargando')

  const espera = setTimeout(() => {
    if (version !== revision) return
    cancelarComprobacion()
    useAuthStore.getState().establecerEstado({
      sesion,
      perfil: null,
      estado: 'error',
      mensaje: 'La comprobación tardó demasiado. Revisa tu conexión e intenta de nuevo.',
    })
  }, 15000)

  try {
    const { data, error } = await supabase.auth.getSession()
    if (version !== revision) return
    if (error) throw error

    sesion = data.session
    if (!sesion) {
      establecer('sin-sesion')
      return
    }

    if (!conservar || sesion.user.id !== anterior.sesion?.user.id) {
      establecer('cargando')
    }

    const { data: perfil, error: errorPerfil } = await supabase
      .from('perfiles')
      .select('id, nombre, rol, activo')
      .eq('id', sesion.user.id)
      .abortSignal(controlador.signal)
      .maybeSingle()

    if (version !== revision) return
    if (errorPerfil) throw errorPerfil

    if (!perfil) {
      establecer('sin-perfil', null, 'Esta cuenta todavía no tiene un perfil asignado.')
      return
    }

    if (!esPerfilValido(perfil, sesion.user.id)) {
      establecer('error', null, 'El perfil necesita revisión. Contacta al administrador.')
      return
    }

    if (!perfil.activo) {
      establecer('inactivo', null, 'Esta cuenta está desactivada. Contacta al administrador.')
      return
    }

    establecer('autenticado', perfil)
  } catch {
    establecer('error', null, 'No se pudo comprobar tu acceso. Revisa tu conexión e intenta de nuevo.')
  } finally {
    clearTimeout(espera)
    if (version === revision) consultaActiva = null
  }
}
