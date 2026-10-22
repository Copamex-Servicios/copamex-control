import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { HistorialReportesCalderas } from '../bitacora/HistorialReportesCalderas'
import { HistorialReportesPTAR } from '../bitacora/HistorialReportesPTAR'
import '../bitacora/bitacoraCalderas.css'
import '../bitacora/bitacoraPTAR.css'

export function ReportesTecnicosPlanta() {
  const { perfil, sesion, estado } = useAuth()
  if (estado !== 'autenticado' || !perfil?.activo || perfil.id !== sesion?.user.id || !['admin', 'calderas', 'ptar'].includes(perfil.rol)) return null
  return <Consulta key={`${perfil.id}:${perfil.rol}`} />
}
function Consulta() {
  const [area, setArea] = useState<'calderas' | 'ptar'>('calderas')
  const filtroArea = <label>Área del reporte <select aria-label="Área del reporte" value={area} onChange={e => setArea(e.target.value as typeof area)}><option value="calderas">Calderas</option><option value="ptar">PTAR</option></select></label>
  return <section className="panel-informacion planta-reportes-unificados" aria-labelledby="reportes-tecnicos-planta">
    <div className="planta-encabezado"><h2 id="reportes-tecnicos-planta">Reportes técnicos</h2></div>

    {area === 'calderas' ? <div className="bc-panel"><HistorialReportesCalderas compartido actualizacion="planta" filtroArea={filtroArea} /></div>
      : <div className="bpt-panel"><HistorialReportesPTAR compartido actualizacion="planta" filtroArea={filtroArea} /></div>}
  </section>
}
