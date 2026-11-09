import './cabeceraReporteTecnico.css'

interface Props {
  titulo: string
  estado: string | null | undefined
  puedeEditar: boolean
  editando: boolean
  editar: () => void
}

export function CabeceraReporteTecnico({ titulo, estado, puedeEditar, editando, editar }: Props) {
  const [etiqueta, ...notas] = estado?.split(' · ') ?? []
  return <>
    <header className="cabecera-reporte-tecnico">
      <div className="cabecera-reporte-titulo"><h2>{titulo}</h2>
        {etiqueta && <span className="cabecera-reporte-estado" data-estado={etiqueta} role="status">{etiqueta}</span>}
      </div>
      {puedeEditar && !editando && <button type="button" className="boton-secundario" onClick={editar}>Editar reporte</button>}
    </header>
    {notas.length > 0 && <p className="cabecera-reporte-notas" role="status">{notas.join(' · ')}</p>}
  </>
}
