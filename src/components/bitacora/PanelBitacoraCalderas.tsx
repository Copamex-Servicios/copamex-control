import './bitacoraCalderas.css'
import { useBitacora } from '../../hooks/useBitacora'
import { FormularioBitacoraCalderas } from './FormularioBitacoraCalderas'
import { useReporteCalderas } from '../../hooks/useReporteCalderas'
import { HistorialReportesCalderas } from './HistorialReportesCalderas'

export function PanelBitacoraCalderas() {
  const datos = useBitacora('calderas')
  const habilitado = datos.rol === 'calderas' && datos.estadoCarga === 'listo'
    && datos.turno?.finalizado_en === null && datos.turno.iniciado_por === datos.cuentaId
  const captura = useReporteCalderas(datos.rol === 'calderas' ? datos.cuentaId : null, datos.turno?.id ?? null, habilitado)
  if (!datos.cuentaId || (datos.rol !== 'calderas' && datos.rol !== 'admin') || datos.estadoCarga === 'sin-cuenta') return null
  const observaciones = <HistorialReportesCalderas key={`${datos.cuentaId}:${datos.rol}`} actualizacion={`${captura.reporte?.id ?? ''}:${captura.reporte?.revision ?? ''}`} />
  return <section className="panel-informacion bc-panel" aria-label="Bitácora de Calderas">
    <header className="bc-cabecera"><h2>Bitácora de Calderas</h2></header>
    {datos.rol === 'calderas' && !habilitado && !captura.reporte && !captura.pendiente && <p className="bc-ayuda" role="status">
      {datos.estadoCarga === 'cargando' ? 'Consultando el turno y la Bitácora…' : datos.estadoCarga === 'error'
        ? 'La captura técnica estará disponible al confirmar la consulta de Bitácora.' : 'Abre un turno de Calderas para capturar el reporte técnico.'}
    </p>}
    {datos.rol === 'admin' ? <div className="bc-contenido bc-consulta">
      {observaciones}
    </div> : <FormularioBitacoraCalderas key={`${datos.cuentaId}:${datos.turno?.id ?? 'sin-turno'}`} captura={captura}
      observaciones={observaciones} />}
  </section>
}
