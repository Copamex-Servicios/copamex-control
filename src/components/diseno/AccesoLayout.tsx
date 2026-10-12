import type { ReactNode } from 'react'
import './accesoVisual.css'

export function AccesoLayout({ children }: { children: ReactNode }) {
  return <main className="co-acceso">
    <aside className="co-acceso-portada" aria-label="COPAMEX Control operativo">
      <img className="co-acceso-fondo" src={import.meta.env.BASE_URL + 'fondo.jpg'} alt="" />
      <div className="co-acceso-identidad">
        <img className="co-acceso-logo" src={import.meta.env.BASE_URL + 'cpx.png'} alt="COPAMEX" width="200" height="200" />
        <span className="co-acceso-acento" aria-hidden="true" />
        <strong>Control operativo</strong>
        <span className="co-acceso-empresa">COPAMEX</span>
      </div>
    </aside>
    <div className="co-acceso-panel">
      <div className="co-acceso-shell">
        <div className="co-acceso-contenido">{children}</div>
      </div>
    </div>
  </main>
}
