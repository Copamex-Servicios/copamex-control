import { useId } from 'react'
import type { RegistroUF } from '../../lib/uf'
import { formatearVolumenUF } from '../../lib/formatoUF'
import { CabeceraRegistroGuardado } from '../diseno/CabeceraRegistroGuardado'
import './historialUF.css'

const fechaHora = new Intl.DateTimeFormat('es-MX', {
  timeZone:'America/Mexico_City', day:'2-digit', month:'2-digit', year:'numeric',
  hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23',
})

function Volumen({ valor }: { valor: number }) {
  return <>{formatearVolumenUF(valor).slice(0, -3)}<small> m³</small></>
}

export function LecturaUFHistorial({ registro }: { registro: RegistroUF }) {
  const id = useId()
  const { lectura, turno, operadorNombre } = registro
  const medidores = [
    { nombre:'Alimentación', inicial:lectura.alim_ini, final:lectura.alim_fin, total:lectura.alimentado },
    { nombre:'Aceptación', inicial:lectura.acep_ini, final:lectura.acep_fin, total:lectura.aceptado },
  ]
  return <article className="uf-historial-ficha" aria-labelledby={`${id}-titulo`}>
    <CabeceraRegistroGuardado titulo="Lectura de Ultrafiltración" tituloId={`${id}-titulo`} turno={turno} operador={operadorNombre}>
      <div><dt>Estado del turno</dt><dd>{turno.finalizado_en === null ? 'Turno abierto' : 'Turno cerrado'}</dd></div>
    </CabeceraRegistroGuardado>
    <section className="uf-historial-seccion" aria-labelledby={`${id}-resultados`}>
      <h4 id={`${id}-resultados`}>Resultados del turno</h4>
      <dl className="uf-historial-resultados">
        <div><dt>Alimentado</dt><dd><Volumen valor={lectura.alimentado} /></dd></div>
        <div><dt>Aceptado</dt><dd><Volumen valor={lectura.aceptado} /></dd></div>
        <div><dt>Rechazo</dt><dd><Volumen valor={lectura.rechazo} /></dd></div>
        <div className="uf-historial-rendimiento"><dt>Rendimiento</dt><dd className={lectura.rendimiento === null ? 'uf-historial-vacio' : undefined}>
          {lectura.rendimiento === null ? 'Sin alimentación: no aplica' : <>{lectura.rendimiento.toLocaleString('es-MX', { maximumFractionDigits:2 })}<small> %</small></>}
        </dd></div>
      </dl>
    </section>
    <section className="uf-historial-seccion" aria-labelledby={`${id}-medidores`}>
      <h4 id={`${id}-medidores`}>Lecturas del medidor</h4>
      <div className="uf-historial-tabla" tabIndex={0} role="region" aria-label="Lecturas del medidor en metros cúbicos">
        <table><thead><tr><th scope="col">Medidor</th><th scope="col">Lectura inicial</th><th scope="col">Lectura final</th><th scope="col">Total</th></tr></thead>
          <tbody>{medidores.map(medidor => <tr key={medidor.nombre}>
            <th scope="row">{medidor.nombre}</th><td><Volumen valor={medidor.inicial} /></td>
            <td><Volumen valor={medidor.final} /></td><td><strong><Volumen valor={medidor.total} /></strong></td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
    <section className="uf-historial-seccion" aria-labelledby={`${id}-registro`}>
      <h4 id={`${id}-registro`}>Registro y notas</h4>
      <div className="uf-historial-registro">
        <dl><div><dt>Captura (México)</dt><dd><time dateTime={lectura.capturado_en}>{fechaHora.format(new Date(lectura.capturado_en))}</time></dd></div>
          {turno.finalizado_en !== null && <div><dt>Cierre del turno (México)</dt><dd><time dateTime={turno.finalizado_en}>{fechaHora.format(new Date(turno.finalizado_en))}</time></dd></div>}
        </dl>
        <div className="uf-historial-notas"><span>Notas</span><p>{lectura.notas || 'Sin notas.'}</p></div>
      </div>
    </section>
  </article>
}
