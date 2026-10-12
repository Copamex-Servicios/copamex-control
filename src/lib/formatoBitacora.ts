export function fechaHoraBitacora(fecha: string): string {
  return new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(fecha))
}
