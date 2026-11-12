import type { TurnoOperativo } from './tiposTurno'

// America/Mexico_City usa UTC-6 sin horario de verano para los turnos actuales.
// Solo programa el refresco visual: el cierre definitivo lo determina PostgreSQL.
export function finProgramadoTurno(turno: Pick<TurnoOperativo, 'fecha_operativa' | 'turno'>): number {
  const fecha = new Date(`${turno.fecha_operativa}T12:00:00Z`)
  if (turno.turno === 'noche') fecha.setUTCDate(fecha.getUTCDate() + 1)
  const hora = turno.turno === 'dia' ? '15:01' : turno.turno === 'tarde' ? '21:01' : '07:01'
  return Date.parse(`${fecha.toISOString().slice(0, 10)}T${hora}:00-06:00`)
}
