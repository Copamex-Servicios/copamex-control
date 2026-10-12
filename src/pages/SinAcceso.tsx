import { AccesoLayout } from '../components/diseno/AccesoLayout'
import { useRef, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

function obtenerDestino(datos: unknown): string {
  if (!datos || typeof datos !== 'object') return '/'
  const desde = (datos as Record<string, unknown>).desde
  if (typeof desde !== 'string' || !desde.startsWith('/') || desde.startsWith('//')) return '/'
  if (desde.includes('\\')) return '/'

  try {
    const ruta = new URL(desde, window.location.origin)
    if (ruta.origin !== window.location.origin) return '/'
    if (ruta.pathname === '/login' || ruta.pathname === '/sin-acceso') return '/'
    return ruta.pathname + ruta.search + ruta.hash
  } catch {
    return '/'
  }
}

export function SinAcceso() {
  const { sesion, perfil, estado, mensaje, cerrarSesion, reintentarAcceso } = useAuth()
  const ubicacion = useLocation()
  const destino = obtenerDestino(ubicacion.state)
  const datosRuta: unknown = ubicacion.state
  const motivo = datosRuta && typeof datosRuta === 'object'
    ? (datosRuta as Record<string, unknown>).motivo
    : undefined
  const [error, setError] = useState<string | null>(null)
  const [cerrando, setCerrando] = useState(false)
  const salidaActiva = useRef(false)

  const accesoValido = estado === 'autenticado' && sesion !== null
    && perfil !== null && perfil.activo === true
    && perfil.id === sesion.user.id
    && ['calderas', 'ptar', 'admin', 'calidad'].includes(perfil.rol)
  const restriccionRol = accesoValido && motivo === 'rol'

  function reintentar(): void {
    if (salidaActiva.current) return
    setError(null)
    // El estado compartido controla la espera y permite otro intento si vence el plazo.
    void reintentarAcceso().catch(() => {
      setError('No se pudo volver a comprobar el acceso. Intenta de nuevo.')
    })
  }

  async function cambiarCuenta(): Promise<void> {
    if (salidaActiva.current) return
    salidaActiva.current = true
    setCerrando(true)
    setError(null)
    try {
      await cerrarSesion()
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : 'No se pudo cerrar sesión. Intenta de nuevo.')
    } finally {
      salidaActiva.current = false
      setCerrando(false)
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

  if (estado === 'sin-sesion') {
    return <Navigate to="/login" replace state={{ desde: destino }} />
  }

  if (accesoValido && !restriccionRol) {
    return <Navigate to={destino} replace />
  }

  const titulo = restriccionRol ? 'Acceso restringido'
    : estado === 'sin-perfil' ? 'Cuenta sin perfil'
    : estado === 'inactivo' ? 'Cuenta desactivada'
    : 'No se pudo comprobar el acceso'
  const detalle = restriccionRol
    ? 'Esta cuenta no tiene permiso para abrir la página solicitada.'
    : mensaje ?? 'Revisa tu conexión o contacta al administrador para revisar tu cuenta.'

  return (
    <AccesoLayout>
      <section className="tarjeta-acceso" aria-labelledby="titulo-sin-acceso">
        <h1 id="titulo-sin-acceso">{titulo}</h1>
        <p className="texto-secundario" role="status">{detalle}</p>
        {restriccionRol && perfil && <p>Cuenta: <strong>{perfil.nombre}</strong></p>}

        {error && <p className="mensaje-error" role="alert">{error}</p>}

        <div className="acciones-acceso" aria-busy={cerrando}>
          {restriccionRol ? (
            !cerrando && <Link className="boton-primario" to="/">Volver al inicio</Link>
          ) : (
            <button className="boton-primario" type="button" onClick={reintentar} disabled={cerrando}>
              Reintentar
            </button>
          )}
          <button className="boton-secundario" type="button" onClick={cambiarCuenta} disabled={cerrando}>
            {cerrando ? 'Cerrando sesión…' : 'Cambiar de cuenta'}
          </button>
        </div>
      </section>
    </AccesoLayout>
  )
}
