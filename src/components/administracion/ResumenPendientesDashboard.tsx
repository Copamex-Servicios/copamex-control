import { useEffect, useState } from 'react'
import { consultarPendientesTecnicos } from '../../lib/reporteOperativo'
import type { PendienteTecnico } from '../../lib/reporteOperativo'
import { nombresTurno } from '../../lib/planta'

function inicioPeriodo(fecha: string) {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 366)
  return d.toISOString().slice(0, 10)
}

export function ResumenPendientesDashboard({ cuenta, fecha }: { cuenta: string; fecha: string | null }) {
  const [vista, setVista] = useState<{ clave: string; filas: PendienteTecnico[] } | null>(null)
  const clave = fecha ? `${cuenta}:${fecha}` : ''
  useEffect(() => {
    if (!fecha) return
    let vigente = true
    const control = new AbortController()
    const limite = window.setTimeout(() => control.abort(), 15000)
    void consultarPendientesTecnicos(cuenta, { desde: inicioPeriodo(fecha), hasta: fecha, area: 'todas' }, 0, control.signal, 100)
      .then(datos => { if (vigente) setVista({ clave, filas: datos?.filas ?? [] }) })
      .catch(() => { if (vigente) setVista({ clave, filas: [] }) })
      .finally(() => window.clearTimeout(limite))
    return () => { vigente = false; control.abort(); window.clearTimeout(limite) }
  }, [cuenta, fecha, clave])

  const filas = vista?.clave === clave ? vista.filas : []
  if (!filas.length) return null
  return <section className="co-dashboard-pendientes" aria-labelledby="dashboard-pendientes-titulo">
    <div className="co-dashboard-pendientes-encabezado"><h2 id="dashboard-pendientes-titulo">Pendientes</h2><span>{filas.length}</span></div>
    <ul>{filas.map(f => <li key={f.turno_id}>
      <time dateTime={f.fecha_operativa}>{f.fecha_operativa.split('-').reverse().join('/')}</time>
      <span className="co-dashboard-pendientes-turno">{nombresTurno[f.turno]}</span>
      <strong>{f.area === 'ptar' ? 'PTAR' : 'Calderas'}</strong>
      <span className="co-dashboard-pendientes-estado">Pendiente</span>
    </li>)}</ul>
  </section>
}
