import { Button } from './Elementos'
import './cuentaLateral.css'
import './logoSidebar.css'
import { useEffect, useId, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Icono } from './Icono'
import type { AccesoVisual, SubmenuVisual } from './tipos'
import './menuDesplegable.css'
import './sidebarCompacto.css'

export function Sidebar({ accesos, alNavegar, submenu, nombre, rol, cerrando, alSalir }: { accesos: readonly AccesoVisual[]; alNavegar?: () => void; submenu?: SubmenuVisual; nombre: string; rol: string; cerrando: boolean; alSalir: () => void }) {
  const { pathname, key: claveUbicacion } = useLocation()
  const [despliegue, setDespliegue] = useState({ clave: '', cerrado: false })
  const cerrado = despliegue.clave === claveUbicacion && despliegue.cerrado
  const id = useId()
  return <div className="co-sidebar-content co-sidebar-compacta">
    <div className="co-brand co-brand-logo"><img src={`${import.meta.env.BASE_URL}cpx.png`} alt="CPX" width="108" height="108" /><span>CONTROL OPERATIVO</span></div>
    <p className="co-nav-label">NAVEGACIÓN PRINCIPAL</p>
    <nav className="co-nav" aria-label="Navegación principal">
      <NavLink to="/" end aria-label="Inicio" title="Inicio" onClick={alNavegar}><Icono nombre="inicio" /><span>Inicio</span></NavLink>
      {accesos.map(a => {
        const tieneApartados = a.ruta === '/calderas' || a.ruta === '/ptar'
        const abierto = tieneApartados && a.ruta === pathname && !!submenu && !cerrado
        return <div className="co-nav-group" key={a.ruta}>
          <NavLink to={a.ruta} aria-label={a.titulo} title={a.titulo} aria-expanded={tieneApartados ? abierto : undefined} aria-controls={tieneApartados ? id + '-' + a.icono : undefined} onClick={e => { if (tieneApartados && a.ruta === pathname && submenu && e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) { e.preventDefault(); setDespliegue({ clave: claveUbicacion, cerrado: !cerrado }); return } alNavegar?.() }}>
            <Icono nombre={a.icono} /><span>{a.titulo}</span>
            {tieneApartados && <svg className={`co-nav-chevron${abierto ? ' co-nav-chevron-open' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>}
          </NavLink>
          {tieneApartados && <SubmenuLateral id={id + '-' + a.icono} abierto={abierto} submenu={a.ruta === pathname ? submenu : undefined} alNavegar={alNavegar} />}
        </div>
      })}
    </nav>
    <div className="co-sidebar-account">
      <div className="co-sidebar-user"><span className="co-avatar" aria-hidden="true"><Icono nombre="cuenta" /></span><div><strong>{nombre}</strong><span>{rol}</span></div>
        <Button className="co-sidebar-logout" aria-label={cerrando ? 'Cerrando sesión' : 'Cerrar sesión'} title={cerrando ? 'Cerrando sesión' : 'Cerrar sesión'} disabled={cerrando} onClick={alSalir}><Icono nombre="salir" /></Button>
      </div>
    </div>
  </div>
}


// Conservar las opciones durante el cierre permite animar la altura real.
function SubmenuLateral({ id, abierto, submenu, alNavegar }: { id: string; abierto: boolean; submenu?: SubmenuVisual; alNavegar?: () => void }) {
  const contenedor = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const elemento = contenedor.current
    if (!elemento) return
    let segundo = 0
    if (!abierto) {
      elemento.classList.remove('co-submenu-transition-open')
      return
    }
    const primero = requestAnimationFrame(() => {
      segundo = requestAnimationFrame(() => elemento.classList.add('co-submenu-transition-open'))
    })
    return () => { cancelAnimationFrame(primero); cancelAnimationFrame(segundo) }
  }, [abierto])
  const [contenido, setContenido] = useState(submenu)
  if (submenu && submenu !== contenido) setContenido(submenu)
  const visible = submenu ?? contenido
  return <div id={id} ref={contenedor} className="co-submenu-transition" aria-hidden={!abierto} inert={!abierto}>
    <div className="co-submenu-clip">
      {visible && <div className="co-submenu co-nested-submenu" role="group" aria-label={visible.titulo}>
        {visible.opciones.map(opcion => <button type="button" key={opcion.id} aria-label={opcion.nombre} title={opcion.nombre} aria-pressed={visible.seleccion === opcion.id} onClick={() => { if (abierto && submenu) { submenu.alSeleccionar(opcion.id); alNavegar?.() } }}><Icono nombre={opcion.icono} /><span>{opcion.nombre}</span></button>)}
      </div>}
    </div>
  </div>
}
