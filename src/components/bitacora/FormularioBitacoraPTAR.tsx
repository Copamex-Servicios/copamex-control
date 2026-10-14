import { Fragment, useId, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { bombasBitacoraPTAR, borradorBitacoraPTAR, destinosDescargaPTAR, medicionesBitacoraPTAR, prensasBitacoraPTAR } from '../../lib/tiposBitacoraPTAR'
import type { EstadoAgitadorPTAR, EstadoPrensaPTAR, ModoBombaPTAR } from '../../lib/tiposBitacoraPTAR'

const pestanas = [
  { nombre: 'Clarificador', titulo: 'Clarificador primario' },
  { nombre: 'DAF y bombas', titulo: 'DAF Chino y bombas' },
  { nombre: 'Flujos PTAR', titulo: 'Flujos PTAR' },
  { nombre: 'AIMSU y almacén', titulo: 'AIMSU y tanque de almacén' },
  { nombre: 'Prensas', titulo: 'Prensas de fin de turno' },
  { nombre: 'Observaciones', titulo: 'Observaciones generales' },
]
export function FormularioBitacoraPTAR({ habilitado, observaciones }: { habilitado: boolean; observaciones: ReactNode }) {
  const prefijo = useId()
  const [activo, setActivo] = useState(0)
  const [borrador, setBorrador] = useState(borradorBitacoraPTAR)
  function navegar(evento: KeyboardEvent<HTMLButtonElement>, indice: number) {
    let siguiente: number
    if (evento.key === 'ArrowRight') siguiente = (indice + 1) % pestanas.length
    else if (evento.key === 'ArrowLeft') siguiente = (indice - 1 + pestanas.length) % pestanas.length
    else if (evento.key === 'Home') siguiente = 0
    else if (evento.key === 'End') siguiente = pestanas.length - 1
    else return
    evento.preventDefault()
    setActivo(siguiente)
    evento.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[siguiente]?.focus()
  }
  return <div className="bpt-formulario">
    <div className="bpt-tabs" role="tablist" aria-label="Secciones de Bitácora de PTAR">
      {pestanas.map((pestana, indice) => <button key={pestana.nombre} type="button" role="tab"
        id={`${prefijo}-tab-${indice}`} aria-controls={`${prefijo}-panel-${indice}`}
        aria-selected={activo === indice} tabIndex={activo === indice ? 0 : -1}
        onClick={() => setActivo(indice)} onKeyDown={e => navegar(e, indice)}>{pestana.nombre}</button>)}
    </div>
    {pestanas.map((pestana, indice) => <div className="bpt-seccion" role="tabpanel" key={pestana.nombre}
      id={`${prefijo}-panel-${indice}`} aria-labelledby={`${prefijo}-tab-${indice}`} hidden={activo !== indice} tabIndex={0}>
      <div className={`bpt-contenido${indice === 5 ? ' bpt-observaciones' : ''}`}><h3 className="bpt-titulo-seccion">{pestana.titulo}</h3>
        {indice < 4 && <div className="bpt-mediciones">
          {medicionesBitacoraPTAR.filter(m => m.seccion === indice).map(m => <Fragment key={m.campo}>
            {m.campo === 'setpoint_b13' && <label className="bpt-campo" htmlFor={`${prefijo}-agitador-9300`}><span>Agitador 9300</span>
              <select aria-label="Agitador 9300" id={`${prefijo}-agitador-9300`} disabled={!habilitado} value={borrador.estadoAgitador}
                onChange={e => setBorrador(b => ({ ...b, estadoAgitador: e.target.value as EstadoAgitadorPTAR }))}>
                <option value="">Selecciona</option>{['Servicio', 'Reserva', 'Mantenimiento'].map(v => <option key={v}>{v}</option>)}
              </select>
            </label>}
            <label className="bpt-campo" htmlFor={`${prefijo}-${m.campo}`}>
            <span>{m.nombre}{indice < 2 && <> <small>({m.unidad})</small></>}</span>
            <span className={`bpt-control${indice >= 2 ? ' bpt-con-unidad' : ''}`}><input aria-label={`${m.nombre} (${m.unidad})`} id={`${prefijo}-${m.campo}`} type="number" step="any" inputMode="decimal" disabled={!habilitado}
              value={borrador.mediciones[m.campo]} onChange={e => setBorrador(b => ({ ...b, mediciones: { ...b.mediciones, [m.campo]: e.target.value } }))} />
              {indice >= 2 && <span className="bpt-unidad" aria-hidden="true">{m.unidad}</span>}</span>
          </label></Fragment>)}
          {indice === 1 && <fieldset className="bpt-descarga bpt-ancho" disabled={!habilitado}>
            <legend>Descarga del DAF Chino</legend>
            <div className="bpt-destinos">{destinosDescargaPTAR.map(destino => <label className="bpt-destino" key={destino}>
              <input type="radio" name={`${prefijo}-descarga-daf`} value={destino} checked={borrador.destinoDescarga === destino}
                onChange={() => setBorrador(b => ({ ...b, destinoDescarga: destino }))} />
              <span>{destino}</span>
            </label>)}</div>
          </fieldset>}
        </div>}
        {indice === 1 && <>
          <h4 className="bpt-subtitulo">Modo de operación de las bombas</h4>
          <div className="bpt-mediciones">{bombasBitacoraPTAR.map(bomba => <label className="bpt-campo" key={bomba} htmlFor={`${prefijo}-bomba-${bomba}`}>
            <span>Bomba {bomba}</span>
            <select aria-label={`Bomba ${bomba}`} id={`${prefijo}-bomba-${bomba}`} disabled={!habilitado} value={borrador.bombas[bomba]}
              onChange={e => setBorrador(b => ({ ...b, bombas: { ...b.bombas, [bomba]: e.target.value as ModoBombaPTAR } }))}>
              <option value="">Selecciona</option><option>Automático (A)</option><option>Manual (M)</option>
            </select>
          </label>)}</div>
        </>}
        {indice === 4 && <div className="bpt-mediciones bpt-prensas">
          {prensasBitacoraPTAR.map(prensa => <label className="bpt-campo" key={prensa} htmlFor={`${prefijo}-prensa-${prensa}`}>
            <span>Prensa {prensa}</span>
            <select aria-label={`Prensa ${prensa}`} id={`${prefijo}-prensa-${prensa}`} disabled={!habilitado} value={borrador.prensas[prensa]}
              onChange={e => setBorrador(b => ({ ...b, prensas: { ...b.prensas, [prensa]: e.target.value as EstadoPrensaPTAR } }))}>
              <option value="">Selecciona</option>{['Servicio', 'Reserva', 'Mantenimiento'].map(v => <option key={v}>{v}</option>)}
            </select>
          </label>)}
          <label className="bpt-campo bpt-ancho" htmlFor={`${prefijo}-comentario-prensas`}>
            <span>Reporte relevante de fin de turno y motivo por el cual la prensa está parada <small>(opcional)</small></span>
            <textarea id={`${prefijo}-comentario-prensas`} rows={3} disabled={!habilitado} value={borrador.comentarioPrensas}
              onChange={e => setBorrador(b => ({ ...b, comentarioPrensas: e.target.value }))} />
          </label>
        </div>}
        {indice === 5 && observaciones}
      </div>
    </div>)}
    <footer className="bpt-acciones"><span className="bpt-ayuda" id={`${prefijo}-guardado`}>El guardado técnico estará disponible posteriormente.</span>
      <button type="button" className="boton-primario" disabled aria-describedby={`${prefijo}-guardado`}>Guardar reporte técnico</button>
    </footer>
  </div>
}
