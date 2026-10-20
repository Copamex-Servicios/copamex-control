import { AvisosEntrada } from '../operativo/AvisosEntrada'
import { Suspense, useId } from 'react'
import type { ReactNode } from 'react'
import { Topbar } from './Topbar'
import type { AccesoVisual, SubmenuVisual } from './tipos'
import './sistemaVisual.css'
import './disenoActualizado.css'
import './inicioFondoSuave.css'
import './navegacionSuperior.css'

export function AppLayout({ accesos, nombre, rol, titulo, cerrando, alSalir, children, submenu }: { accesos: readonly AccesoVisual[]; nombre: string; rol: string; titulo: string; cerrando: boolean; alSalir: () => void; children: ReactNode; submenu?: SubmenuVisual }) {
  const id = useId()
  return <div className="co-layout co-layout-horizontal">
    <a className="co-skip" href={`#${id}`}>Ir al contenido</a>
    <Topbar accesos={accesos} submenu={submenu} nombre={nombre} rol={rol} cerrando={cerrando} alSalir={alSalir} />
    <div className={titulo === 'Inicio' ? 'co-workspace co-workspace-inicio' : 'co-workspace'}><AvisosEntrada /><main id={id} tabIndex={-1} className="co-main"><Suspense fallback={<p className="co-module-loading" role="status">Cargando módulo…</p>}>{children}</Suspense></main></div>
  </div>
}
