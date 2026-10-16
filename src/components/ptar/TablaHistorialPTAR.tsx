import { Pencil } from 'lucide-react'
import { medicionesPTAR } from '../../lib/tiposPTAR'
import type { RegistroPTAR } from '../../lib/tiposPTAR'
import { fechaHoraPTAR, formatearNumeroPTAR } from '../../lib/formatoPTAR'
interface Props {
  registros: RegistroPTAR[]
  deshabilitado: boolean
  puedeCorregir?: (registro: RegistroPTAR) => boolean
  alCorregir?: (registro: RegistroPTAR) => void
}
export function TablaHistorialPTAR({ registros, deshabilitado, puedeCorregir = () => false, alCorregir }: Props) {
  const hayAcciones = !!alCorregir && registros.some(puedeCorregir)
  return <div className="ptar-tabla-contenedor" role="region" aria-label="Historial de lecturas PTAR, tabla desplazable" tabIndex={0}>
    <table className="ptar-tabla">
      <caption>Mediciones PTAR (mg/L). Fechas y horas de México.</caption>
      <thead><tr><th scope="col">Fecha y hora (México)</th><th scope="col">Fecha operativa</th><th scope="col">Turno</th>
        {medicionesPTAR.map(({campo,parametro,punto}) => <th scope="col" key={campo} className="ptar-numero">{parametro} · {punto}<span>mg/L</span></th>)}
        <th scope="col">Notas</th><th scope="col">Operador</th>{hayAcciones && <th scope="col">Acciones</th>}
      </tr></thead>
      <tbody>{registros.map(registro => {
        const { lectura, turno, operadorNombre } = registro
        return <tr key={lectura.id}>
          <td className="ptar-fecha">{fechaHoraPTAR(lectura.capturado_en)}</td><td>{turno.fecha_operativa.split('-').reverse().join('/')}</td>
          <td>{turno.turno === 'dia' ? 'Día' : turno.turno === 'tarde' ? 'Tarde' : 'Noche'}</td>
          {medicionesPTAR.map(({campo}) => <td key={campo} className="ptar-numero">{lectura[campo] === null ? 'Sin medición' : formatearNumeroPTAR(lectura[campo])}</td>)}
          <td className="ptar-nota-historial">{lectura.notas || 'Sin notas.'}</td><td className="ptar-operador">{operadorNombre}</td>
          {hayAcciones && <td>{puedeCorregir(registro) && <button type="button" className="boton-secundario ptar-corregir" disabled={deshabilitado} onClick={() => alCorregir?.(registro)}><Pencil aria-hidden="true" />Corregir lectura</button>}</td>}
        </tr>
      })}</tbody>
    </table>
  </div>
}
