import type { RegistroPozos } from '../../lib/pozos'
import { DetalleLecturaAgua } from '../diseno/DetalleLecturaAgua'

export function LecturaPozosHistorial({registro}:{registro:RegistroPozos}) {
  return <DetalleLecturaAgua tipo="pozos" registro={registro}/>
}
