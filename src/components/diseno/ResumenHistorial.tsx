import type { TipoTurno } from '../../lib/tiposTurno'
import './resumenHistorial.css'

const turnos: Record<TipoTurno, string> = { dia: 'Día', tarde: 'Tarde', noche: 'Noche' }

export function ResumenHistorial({ fecha, titulo, operador, turno, adicional }: {
  fecha: string; titulo: string; operador: string; turno: TipoTurno; adicional?: string
}) {
  const dia = new Date(`${fecha}T12:00:00Z`)
  return <summary className="co-resumen-historial">
    <span className="co-resumen-fecha"><time dateTime={fecha}>{fecha.split('-').reverse().join('/')}</time>
      <small>{Number.isNaN(dia.getTime()) ? '' : new Intl.DateTimeFormat('es-MX', { weekday: 'long', timeZone: 'UTC' }).format(dia)}</small></span>
    <span className="co-resumen-identidad"><strong>{titulo}</strong><span>{operador}</span>{adicional && <small>{adicional}</small>}</span>
    <span className="co-resumen-turno" data-turno={turno}>{turnos[turno]}</span>
    <span className="co-resumen-accion"><span className="co-resumen-ver">Ver detalle</span><span className="co-resumen-ocultar">Ocultar</span></span>
  </summary>
}
