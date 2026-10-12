import { supabase } from '../lib/supabase'
import { configurarMantenerSesion } from '../lib/almacenamientoSesion'
import {
  cancelarComprobacion,
  comprobarAcceso,
  invalidarAcceso,
} from '../lib/autenticacion'
import { useAuthStore } from '../stores/authStore'

async function iniciarSesion(
  correo: string,
  contrasena: string,
  mantener: boolean,
): Promise<void> {
  try {
    configurarMantenerSesion(mantener)
  } catch {
    throw new Error('No se pudo preparar la sesión. Permite el almacenamiento del sitio en tu navegador.')
  }

  cancelarComprobacion()
  const respuesta = await supabase.auth.signInWithPassword({
    email: correo.trim(),
    password: contrasena,
  }).catch(() => null)

  if (!respuesta) {
    throw new Error('No se pudo iniciar sesión. Revisa tu conexión e intenta de nuevo.')
  }

  if (respuesta.error) {
    const codigo = respuesta.error.code
    if (codigo === 'invalid_credentials') {
      throw new Error('El correo o la contraseña son incorrectos.')
    }
    if (codigo === 'email_not_confirmed') {
      throw new Error('Este correo todavía no está confirmado. Contacta al administrador.')
    }
    if (codigo === 'over_request_rate_limit') {
      throw new Error('Hubo demasiados intentos. Espera unos minutos e intenta de nuevo.')
    }
    throw new Error('No se pudo iniciar sesión. Revisa tu conexión e intenta de nuevo.')
  }

  if (!respuesta.data.session) {
    throw new Error('No se recibió una sesión válida. Intenta de nuevo.')
  }

  // ControlSesion comprobará el perfil cuando Supabase avise del inicio de sesión.
}

async function cerrarSesion(): Promise<void> {
  cancelarComprobacion()
  const respuesta = await supabase.auth.signOut({ scope: 'local' }).catch(() => null)

  if (!respuesta || respuesta.error) {
    throw new Error('No se pudo cerrar sesión. Revisa tu conexión e intenta de nuevo.')
  }

  invalidarAcceso()
  useAuthStore.getState().establecerEstado({
    sesion: null,
    perfil: null,
    estado: 'sin-sesion',
    mensaje: null,
  })
}

async function reintentarAcceso(): Promise<void> {
  await comprobarAcceso()
}

export function useAuth() {
  const { sesion, perfil, estado, mensaje } = useAuthStore()
  return {
    sesion,
    perfil,
    estado,
    mensaje,
    iniciarSesion,
    cerrarSesion,
    reintentarAcceso,
  }
}
