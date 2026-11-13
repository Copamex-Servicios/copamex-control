import type { RegistroCalidad } from '../../lib/tiposCalidad'
import { fechaHoraCalidad, formatearNumeroCalidad as numero, textoLimitesResultadoCalidad, textoEvaluacionCalidad } from '../../lib/formatoCalidad'
import { CabeceraRegistroGuardado } from '../diseno/CabeceraRegistroGuardado'
import './historialCalidad.css'
import { resultadosHojaCalidad } from '../../lib/hojaRegistroCalidad'

interface Props { registro: RegistroCalidad; adicionales?: readonly RegistroCalidad[]; alCorregir?: () => void; deshabilitado?: boolean; historial?: boolean; exportable?: boolean; compacta?: boolean }
export function LecturaCalidadGuardada({ registro, adicionales = [], alCorregir, deshabilitado = false, historial = false, exportable = false, compacta = false }: Props) {
  const [soloFuera, setSoloFuera] = useState(false)
  const [exportando, setExportando] = useState(false)
  const [errorExportacion, setErrorExportacion] = useState<string | null>(null)
  const { lectura, turno, operadorNombre } = registro
  const filas = resultadosHojaCalidad(registro,adicionales)
  const fuera = filas.filter(f => f.resultado.fuera_norma === true)
  const resultados = historial && soloFuera ? fuera : filas
  async function exportar() {
    if (exportando) return
    setExportando(true); setErrorExportacion(null)
    try {
      const { descargarResultadosCalidad } = await import('../../lib/exportarCalidad')
      descargarResultadosCalidad(registro, resultados.map(f => f.resultado),
        new Map(resultados.filter(f => f.adicional).map(f => [f.resultado.id,`Adicional · ${fechaHoraCalidad(f.capturadoEn)}`])))
    } catch { setErrorExportacion('No se pudo exportar el Excel. Intenta nuevamente.') }
    finally { setExportando(false) }
  }
  return <article className={`lectura-calidad co-ficha-registro${historial ? ' calidad-historial-ficha' : ''}`}>
    {!compacta && <CabeceraRegistroGuardado titulo="Muestra de Calidad de agua" turno={turno} operador={operadorNombre}>
      <div><dt>Captura (México)</dt><dd><time dateTime={lectura.capturado_en}>{fechaHoraCalidad(lectura.capturado_en)}</time></dd></div>
    </CabeceraRegistroGuardado>}
    <section className={historial ? 'calidad-historial-resultados' : undefined}>
      {historial && <header className="calidad-historial-cabecera"><div><h4>Resultados</h4><p>Límites aplicados al momento de la captura</p></div>
        <div className="calidad-historial-filtros" role="group" aria-label="Filtrar resultados de la muestra">
          <button type="button" aria-pressed={!soloFuera} onClick={() => setSoloFuera(false)}>Todos ({filas.length})</button>
          <button type="button" aria-pressed={soloFuera} onClick={() => setSoloFuera(true)}>Fuera de norma ({fuera.length})</button>
          {exportable && <button type="button" className="calidad-exportar-excel" disabled={exportando} onClick={() => { void exportar() }}>{exportando ? 'Exportando…' : 'Exportar a Excel'}</button>}
        </div>
      </header>}
      {errorExportacion && <p className="mensaje-error" role="alert">{errorExportacion}</p>}
      <div className="tabla-calidad-contenedor"><table className="tabla-calidad co-ficha-tabla" role="table">
      <caption>Resultados y límites aplicados al capturar</caption>
      <thead><tr><th scope="col">Punto</th><th scope="col">Parámetro</th><th scope="col">Valor</th><th scope="col">Límites</th><th scope="col">Evaluación</th></tr></thead>
      <tbody>{resultados.map(({resultado:r,adicional,capturadoEn}) => <tr key={r.id} className={historial && r.fuera_norma === true ? 'calidad-historial-fuera' : undefined}>
        <td data-label="Punto">{r.punto.nombre}</td><td data-label="Parámetro">{r.parametro.nombre}{r.parametro.unidad ? ` (${r.parametro.unidad})` : ''}
          {adicional && <small className="co-calidad-lectura-adicional">Adicional · <time dateTime={capturadoEn}>{fechaHoraCalidad(capturadoEn)}</time></small>}</td>
        <td data-label="Valor">{numero(r.valor)}</td>
        <td data-label="Límites">{textoLimitesResultadoCalidad(r.limite_min_aplicado,r.limite_max_aplicado)}</td>
        <td data-label="Evaluación" className={r.fuera_norma === true ? 'resultado-calidad-fuera' : ''}><span className={historial && r.fuera_norma !== null ? `calidad-historial-evaluacion ${r.fuera_norma ? 'fuera' : 'dentro'}` : undefined}>{textoEvaluacionCalidad(r.fuera_norma)}</span></td>
      </tr>)}</tbody>
    </table></div>
      {historial && soloFuera && fuera.length === 0 && <p className="calidad-historial-vacio" role="status">No hay resultados fuera de norma en esta muestra.</p>}
    </section>
    <footer className="co-ficha-notas"><h4>Notas</h4><p className="notas-turno">{lectura.notas || 'Sin notas.'}</p></footer>
    {alCorregir && <button type="button" className="boton-secundario" disabled={deshabilitado} onClick={alCorregir}>Corregir muestra</button>}
  </article>
}
import { useState } from 'react'
