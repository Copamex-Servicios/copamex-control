import '../components/diseno/administracionVisual.css'
import { PageHeader } from '../components/diseno/Elementos'
import '../components/diseno/consultaVisual.css'
import type { ModuloOperativo } from '../components/operativo/PanelOperativo'
import '../components/diseno/calderasVisual.css'
import { AppLayout } from '../components/diseno/AppLayout'
import { InicioDashboard } from '../components/diseno/InicioDashboard'
import type { AccesoVisual } from '../components/diseno/tipos'
import { lazy, useRef, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import type { RolUsuario } from '../lib/tiposAuth'

const PaginaLimitesCalidad = lazy(() => import('../components/calidad/PaginaLimitesCalidad').then(modulo => ({ default: modulo.PaginaLimitesCalidad })))
const ConsultaCalidad = lazy(() => import('../components/calidad/ConsultaCalidad').then(modulo => ({ default: modulo.ConsultaCalidad })))
const PanelReportes = lazy(() => import('../components/reportes/PanelReportes').then(modulo => ({ default: modulo.PanelReportes })))
const PanelAdministracion = lazy(() => import('../components/administracion/PanelAdministracion').then(modulo => ({ default: modulo.PanelAdministracion })))
const PanelPlanta = lazy(() => import('../components/planta/PanelPlanta').then(modulo => ({ default: modulo.PanelPlanta })))
const PanelOperativo = lazy(() => import('../components/operativo/PanelOperativo').then(modulo => ({ default: modulo.PanelOperativo })))

type VistaInicio = 'inicio' | 'calderas' | 'ptar' | 'planta' | 'administracion' | 'reportes' | 'calidad' | 'gestion' | 'limites'

interface PropsInicio {
  vista?: VistaInicio
}

interface Pagina {
  titulo: string
  ruta: string
  descripcion: string
  roles: readonly RolUsuario[]
}

const nombresRol: Record<RolUsuario, string> = {
  calderas: 'Calderas',
  ptar: 'PTAR',
  admin: 'Administración',
  calidad: 'Calidad',
}

const paginas: Record<Exclude<VistaInicio, 'inicio'>, Pagina> = {
  calidad: { titulo: 'Calidad de agua', ruta: '/calidad', descripcion: 'Consulta de mediciones de ambas áreas.', roles: ['calidad'] },
  gestion: { titulo: 'Avisos y producción', ruta: '/gestion', descripcion: 'Avisos, producción y calendario.', roles: ['calidad'] },
  calderas: {
    titulo: 'Calderas', ruta: '/calderas',
    descripcion: 'Turnos, Bitácora, Pozos, Ultrafiltración y Calidad.',
    roles: ['calderas', 'admin'],
  },
  ptar: {
    titulo: 'PTAR', ruta: '/ptar',
    descripcion: 'Turnos, Bitácora, PTAR y Calidad.',
    roles: ['ptar', 'admin'],
  },
  planta: {
    titulo: 'Planta', ruta: '/planta',
    descripcion: 'Consulta de las áreas de Calderas y PTAR.',
    roles: ['calderas', 'ptar', 'admin'],
  },
  limites: { titulo: 'Calidad de agua', ruta: '/calidad/limites', descripcion: 'Administra los límites de calidad del sistema.', roles: ['admin'] },
  reportes: { titulo: 'Reportes', ruta: '/reportes', descripcion: 'Consumos, balances, Calidad, PTAR y trazabilidad para juntas y revisión.', roles: ['admin'] },
  administracion: {
    titulo: 'Administración', ruta: '/administracion',
    descripcion: 'Operadores, avisos, producción, calendario y catálogos.',
    roles: ['admin'],
  },
}

export function Inicio({ vista = 'inicio' }: PropsInicio = {}) {
  const { sesion, perfil, estado, cerrarSesion } = useAuth()
  const ubicacion = useLocation()
  const [seleccionPTAR, cambiarPTAR] = useState({ clave: ubicacion.key, modulo: 'bitacora' as ModuloOperativo })
  const moduloPTAR = seleccionPTAR.clave === ubicacion.key ? seleccionPTAR.modulo : 'bitacora'
  const setModuloPTAR = (modulo: ModuloOperativo) => cambiarPTAR({ clave: ubicacion.key, modulo })
  const [seleccionCalderas, cambiarCalderas] = useState({ clave: ubicacion.key, modulo: 'bitacora' as ModuloOperativo })
  const moduloCalderas = seleccionCalderas.clave === ubicacion.key ? seleccionCalderas.modulo : 'bitacora'
  const setModuloCalderas = (modulo: ModuloOperativo) => cambiarCalderas({ clave: ubicacion.key, modulo })
  const [error, setError] = useState<string | null>(null)
  const [cerrando, setCerrando] = useState(false)
  const salidaActiva = useRef(false)

  async function salir(): Promise<void> {
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

  // RutaProtegida gestiona la espera y los rechazos; aquí tampoco se muestra contenido sin acceso.
  if (estado !== 'autenticado' || !sesion || !perfil || perfil.activo !== true
    || perfil.id !== sesion.user.id || !['calderas', 'ptar', 'admin', 'calidad'].includes(perfil.rol)) {
    return null
  }

  const pagina = vista === 'inicio' ? null : paginas[vista]
  if (pagina && !pagina.roles.includes(perfil.rol)) {
    return <Navigate to="/sin-acceso" replace state={{ desde: pagina.ruta, motivo: 'rol' }} />
  }
  const accesos = Object.values(paginas).filter((opcion) => opcion.roles.includes(perfil.rol))
  const visuales: AccesoVisual[] = accesos.map(opcion => ({ titulo: opcion.titulo, ruta: opcion.ruta,
    icono: opcion.ruta === '/calidad' || opcion.ruta === '/calidad/limites' ? 'calidad' : opcion.ruta === '/calderas' ? 'calderas' : opcion.ruta === '/ptar' ? 'ptar' : opcion.ruta === '/planta' ? 'planta' : opcion.ruta === '/reportes' ? 'reportes' : 'administracion',
    descripcion: opcion.ruta === '/calidad/limites' ? 'Administra los límites de calidad del sistema.' : opcion.ruta === '/calidad' ? 'Resultados de agua registrados por los operadores.' : opcion.ruta === '/gestion' ? 'Avisos, calendario y programa de producción.' : opcion.ruta === '/calderas' ? 'Turnos, bitácora, pozos, UF y calidad del área.' : opcion.ruta === '/ptar' ? 'Turnos, bitácora, proceso PTAR y calidad del área.' : opcion.ruta === '/planta' ? 'Consulta de Calderas y PTAR en un solo lugar.' : opcion.ruta === '/reportes' ? 'Indicadores, gráficas y exportación a Excel.' : 'Operadores, capturas, avisos y configuración.',
  }))
  if (vista === 'calidad' || vista === 'gestion' || vista === 'limites') return <AppLayout accesos={visuales} nombre={perfil.nombre} rol={nombresRol[perfil.rol]} titulo={pagina?.titulo ?? 'Calidad'} cerrando={cerrando} alSalir={() => { void salir() }}>
    {error && <p className="mensaje-error" role="alert">{error}</p>}
    <div className="co-consulta co-administracion"><PageHeader titulo={vista !== 'gestion' ? 'Calidad de agua' : 'Avisos y producción'} descripcion={vista === 'gestion' ? 'Gestiona avisos, producción y calendario del área.' : undefined} icono={vista !== 'gestion' ? 'calidad' : 'administracion'} />{vista === 'limites' ? <PaginaLimitesCalidad key={perfil.id} /> : vista === 'calidad' ? <ConsultaCalidad key={perfil.id} /> : <PanelAdministracion key={perfil.id} soloGestion />}</div>
  </AppLayout>
  if (vista !== 'administracion') {
    const operativo = vista === 'calderas' || vista === 'ptar'
    const seleccion = vista === 'calderas' ? moduloCalderas : moduloPTAR
    const opciones: { id: ModuloOperativo; nombre: string; icono: AccesoVisual['icono'] }[] = vista === 'calderas'
      ? [{ id: 'bitacora', nombre: 'Bitácora', icono: 'bitacora' }, { id: 'pozos', nombre: 'Pozos', icono: 'pozos' }, { id: 'uf', nombre: 'Ultrafiltración', icono: 'uf' }, { id: 'calidad', nombre: 'Calidad de agua', icono: 'calidad' }]
      : [{ id: 'bitacora', nombre: 'Bitácora', icono: 'bitacora' }, { id: 'ptar', nombre: 'Proceso PTAR', icono: 'ptar' }, { id: 'calidad', nombre: 'Calidad de agua', icono: 'calidad' }]
    return <AppLayout accesos={visuales} nombre={perfil.nombre} rol={nombresRol[perfil.rol]} titulo={pagina?.titulo ?? 'Inicio'} cerrando={cerrando} alSalir={() => { void salir() }} submenu={operativo ? { titulo: vista === 'calderas' ? 'MÓDULO CALDERAS' : 'MÓDULO PTAR', seleccion, opciones, alSeleccionar: id => { if (opciones.some(o => o.id === id)) { if (vista === 'calderas') setModuloCalderas(id as ModuloOperativo); else setModuloPTAR(id as ModuloOperativo) } } } : undefined}>
      {error && <p className="mensaje-error" role="alert">{error}</p>}
      {vista === 'inicio' ? <InicioDashboard accesos={visuales} nombre={perfil.nombre} rol={nombresRol[perfil.rol]} admin={perfil.rol === 'admin'} />
        : operativo ? <div className="co-calderas"><PanelOperativo key={perfil.id + ':' + vista} area={vista} rol={perfil.rol} seleccionExterna={seleccion} alSeleccionar={vista === 'calderas' ? setModuloCalderas : setModuloPTAR} /></div>
        : <div className={vista === 'planta' ? 'co-consulta co-planta-referencia' : 'co-consulta'}><PageHeader titulo={vista === 'planta' ? 'Planta' : 'Reportes'} descripcion={vista === 'planta' ? 'Consulta de registros operativos de Calderas y PTAR.' : undefined} icono={vista === 'planta' ? 'planta' : 'reportes'} />{vista === 'planta' ? <PanelPlanta key={perfil.id} /> : <PanelReportes key={perfil.id} />}</div>}
    </AppLayout>
  }

  return <AppLayout accesos={visuales} nombre={perfil.nombre} rol={nombresRol[perfil.rol]} titulo="Administración" cerrando={cerrando} alSalir={() => { void salir() }}>
    {error && <p className="mensaje-error" role="alert">{error}</p>}
    <div className="co-consulta co-administracion">
      <PageHeader titulo="Administración" descripcion="Gestiona usuarios, catálogos y configuración del sistema." icono="administracion" />
      <PanelAdministracion key={perfil.id} />
    </div>
  </AppLayout>
}
