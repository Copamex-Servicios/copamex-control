import { Button } from './Elementos'
import { Icono } from './Icono'

export function Topbar({ titulo, alAbrirMenu }: { titulo: string; alAbrirMenu: () => void }) {
  return <header className="co-topbar co-mobile-topbar"><Button className="co-menu-toggle" aria-label="Abrir navegación" aria-haspopup="dialog" onClick={alAbrirMenu}><Icono nombre="menu" /></Button><strong>{titulo}</strong></header>
}
