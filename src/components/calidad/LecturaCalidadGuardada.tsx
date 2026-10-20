import type { RegistroCalidad } from '../../lib/tiposCalidad'
import { fechaHoraCalidad, formatearNumeroCalidad as numero } from '../../lib/formatoCalidad'
import { CabeceraRegistroGuardado } from '../diseno/CabeceraRegistroGuardado'
import './historialCalidad.css'

interface Props { registro: RegistroCalidad; alCorregir?: () => void; deshabilitado?: boolean; historial?: boolean }
export function LecturaCalidadGuardada({ registro, alCorregir, deshabilitado = false, historial = false }: Props) {
  const [soloFuera, setSoloFuera] = useState(false)
  const { lectura, turno, operadorNombre } = registro
  const fuera = lectura.resultados.filter(r => r.fuera_norma === true)
  const resultados = historial && soloFuera ? fuera : lectura.resultados
  return <article className={`lectura-calidad co-ficha-registro${historial ? ' calidad-historial-ficha' : ''}`}>
    <CabeceraRegistroGuardado titulo="Muestra de Calidad de agua" turno={turno} operador={operadorNombre}>
      <div><dt>Captura (México)</dt><dd><time dateTime={lectura.capturado_en}>{fechaHoraCalidad(lectura.capturado_en)}</time></dd></div>
    </CabeceraRegistroGuardado>
    <section className={historial ? 'calidad-historial-resultados' : undefined}>
      {historial && <header className="calidad-historial-cabecera"><div><h4>Resultados</h4><p>Límites aplicados al momento de la captura</p></div>
        <div className="calidad-historial-filtros" role="group" aria-label="Filtrar resultados de la muestra">
          <button type="button" aria-pressed={!soloFuera} onClick={() => setSoloFuera(false)}>Todos ({lectura.resultados.length})</button>
          <button type="button" aria-pressed={soloFuera} onClick={() => setSoloFuera(true)}>Fuera de norma ({fuera.length})</button>
        </div>
      </header>}
      <div className="tabla-calidad-contenedor"><table className="tabla-calidad co-ficha-tabla" role="table">
      <caption>Resultados y límites aplicados al capturar</caption>
      <thead><tr><th scope="col">Punto</th><th scope="col">Parámetro</th><th scope="col">Valor</th><th scope="col">Límites</th><th scope="col">Evaluación</th></tr></thead>
      <tbody>{resultados.map(r => <tr key={r.id} className={historial && r.fuera_norma === true ? 'calidad-historial-fuera' : undefined}>
        <td data-label="Punto">{r.punto.nombre}</td><td data-label="Parámetro">{r.parametro.nombre}{r.parametro.unidad ? ` (${r.parametro.unidad})` : ''}</td>
        <td data-label="Valor">{numero(r.valor)}</td>
        <td data-label="Límites">{r.limite_min_aplicado === null && r.limite_max_aplicado === null ? 'Sin límites'
          : [r.limite_min_aplicado !== null ? `≥ ${numero(r.limite_min_aplicado)}` : '', r.limite_max_aplicado !== null ? `≤ ${numero(r.limite_max_aplicado)}` : ''].filter(Boolean).join(' · ')}</td>
        <td data-label="Evaluación" className={r.fuera_norma === true ? 'resultado-calidad-fuera' : ''}><span className={historial ? `calidad-historial-evaluacion ${r.fuera_norma === null ? 'sin-limites' : r.fuera_norma ? 'fuera' : 'dentro'}` : undefined}>{r.fuera_norma === null ? 'Sin límites' : r.fuera_norma ? 'Fuera de norma' : 'Dentro de norma'}</span></td>
      </tr>)}</tbody>
    </table></div>
      {historial && soloFuera && fuera.length === 0 && <p className="calidad-historial-vacio" role="status">No hay resultados fuera de norma en esta muestra.</p>}
    </section>
    <footer className="co-ficha-notas"><h4>Notas</h4><p className="notas-turno">{lectura.notas || 'Sin notas.'}</p></footer>
    {alCorregir && <button type="button" className="boton-secundario" disabled={deshabilitado} onClick={alCorregir}>Corregir muestra</button>}
  </article>
}
import { useState } from 'react'
