import type { AreaOperativa } from '../../lib/tiposTurno'
import type { useInformacionDia } from '../../hooks/useInformacionDia'
import { InformacionDelDia } from './InformacionDelDia'
import { PanelTurno } from '../turno/PanelTurno'
import './encabezadoOperativo.css'
import './panelesCompactos.css'
interface Props {
  area: AreaOperativa
  fecha: string | null
  informacion: ReturnType<typeof useInformacionDia>
}
export function EncabezadoOperativo({ area, fecha, informacion }: Props) {
  return <div className="co-encabezado-operativo co-paneles-compactos" aria-label="Información de producción, eventos y turno">
    <InformacionDelDia fecha={fecha} informacion={informacion} compacto />
    <PanelTurno area={area} referencia />
  </div>
}
