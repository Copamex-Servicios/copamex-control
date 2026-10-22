import { medicionesPTAR } from '../../lib/tiposPTAR'
import type { RegistroPTAR } from '../../lib/tiposPTAR'
import { fechaHoraPTAR, formatearNumeroPTAR } from '../../lib/formatoPTAR'
import { CabeceraRegistroGuardado } from '../diseno/CabeceraRegistroGuardado'
interface Props { registro: RegistroPTAR; alCorregir?: () => void; deshabilitado?: boolean }
export function LecturaPTARGuardada({ registro, alCorregir, deshabilitado = false }: Props) {
  const { lectura, turno, operadorNombre } = registro
  return <article className="nota-bitacora co-ficha-registro">
    <CabeceraRegistroGuardado titulo="Lecturas PTAR" turno={turno} operador={operadorNombre}>
      <div><dt>Captura (México)</dt><dd><time dateTime={lectura.capturado_en}>{fechaHoraPTAR(lectura.capturado_en)}</time></dd></div>
    </CabeceraRegistroGuardado>
    <div className="tabla-calidad-contenedor"><table className="tabla-calidad co-ficha-tabla" role="table">
      <caption>Mediciones PTAR (mg/L)</caption>
      <thead><tr><th scope="col">Parámetro</th><th scope="col">Punto</th><th scope="col">Medición</th></tr></thead>
      <tbody>{medicionesPTAR.map(({campo,parametro,punto}) => <tr key={campo}>
        <td data-label="Parámetro">{parametro}</td><td data-label="Punto">{punto}</td><td data-label="Medición">{lectura[campo] === null ? 'Sin medición' : formatearNumeroPTAR(lectura[campo])}</td>
      </tr>)}</tbody>
    </table></div>
    <footer className="co-ficha-notas"><h4>Notas</h4><p className="notas-turno">{lectura.notas || 'Sin notas.'}</p></footer>
    {alCorregir && <button type="button" className="boton-secundario" disabled={deshabilitado} onClick={alCorregir}>Corregir lectura</button>}
  </article>
}
