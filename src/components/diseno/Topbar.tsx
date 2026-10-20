import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import logoCopamex from '../../assets/cpx-logo-barra.png'
import type { AccesoVisual, SubmenuVisual } from './tipos'

export function Topbar({ accesos, submenu, nombre, rol, cerrando, alSalir }: {
  accesos: readonly AccesoVisual[]; submenu?: SubmenuVisual; nombre: string; rol: string;
  cerrando: boolean; alSalir: () => void
}) {
  const ubicacion = useLocation()
  const id = useId()
  const botonMenu = useRef<HTMLButtonElement>(null)
  const confirmarSalida = useRef<HTMLDialogElement>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [ahora, setAhora] = useState(() => new Date())
  const abierto = menu === ubicacion.key
  useEffect(() => {
    const intervalo = window.setInterval(() => setAhora(new Date()), 30000)
    return () => window.clearInterval(intervalo)
  }, [])
  const cerrar = () => setMenu(null)
  return <header className="co-barra-superior">
    <NavLink className="co-barra-logo" to="/" end aria-label="COPAMEX, ir a Inicio" onClick={cerrar}>
      <img src={logoCopamex} alt="COPAMEX" width="68" height="68" />
    </NavLink>
    <button ref={botonMenu} type="button" className="co-barra-menu" aria-expanded={abierto} aria-controls={id}
      onClick={() => setMenu(abierto ? null : ubicacion.key)}>Menú</button>
    <nav id={id} className={`co-barra-enlaces${abierto ? ' co-barra-abierta' : ''}`} aria-label="Navegación principal"
      onKeyDown={e => { if (e.key === 'Escape') { cerrar(); botonMenu.current?.focus() } }}>
      <NavLink to="/" end onClick={cerrar}>Inicio</NavLink>
      {accesos.map(acceso => {
        const actual = acceso.ruta === ubicacion.pathname
        const opciones = actual ? submenu : undefined
        return <Fragment key={acceso.ruta}>
          <NavLink to={acceso.ruta} onClick={e => {
            if (actual && opciones?.opciones.length && e.button === 0 && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
              e.preventDefault(); opciones.alSeleccionar(opciones.opciones[0].id)
            }
            cerrar()
          }} className={({ isActive }) => isActive && !opciones ? 'active' : ''}>
            {acceso.titulo}
          </NavLink>
          {opciones && <div className="co-barra-submenu" role="group" aria-label={opciones.titulo}>
            {opciones.opciones.map(opcion => <button type="button" key={opcion.id}
              className={opciones.seleccion === opcion.id ? 'active' : ''} aria-pressed={opciones.seleccion === opcion.id}
              onClick={() => { opciones.alSeleccionar(opcion.id); cerrar() }}>{opcion.nombre}</button>)}
          </div>}
        </Fragment>
      })}
    </nav>
    <div className="co-barra-fecha" aria-label="Hora de México">
      <span>{new Intl.DateTimeFormat('es-MX', { timeZone:'America/Mexico_City', weekday:'short', day:'numeric', month:'short', year:'numeric' }).format(ahora)}</span>
      <strong>{new Intl.DateTimeFormat('es-MX', { timeZone:'America/Mexico_City', hour:'numeric', minute:'2-digit' }).format(ahora)}</strong>
    </div>
    <div className="co-barra-cuenta" role="group" aria-label={`Sesión de ${nombre}, perfil ${rol}`}>
      <div><strong title={`${nombre} · ${rol}`}>{nombre}</strong></div>
      <button type="button" disabled={cerrando} onClick={() => { if (!cerrando && !confirmarSalida.current?.open) confirmarSalida.current?.showModal() }}>{cerrando ? 'Cerrando sesión…' : 'Cerrar sesión'}</button>
    </div>
    <dialog ref={confirmarSalida} className="co-confirmar-salida" aria-labelledby={`${id}-salida`}>
      <h2 id={`${id}-salida`}>¿Quieres cerrar sesión?</h2>
      <form method="dialog">
        <button type="submit" autoFocus>Cancelar</button>
        <button type="button" className="co-confirmar-salida-aceptar" disabled={cerrando} onClick={() => {
          if (cerrando || !confirmarSalida.current?.open) return
          confirmarSalida.current.close()
          alSalir()
        }}>Sí, cerrar sesión</button>
      </form>
    </dialog>
  </header>
}
