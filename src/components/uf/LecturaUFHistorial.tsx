import type { RegistroUF } from '../../lib/uf'
import { DetalleLecturaAgua } from '../diseno/DetalleLecturaAgua'
import './historialUF.css'

export function LecturaUFHistorial({registro}:{registro:RegistroUF}) {
  return <DetalleLecturaAgua tipo="uf" registro={registro}/>
}
