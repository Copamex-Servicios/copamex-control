import './bitacoraPTAR.css'
import { useBitacora } from '../../hooks/useBitacora'
import { FormularioBitacoraPTAR } from './FormularioBitacoraPTAR'
import { useReportePTAR } from '../../hooks/useReportePTAR'
import { HistorialReportesPTAR } from './HistorialReportesPTAR'

export function PanelBitacoraPTAR() {
  const datos = useBitacora('ptar')
  const habilitado = datos.rol === 'ptar' && datos.estadoCarga === 'listo'
    && datos.turno?.finalizado_en === null && datos.turno.iniciado_por === datos.cuentaId
  const captura = useReportePTAR(datos.rol === 'ptar' ? datos.cuentaId : null, datos.turno?.id ?? null, habilitado)
  if (!datos.cuentaId || (datos.rol !== 'ptar' && datos.rol !== 'admin') || datos.estadoCarga === 'sin-cuenta') return null
  const observaciones = <HistorialReportesPTAR key={`${datos.cuentaId}:${datos.rol}`} actualizacion={`${captura.reporte?.id ?? ''}:${captura.reporte?.revision ?? ''}`} />
  return <section className="panel-informacion bpt-panel" aria-label="Bitácora de PTAR">
    <header className="bpt-cabecera"><h2>Bitácora de PTAR</h2></header>
    {datos.rol === 'admin' ? <div className="bpt-contenido bpt-consulta">
      {observaciones}
    </div> : <>
      {!habilitado && !captura.reporte && !captura.pendiente && (datos.estadoCarga === 'cargando' || datos.estadoCarga === 'error') && <p className="bpt-ayuda" role="status">
        {datos.estadoCarga === 'cargando' ? 'Consultando el turno y la Bitácora…' : datos.estadoCarga === 'error'
          ? 'La captura técnica estará disponible al confirmar la consulta de Bitácora.' : null}
      </p>}
      <FormularioBitacoraPTAR key={`${datos.cuentaId}:${datos.turno?.id ?? 'sin-turno'}`} captura={captura}
        observaciones={observaciones} />
    </>}
  </section>
}
