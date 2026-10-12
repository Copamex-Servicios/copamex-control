import type { RegistroCalidad } from '../../lib/tiposCalidad'
import { fechaHoraCalidad, formatearNumeroCalidad as numero } from '../../lib/formatoCalidad'

interface Props { registro: RegistroCalidad; alCorregir?: () => void; deshabilitado?: boolean }
export function LecturaCalidadGuardada({ registro, alCorregir, deshabilitado = false }: Props) {
  const { lectura, turno, operadorNombre } = registro
  return <article className="lectura-calidad">
    <h4>Muestra de {operadorNombre}</h4>
    <p>Turno: {turno.turno === 'dia' ? 'Día' : turno.turno === 'tarde' ? 'Tarde' : 'Noche'} · Fecha operativa: {turno.fecha_operativa.split('-').reverse().join('/')}</p>
    <p>Capturada: {fechaHoraCalidad(lectura.capturado_en)} (México)</p>
    <div className="tabla-calidad-contenedor"><table className="tabla-calidad">
      <caption>Resultados y límites aplicados al capturar</caption>
      <thead><tr><th scope="col">Punto</th><th scope="col">Parámetro</th><th scope="col">Valor</th><th scope="col">Límites</th><th scope="col">Evaluación</th></tr></thead>
      <tbody>{lectura.resultados.map(r => <tr key={r.id}>
        <td>{r.punto.nombre}</td><td>{r.parametro.nombre}{r.parametro.unidad ? ` (${r.parametro.unidad})` : ''}</td>
        <td>{numero(r.valor)}</td>
        <td>{r.limite_min_aplicado === null && r.limite_max_aplicado === null ? 'Sin límites'
          : [r.limite_min_aplicado !== null ? `≥ ${numero(r.limite_min_aplicado)}` : '', r.limite_max_aplicado !== null ? `≤ ${numero(r.limite_max_aplicado)}` : ''].filter(Boolean).join(' · ')}</td>
        <td className={r.fuera_norma === true ? 'resultado-calidad-fuera' : ''}>{r.fuera_norma === null ? 'Sin límites' : r.fuera_norma ? 'Fuera de norma' : 'Dentro de norma'}</td>
      </tr>)}</tbody>
    </table></div>
    <p className="notas-turno">Notas: {lectura.notas || 'Sin notas.'}</p>
    {alCorregir && <button type="button" className="boton-secundario" disabled={deshabilitado} onClick={alCorregir}>Corregir muestra</button>}
  </article>
}
