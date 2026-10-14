import './bitacoraPTAR.css'
import { useBitacora } from '../../hooks/useBitacora'
import { Icono } from '../diseno/Icono'
import { PanelBitacora } from './PanelBitacora'
import { FormularioBitacoraPTAR } from './FormularioBitacoraPTAR'

export function PanelBitacoraPTAR() {
  const datos = useBitacora('ptar')
  if (!datos.cuentaId || (datos.rol !== 'ptar' && datos.rol !== 'admin') || datos.estadoCarga === 'sin-cuenta') return null
  const habilitado = datos.rol === 'ptar' && datos.estadoCarga === 'listo'
    && datos.turno?.finalizado_en === null && datos.turno.iniciado_por === datos.cuentaId
  return <section className="panel-informacion bpt-panel" aria-label="Bitácora de PTAR">
    <header className="bpt-cabecera"><h2><Icono nombre="bitacora" />Bitácora de PTAR</h2></header>
    {datos.rol === 'admin' ? <div className="bpt-contenido bpt-consulta">
      <p className="bpt-ayuda">La consulta de reportes técnicos estará disponible posteriormente.</p>
      <PanelBitacora area="ptar" referencia />
    </div> : <>
      {!habilitado && <p className="bpt-ayuda" role="status">
        {datos.estadoCarga === 'cargando' ? 'Consultando el turno y la Bitácora…' : datos.estadoCarga === 'error'
          ? 'La captura técnica estará disponible al confirmar la consulta de Bitácora.' : 'Abre un turno de PTAR para capturar el reporte técnico.'}
      </p>}
      <FormularioBitacoraPTAR key={`${datos.cuentaId}:${datos.turno?.id ?? 'sin-turno'}`} habilitado={habilitado}
        observaciones={<PanelBitacora area="ptar" referencia />} />
    </>}
  </section>
}
