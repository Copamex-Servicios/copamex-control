import '../administracion/administracionReferencia.css'
import { PanelLimitesCalidad } from '../administracion/PanelLimitesCalidad'
import { useAdministracion } from '../../hooks/useAdministracion'

// La pantalla y sus operaciones siguen en el componente original, exclusivo de Admin.
export function PaginaLimitesCalidad() {
  const { cuenta, datos, error } = useAdministracion()
  if (!cuenta) return null
  return <div className="admin-panel co-admin-referencia">
    {error && <p className="mensaje-error" role="alert">{error}</p>}
    <PanelLimitesCalidad key={cuenta} datos={datos} />
  </div>
}
