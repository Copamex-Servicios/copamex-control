import { medicionesPTAR } from '../../lib/tiposPTAR'
import type { RegistroPTAR } from '../../lib/tiposPTAR'
import { fechaHoraPTAR, formatearNumeroPTAR } from '../../lib/formatoPTAR'
interface Props { registro: RegistroPTAR; alCorregir?: () => void; deshabilitado?: boolean }
export function LecturaPTARGuardada({ registro, alCorregir, deshabilitado = false }: Props) {
  const { lectura, turno, operadorNombre } = registro
  return <article className="nota-bitacora">
    <h4>{operadorNombre} · {turno.turno === 'dia' ? 'Día' : turno.turno === 'tarde' ? 'Tarde' : 'Noche'}</h4>
    <p className="ayuda-turno">{fechaHoraPTAR(lectura.capturado_en)} (México) · Fecha operativa: {turno.fecha_operativa.split('-').reverse().join('/')}</p>
    <div className="tabla-calidad-contenedor"><table className="tabla-calidad">
      <caption>Mediciones PTAR (mg/L)</caption>
      <thead><tr><th scope="col">Parámetro</th><th scope="col">Punto</th><th scope="col">Medición</th></tr></thead>
      <tbody>{medicionesPTAR.map(({campo,parametro,punto}) => <tr key={campo}>
        <td>{parametro}</td><td>{punto}</td><td>{lectura[campo] === null ? 'Sin medición' : formatearNumeroPTAR(lectura[campo])}</td>
      </tr>)}</tbody>
    </table></div>
    <p className="notas-turno">Notas: {lectura.notas || 'Sin notas.'}</p>
    {alCorregir && <button type="button" className="boton-secundario" disabled={deshabilitado} onClick={alCorregir}>Corregir lectura</button>}
  </article>
}
