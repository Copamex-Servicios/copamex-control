import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import type { RolUsuario } from '../../lib/tiposAuth'

interface PropsRutaProtegida {
  roles?: readonly RolUsuario[]
}

export function RutaProtegida({ roles }: PropsRutaProtegida) {
  const { sesion, perfil, estado } = useAuth()
  const ubicacion = useLocation()
  const desde = ubicacion.pathname + ubicacion.search + ubicacion.hash

  if (estado === 'cargando') {
    return (
      <main className="pantalla-acceso">
        <section className="tarjeta-acceso" role="status" aria-live="polite">
          <p>Comprobando acceso…</p>
        </section>
      </main>
    )
  }

  if (estado === 'sin-sesion') {
    return <Navigate to="/login" replace state={{ desde }} />
  }

  if (
    estado !== 'autenticado'
    || !sesion
    || !perfil
    || perfil.activo !== true
    || perfil.id !== sesion.user.id
    || !['calderas', 'ptar', 'admin', 'calidad'].includes(perfil.rol)
  ) {
    return <Navigate to="/sin-acceso" replace state={{ desde, motivo: 'cuenta' }} />
  }

  if (roles && !roles.includes(perfil.rol)) {
    return <Navigate to="/sin-acceso" replace state={{ desde, motivo: 'rol' }} />
  }

  return <Outlet />
}



