import type { RegistroBitacora } from '../../lib/tiposBitacora'
import { fechaHoraBitacora } from '../../lib/formatoBitacora'
interface Props { referencia?: boolean; registro: RegistroBitacora; alCorregir?: () => void; deshabilitado?: boolean }
export function LecturaBitacoraGuardada({ registro, alCorregir, deshabilitado = false, referencia = false }: Props) {
  const { lectura, turno, operadorNombre } = registro
  return <article className="nota-bitacora">
    {referencia ? <div className="co-nota-encabezado"><span className="co-nota-avatar" aria-hidden="true">{operadorNombre.trim().split(/\s+/).slice(0, 2).map(parte => parte[0]).join('').toUpperCase()}</span><div><h4>{operadorNombre} · {turno.turno === 'dia' ? 'Día' : turno.turno === 'tarde' ? 'Tarde' : 'Noche'}</h4>
    <p className="ayuda-turno">{fechaHoraBitacora(lectura.capturado_en)} (México) · Fecha operativa: {turno.fecha_operativa.split('-').reverse().join('/')}</p></div></div> : <><h4>{operadorNombre} · {turno.turno === 'dia' ? 'Día' : turno.turno === 'tarde' ? 'Tarde' : 'Noche'}</h4>
    <p className="ayuda-turno">{fechaHoraBitacora(lectura.capturado_en)} (México) · Fecha operativa: {turno.fecha_operativa.split('-').reverse().join('/')}</p></>}
    <p className="texto-bitacora">{lectura.texto}</p>
    {alCorregir && <button type="button" className="boton-secundario" disabled={deshabilitado} onClick={alCorregir}>Corregir nota</button>}
  </article>
}
