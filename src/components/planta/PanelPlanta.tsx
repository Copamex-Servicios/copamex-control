import { useAuth } from '../../hooks/useAuth'
import { ReportesTecnicosPlanta } from './ReportesTecnicosPlanta'
import { PanelSupervisionPlanta } from './PanelSupervisionPlanta'

export function PanelPlanta() {
  const { perfil } = useAuth()
  return perfil?.rol === 'admin' ? <PanelSupervisionPlanta /> : <ReportesTecnicosPlanta />
}
