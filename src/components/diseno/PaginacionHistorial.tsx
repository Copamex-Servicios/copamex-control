import { ChevronLeft, ChevronRight } from 'lucide-react'
import './acordeonHistorial.css'

export function PaginacionHistorial({ pagina, anterior, siguiente, hayAnterior, haySiguiente, cargando = false, etiqueta }: {
  pagina: number; anterior: () => void; siguiente: () => void; hayAnterior: boolean; haySiguiente: boolean
  cargando?: boolean; etiqueta: string
}) {
  return <nav className="co-paginacion-historial" aria-label={`Paginación de ${etiqueta}`}>
    <button type="button" aria-label="Página anterior" title="Página anterior" disabled={!hayAnterior || cargando} onClick={anterior}>
      <ChevronLeft size={18} aria-hidden="true" />
    </button>
    <span aria-live="polite">Página {pagina + 1}</span>
    <button type="button" aria-label="Página siguiente" title="Página siguiente" disabled={!haySiguiente || cargando} onClick={siguiente}>
      <ChevronRight size={18} aria-hidden="true" />
    </button>
  </nav>
}
