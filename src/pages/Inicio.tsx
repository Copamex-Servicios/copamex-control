import '../components/diseno/administracionVisual.css'
import { PageHeader } from '../components/diseno/Elementos'
import '../components/diseno/consultaVisual.css'
import type { ModuloOperativo } from '../components/operativo/PanelOperativo'
import '../components/diseno/calderasVisual.css'
import { AppLayout } from '../components/diseno/AppLayout'
import { InicioDashboard } from '../components/diseno/InicioDashboard'
import type { AccesoVisual } from '../components/diseno/tipos'
import { lazy, Suspense, useRef, useState, type ReactNode } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import type { RolUsuario } from '../lib/tiposAuth'

const PaginaLimitesCalidad = lazy(() => import('../components/calidad/PaginaLimitesCalidad').then(modulo => ({ default: modulo.PaginaLimitesCalidad })))
const ConsultaCalidad = lazy(() => import('../components/calidad/ConsultaCalidad').then(modulo => ({ default: modulo.ConsultaCalidad })))
const PanelReportes = lazy(() => import('../components/reportes/PanelReportes').then(modulo => ({ default: modulo.PanelReportes })))
const PanelAdministracion = lazy(() => import('../components/administracion/PanelAdministracion').then(modulo => ({ default: modulo.PanelAdministracion })))
const PanelPlanta = lazy(() => import('../components/planta/PanelPlanta').then(modulo => ({ default: modulo.PanelPlanta })))
const PanelOperativo = lazy(() => import('../components/operativo/PanelOperativo').then(modulo => ({ default: modulo.PanelOperativo })))
const PanelBitacoraAdministrativa = lazy(() => import('../components/bitacoraAdministrativa/BitacoraAdministrativa').then(m => ({ default: m.PanelBitacoraAdministrativa })))
const NovedadesAdministracion = lazy(() => import('../components/bitacoraAdministrativa/BitacoraAdministrativa').then(m => ({ default: m.NovedadesAdministracion })))

type VistaInicio = 'inicio' | 'calderas' | 'ptar' | 'planta' | 'administracion' | 'reportes' | 'calidad' | 'gestion' | 'limites' | 'novedades' | 'bitacora_admin'

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
  bitacora_admin: { titulo: 'Bit\u00e1cora', ruta: '/bitacora-administrativa', descripcion: 'Actividades de Administraci\u00f3n por \u00e1rea e historial mensual.', roles: ['admin'] },
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
  novedades: { titulo: 'Novedades', ruta: '/novedades', descripcion: 'Consulta mensual de actividades de Administración.', roles: ['calderas', 'ptar'] },
}

// Limpiar las vistas conservadas al cambiar de cuenta, rol o acceso.
export function Inicio(props: PropsInicio = {}) {
  const { perfil, estado, sesion } = useAuth()
  if (estado !== 'autenticado' || !perfil?.activo || perfil.id !== sesion?.user.id) return null
  return <ContenidoInicio key={perfil.id + ':' + perfil.rol} {...props} />
}
function VistaConservada({ activa, children }: { activa: boolean; children: ReactNode }) {
  const [visitada, setVisitada] = useState(activa)
  if (activa && !visitada) setVisitada(true)
  if (!activa && !visitada) return null
  return <div hidden={!activa} style={{ display: activa ? 'contents' : 'none' }}><Suspense fallback={<p role="status">Cargando módulo…</p>}>{children}</Suspense></div>
}
function ContenidoInicio({ vista = 'inicio' }: PropsInicio = {}) {
  const { sesion, perfil, estado, cerrarSesion } = useAuth()
  const navigate = useNavigate()
  const [seleccionPTAR, cambiarPTAR] = useState({ modulo: 'bitacora' as ModuloOperativo, revision: 0 })
  const moduloPTAR = seleccionPTAR.modulo
  const setModuloPTAR = (modulo: ModuloOperativo) => cambiarPTAR(anterior => ({ modulo, revision: anterior.revision + 1 }))
  const [seleccionCalderas, cambiarCalderas] = useState({ modulo: 'bitacora' as ModuloOperativo, revision: 0 })
  const moduloCalderas = seleccionCalderas.modulo
  const setModuloCalderas = (modulo: ModuloOperativo) => cambiarCalderas(anterior => ({ modulo, revision: anterior.revision + 1 }))
  const abrirBitacoraArea = (ruta: string) => {
    if (ruta === '/calderas' || (ruta === '/' && perfil?.rol === 'calderas')) setModuloCalderas('bitacora')
    if (ruta === '/ptar' || (ruta === '/' && perfil?.rol === 'ptar')) setModuloPTAR('bitacora')
  }
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
  const accesos = Object.values(paginas).filter((opcion) => opcion.roles.includes(perfil.rol)
    && (perfil.rol !== 'admin' || !['/calderas', '/ptar', '/planta', '/reportes'].includes(opcion.ruta)))
  const visuales: AccesoVisual[] = accesos.map(opcion => ({ titulo: opcion.titulo, ruta: opcion.ruta,
    icono: opcion.ruta === '/bitacora-administrativa' ? 'bitacora' : opcion.ruta === '/calidad' || opcion.ruta === '/calidad/limites' ? 'calidad' : opcion.ruta === '/calderas' ? 'calderas' : opcion.ruta === '/ptar' ? 'ptar' : opcion.ruta === '/planta' ? 'planta' : opcion.ruta === '/reportes' ? 'reportes' : 'administracion',
    descripcion: opcion.ruta === '/bitacora-administrativa' ? opcion.descripcion : opcion.ruta === '/calidad/limites' ? 'Administra los límites de calidad del sistema.' : opcion.ruta === '/calidad' ? 'Resultados de agua registrados por los operadores.' : opcion.ruta === '/gestion' ? 'Avisos, calendario y programa de producción.' : opcion.ruta === '/calderas' ? 'Turnos, bitácora, pozos, UF y calidad del área.' : opcion.ruta === '/ptar' ? 'Turnos, bitácora, proceso PTAR y calidad del área.' : opcion.ruta === '/planta' ? 'Consulta de Calderas y PTAR en un solo lugar.' : opcion.ruta === '/reportes' ? 'Indicadores, gráficas y exportación a Excel.' : 'Operadores, capturas, avisos y configuración.',
  }))
  if (vista === 'calidad' || vista === 'gestion' || vista === 'limites') return <AppLayout accesos={visuales} nombre={perfil.nombre} rol={nombresRol[perfil.rol]} titulo={pagina?.titulo ?? 'Calidad'} cerrando={cerrando} alSalir={() => { void salir() }}>
    {error && <p className="mensaje-error" role="alert">{error}</p>}
    <div className="co-consulta co-administracion">{perfil.rol !== 'admin' && vista !== 'gestion' && <PageHeader titulo="Calidad de agua" icono="calidad" />}{vista === 'limites' ? <PaginaLimitesCalidad key={perfil.id} /> : vista === 'calidad' ? <ConsultaCalidad key={perfil.id} /> : <PanelAdministracion key={perfil.id} soloGestion />}</div>
  </AppLayout>
  if (vista !== 'administracion') {
    const operativo = vista === 'calderas' || vista === 'ptar'
    const menuCalderas = vista === 'calderas' || perfil.rol === 'calderas' && (vista === 'inicio' || vista === 'planta' || vista === 'novedades')
    const seleccion = vista === 'calderas' ? moduloCalderas : moduloPTAR
    const opciones: { id: ModuloOperativo; nombre: string; icono: AccesoVisual['icono'] }[] = menuCalderas
      ? [{ id: 'bitacora', nombre: 'Bitácora', icono: 'bitacora' }, { id: 'pozos', nombre: 'Pozos', icono: 'pozos' }, { id: 'uf', nombre: 'Ultrafiltración', icono: 'uf' }, { id: 'calidad', nombre: 'Calidad de agua', icono: 'calidad' }]
      : [{ id: 'bitacora', nombre: 'Bitácora', icono: 'bitacora' }, { id: 'ptar', nombre: 'Proceso PTAR', icono: 'ptar' }, { id: 'calidad', nombre: 'Calidad de agua', icono: 'calidad' }]
    const opcionesVisibles = opciones.filter(opcion => perfil.rol !== 'ptar' || (opcion.id !== 'ptar' && opcion.id !== 'calidad'))
    return <AppLayout accesos={visuales} nombre={perfil.nombre} rol={nombresRol[perfil.rol]} titulo={pagina?.titulo ?? 'Inicio'} cerrando={cerrando} alSalir={() => { void salir() }} alAbrirBitacora={() => abrirBitacoraArea(perfil.rol === 'calderas' ? '/calderas' : '/ptar')} submenu={operativo || menuCalderas ? {
      titulo: menuCalderas ? 'MÓDULO CALDERAS' : 'MÓDULO PTAR',
      seleccion: operativo ? seleccion : '',
      opciones: opcionesVisibles,
      alSeleccionar: id => {
        if (!opcionesVisibles.some(opcion => opcion.id === id)) return
        if (menuCalderas) {
          setModuloCalderas(id as ModuloOperativo)
          if (vista !== 'calderas') navigate('/calderas')
        } else setModuloPTAR(id as ModuloOperativo)
      },
    } : undefined}>
      {error && <p className="mensaje-error" role="alert">{error}</p>}
      <VistaConservada activa={vista === 'inicio'}><InicioDashboard accesos={visuales} nombre={perfil.nombre} rol={nombresRol[perfil.rol]} admin={perfil.rol === 'admin'} alAbrirArea={abrirBitacoraArea} /></VistaConservada>
      {vista === 'novedades' && <NovedadesAdministracion key={perfil.id} />}
      {perfil.rol === 'admin' && <VistaConservada activa={vista === 'bitacora_admin'}><div className="co-consulta co-administracion"><PanelBitacoraAdministrativa key={perfil.id} /></div></VistaConservada>}
      {(['calderas', 'ptar'] as const).filter(area => paginas[area].roles.includes(perfil.rol)).map(area => <VistaConservada key={area} activa={vista === area}>
        <div className="co-calderas"><PanelOperativo key={perfil.id + ':' + area} area={area} rol={perfil.rol}
          seleccionExterna={area === 'calderas' ? moduloCalderas : moduloPTAR}
          solicitudDesplazamiento={area === 'calderas' ? seleccionCalderas.revision : seleccionPTAR.revision}
          alSeleccionar={area === 'calderas' ? setModuloCalderas : setModuloPTAR} /></div>
      </VistaConservada>)}
      {paginas.planta.roles.includes(perfil.rol) && <VistaConservada activa={vista === 'planta'}><div className="co-consulta co-planta-referencia">{perfil.rol === 'admin' && <PageHeader titulo="Planta" descripcion="Consulta de registros operativos de Calderas y PTAR." icono="planta" />}<PanelPlanta key={perfil.id} /></div></VistaConservada>}
      {vista === 'reportes' && <div className="co-consulta"><PageHeader titulo="Reportes" icono="reportes" /><PanelReportes key={perfil.id} /></div>}

    </AppLayout>
  }

  return <AppLayout accesos={visuales} nombre={perfil.nombre} rol={nombresRol[perfil.rol]} titulo="Administración" cerrando={cerrando} alSalir={() => { void salir() }}>
    {error && <p className="mensaje-error" role="alert">{error}</p>}
    <div className="co-consulta co-administracion">
      <PanelAdministracion key={perfil.id} />
    </div>
  </AppLayout>
}
