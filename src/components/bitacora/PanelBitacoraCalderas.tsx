import './bitacoraCalderas.css'
import { useBitacora } from '../../hooks/useBitacora'
import { Icono } from '../diseno/Icono'
import { PanelBitacora } from './PanelBitacora'
import { FormularioBitacoraCalderas } from './FormularioBitacoraCalderas'

export function PanelBitacoraCalderas() {
  const datos = useBitacora('calderas')
  if (!datos.cuentaId || (datos.rol !== 'calderas' && datos.rol !== 'admin') || datos.estadoCarga === 'sin-cuenta') return null
  const habilitado = datos.rol === 'calderas' && datos.estadoCarga === 'listo'
    && datos.turno?.finalizado_en === null && datos.turno.iniciado_por === datos.cuentaId
  return <section className="panel-informacion bc-panel" aria-label="Bitácora de Calderas">
    <header className="bc-cabecera"><h2><Icono nombre="bitacora" />Bitácora de Calderas</h2></header>
    {datos.rol === 'calderas' && !habilitado && <p className="bc-ayuda" role="status">
      {datos.estadoCarga === 'cargando' ? 'Consultando el turno y la Bitácora…' : datos.estadoCarga === 'error'
        ? 'La captura técnica estará disponible al confirmar la consulta de Bitácora.' : 'Abre un turno de Calderas para capturar el reporte técnico.'}
    </p>}
    {datos.rol === 'admin' ? <div className="bc-contenido bc-consulta">
      <p className="bc-ayuda bc-aviso-tecnico">La consulta de reportes técnicos estará disponible posteriormente.</p>
      <PanelBitacora area="calderas" referencia />
    </div> : <FormularioBitacoraCalderas key={`${datos.cuentaId}:${datos.turno?.id ?? 'sin-turno'}`} habilitado={habilitado}
      observaciones={<PanelBitacora area="calderas" referencia />} />}
  </section>
}
