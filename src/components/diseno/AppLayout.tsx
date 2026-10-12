import './sidebarCompacto.css'
import { AvisosEntrada } from '../operativo/AvisosEntrada'
import { useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { Button } from './Elementos'
import { Icono } from './Icono'
import type { AccesoVisual, SubmenuVisual } from './tipos'
import './sistemaVisual.css'
import './disenoActualizado.css'
import './inicioFondoSuave.css'

export function AppLayout({ accesos, nombre, rol, titulo, cerrando, alSalir, children, submenu }: { accesos: readonly AccesoVisual[]; nombre: string; rol: string; titulo: string; cerrando: boolean; alSalir: () => void; children: ReactNode; submenu?: SubmenuVisual }) {
  const dialogo = useRef<HTMLDialogElement>(null)
  const id = useId()
  return <div className="co-layout">
    <a className="co-skip" href={`#${id}`}>Ir al contenido</a>
    <aside className="co-sidebar"><Sidebar accesos={accesos} submenu={submenu} nombre={nombre} rol={rol} cerrando={cerrando} alSalir={alSalir} /></aside>
    <dialog ref={dialogo} className="co-mobile-drawer" aria-label="Navegación" onClick={e => { if (e.target === e.currentTarget) dialogo.current?.close() }}>
      <Button className="co-drawer-close" aria-label="Cerrar navegación" onClick={() => dialogo.current?.close()}><Icono nombre="cerrar" /></Button>
      <Sidebar accesos={accesos} submenu={submenu} nombre={nombre} rol={rol} cerrando={cerrando} alSalir={alSalir} alNavegar={() => dialogo.current?.close()} />
    </dialog>
    <div className={titulo === 'Inicio' ? 'co-workspace co-workspace-inicio' : 'co-workspace'}><div className="co-scene" aria-hidden="true"><img src={import.meta.env.BASE_URL + 'fondocpx.jpg'} alt="" /></div><Topbar titulo={titulo} alAbrirMenu={() => dialogo.current?.showModal()} /><AvisosEntrada /><main id={id} tabIndex={-1} className="co-main">{children}</main></div>
  </div>
}
