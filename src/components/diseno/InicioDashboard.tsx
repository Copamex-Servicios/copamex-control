import './inicioFilas.css'
import { Link } from 'react-router-dom'
import { Icono } from './Icono'
import type { AccesoVisual } from './tipos'

export function InicioDashboard({ accesos, nombre }: { accesos: readonly AccesoVisual[]; nombre: string; rol: string; admin: boolean }) {
  return <div className="co-home co-home-actualizado co-home-filas">
    <header className="co-welcome">
      <div><h1>Inicio</h1><p>Bienvenido, {nombre}</p></div>
    </header>
    <nav className="co-launch-grid" aria-label="Módulos disponibles">
      {accesos.map(a => <Link key={a.ruta} to={a.ruta} className="co-launch-card" data-modulo={a.icono}>
        <span className="co-launch-icon" aria-hidden="true"><Icono nombre={a.icono} /></span>
        <div className="co-launch-copy"><h2>{a.titulo}</h2></div>
      </Link>)}
    </nav>
  </div>
}
