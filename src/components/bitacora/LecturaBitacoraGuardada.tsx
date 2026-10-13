import type { RegistroBitacora } from '../../lib/tiposBitacora'
import { fechaHoraBitacora } from '../../lib/formatoBitacora'
interface Props { referencia?: boolean; registro: RegistroBitacora; alCorregir?: () => void; deshabilitado?: boolean }
export function LecturaBitacoraGuardada({ registro, alCorregir, deshabilitado = false, referencia = false }: Props) {
  const { lectura, turno, operadorNombre } = registro
  return <article className="nota-bitacora">
    {referencia ? <header className="bitacora-nota-cabecera">
      <div className="bitacora-nota-identidad">
        <h4>{operadorNombre}</h4>
        <span className="bitacora-nota-turno">{turno.turno === 'dia' ? 'Día' : turno.turno === 'tarde' ? 'Tarde' : 'Noche'}</span>
      </div>
      <p className="bitacora-nota-fechas">
        <span><time dateTime={lectura.capturado_en}>{fechaHoraBitacora(lectura.capturado_en)}</time> (México)</span>
        <span>Fecha operativa: <time dateTime={turno.fecha_operativa}>{turno.fecha_operativa.split('-').reverse().join('/')}</time></span>
      </p>
    </header> : <><h4>{operadorNombre} · {turno.turno === 'dia' ? 'Día' : turno.turno === 'tarde' ? 'Tarde' : 'Noche'}</h4>
    <p className="ayuda-turno">{fechaHoraBitacora(lectura.capturado_en)} (México) · Fecha operativa: {turno.fecha_operativa.split('-').reverse().join('/')}</p></>}
    <p className="texto-bitacora">{lectura.texto}</p>
    {alCorregir && <button type="button" className="boton-secundario" disabled={deshabilitado} onClick={alCorregir}>Corregir nota</button>}
  </article>
}
