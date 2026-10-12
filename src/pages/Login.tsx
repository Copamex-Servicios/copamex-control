import { AccesoLayout } from '../components/diseno/AccesoLayout'
import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { RolUsuario } from '../lib/tiposAuth'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { obtenerMantenerSesion } from '../lib/almacenamientoSesion'

const rutasPorRol: Record<RolUsuario, readonly string[]> = {
  calidad: ['/', '/calidad', '/gestion'],
  calderas: ['/', '/planta', '/calderas'],
  ptar: ['/', '/planta', '/ptar'],
  admin: ['/', '/planta', '/calderas', '/ptar', '/administracion'],
}

function obtenerDestino(datos: unknown, rol?: RolUsuario): string {
  if (!datos || typeof datos !== 'object') return '/'
  const desde = (datos as Record<string, unknown>).desde
  if (typeof desde !== 'string' || !desde.startsWith('/') || desde.startsWith('//')) return '/'
  if (desde.includes('\\')) return '/'

  try {
    const ruta = new URL(desde, window.location.origin)
    if (ruta.origin !== window.location.origin) return '/'
    if (ruta.pathname === '/login' || ruta.pathname === '/sin-acceso') return '/'
    if (rol) {
      const pagina = decodeURIComponent(ruta.pathname).replace(/\/+$/, '').toLowerCase() || '/'
      // La ruta recordada puede pertenecer a la cuenta que acaba de salir.
      if (!rutasPorRol[rol].includes(pagina)) return '/'
    }
    return ruta.pathname + ruta.search + ruta.hash
  } catch {
    return '/'
  }
}

export function Login() {
  const { sesion, perfil, estado, iniciarSesion } = useAuth()
  const ubicacion = useLocation()
  const destino = obtenerDestino(ubicacion.state)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [mantener, setMantener] = useState(() => {
    try {
      return obtenerMantenerSesion()
    } catch {
      return false
    }
  })
  const [mostrarContrasena, setMostrarContrasena] = useState(false)
  const solicitudActiva = useRef(false)

  async function enviar(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault()
    if (solicitudActiva.current) return

    // Leer los campos del formulario también permite recibir el autocompletado.
    const datos = new FormData(evento.currentTarget)
    const correo = datos.get('email')
    const contrasena = datos.get('password')
    if (typeof correo !== 'string' || !correo.trim()
      || typeof contrasena !== 'string' || !contrasena) {
      setError('Escribe tu correo y tu contraseña.')
      return
    }

    solicitudActiva.current = true
    setEnviando(true)
    setError(null)
    try {
      await iniciarSesion(correo, contrasena, mantener)
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : 'No se pudo iniciar sesión. Intenta de nuevo.')
    } finally {
      solicitudActiva.current = false
      setEnviando(false)
    }
  }

  if (estado === 'cargando') {
    return (
      <AccesoLayout>
        <section className="tarjeta-acceso" role="status" aria-live="polite">
          <p>Comprobando acceso…</p>
        </section>
      </AccesoLayout>
    )
  }

  if (estado === 'autenticado' && sesion && perfil?.activo === true
    && perfil.id === sesion.user.id && ['calderas', 'ptar', 'admin', 'calidad'].includes(perfil.rol)) {
    return <Navigate to={obtenerDestino(ubicacion.state, perfil.rol)} replace />
  }

  if (estado !== 'sin-sesion') {
    return <Navigate to="/sin-acceso" replace state={{ desde: destino, motivo: 'cuenta' }} />
  }

  return (
    <AccesoLayout>
      <section className="tarjeta-acceso" aria-labelledby="titulo-login">
        <header className="encabezado-acceso">
          <h1 id="titulo-login">Iniciar sesión</h1>
        </header>

        <form className="formulario-acceso" onSubmit={enviar} autoComplete="on"
          aria-busy={enviando} aria-describedby={error ? 'error-login' : undefined}>
          <fieldset className="campos-acceso" disabled={enviando}>
            <label htmlFor="correo">Correo electrónico</label>
            <input id="correo" name="email" type="email" autoComplete="username"
              autoCapitalize="none" autoCorrect="off" spellCheck={false} required />

            <label htmlFor="contrasena">Contraseña</label>
            <div className="campo-contrasena">
              <input id="contrasena" name="password"
                type={mostrarContrasena ? 'text' : 'password'}
                autoComplete="current-password" required />
              <button className="boton-texto" type="button"
                aria-controls="contrasena" aria-pressed={mostrarContrasena}
                onClick={() => setMostrarContrasena(!mostrarContrasena)}>
                {mostrarContrasena ? 'Ocultar' : 'Mostrar'} contraseña
              </button>
            </div>

            <label className="opcion-sesion">
              <input type="checkbox" name="mantener" checked={mantener}
                onChange={(evento) => setMantener(evento.target.checked)} />
              <span>Mantener sesión iniciada</span>
            </label>
          </fieldset>

          {error && <p className="mensaje-error" id="error-login" role="alert">{error}</p>}

          <button className="boton-primario" type="submit" disabled={enviando}>
            {enviando ? 'Iniciando sesión…' : 'Entrar'}
          </button>
        </form>
      </section>
    </AccesoLayout>
  )
}
