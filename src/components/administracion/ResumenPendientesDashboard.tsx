import { lazy, Suspense, useEffect, useState } from 'react'
import { consultarPendientesTecnicos } from '../../lib/reporteOperativo'
import type { PendienteTecnico } from '../../lib/reporteOperativo'
import { nombresTurno } from '../../lib/planta'
import './pendienteDashboard.css'

const PendienteDashboardDialogo = lazy(() => import('./PendienteDashboardDialogo').then(m => ({ default: m.PendienteDashboardDialogo })))

function inicioPeriodo(fecha: string) {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 366)
  return d.toISOString().slice(0, 10)
}

export function ResumenPendientesDashboard({ cuenta, fecha }: { cuenta: string; fecha: string | null }) {
  const [vista, setVista] = useState<{ clave: string; filas: PendienteTecnico[] } | null>(null)
  const [elegido, setElegido] = useState<PendienteTecnico | null>(null)
  const [revision, setRevision] = useState(0)
  const [pagina, setPagina] = useState(0)
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
  }, [cuenta, fecha, clave, revision])

  const filas = vista?.clave === clave ? vista.filas : []
  const paginaActual = Math.min(pagina, Math.max(0, Math.ceil(filas.length / 3) - 1))
  if (!filas.length) return null
  return <section className="co-dashboard-pendientes" aria-labelledby="dashboard-pendientes-titulo">
    <div className="co-dashboard-pendientes-encabezado"><h2 id="dashboard-pendientes-titulo">Reportes cerrados con pendientes</h2><span>{filas.length} {filas.length === 1 ? 'reporte' : 'reportes'}</span></div>
    <ul className="co-dashboard-pendientes-lista">{filas.slice(paginaActual * 3, paginaActual * 3 + 3).map(f => <li key={f.turno_id}>
      <button type="button" className="co-pendiente-fila" aria-haspopup="dialog"
        aria-label={`Abrir pendiente de ${f.area === 'ptar' ? 'PTAR' : 'Calderas'}, ${f.fecha_operativa}, turno ${nombresTurno[f.turno]}`}
        onClick={() => setElegido(f)}>
      <span className="co-pendiente-fecha"><strong><time dateTime={f.fecha_operativa}>{f.fecha_operativa.split('-').reverse().join('/')}</time></strong><span>{nombresTurno[f.turno]}</span></span>
      <strong>{f.area === 'ptar' ? 'PTAR' : 'Calderas'}</strong>
      <span className="co-pendiente-operadores">{[f.operador, f.operador_acompanante].filter(Boolean).join(' · ')}</span>
      <span className="co-pendiente-etiqueta">Cerrado con pendientes</span>
    </button></li>)}</ul>
    <nav className="co-pendiente-paginacion" aria-label="Páginas de reportes pendientes">
      <button type="button" className="boton-secundario" disabled={paginaActual === 0} onClick={() => setPagina(paginaActual - 1)}>Anterior</button>
      <button type="button" className="boton-secundario" disabled={(paginaActual + 1) * 3 >= filas.length} onClick={() => setPagina(paginaActual + 1)}>Siguiente</button>
    </nav>
    {elegido && <Suspense fallback={<p role="status">Abriendo pendiente…</p>}>
      <PendienteDashboardDialogo key={`${cuenta}:${elegido.turno_id}`} cuenta={cuenta} turno={elegido}
        cerrar={() => { setElegido(null); setRevision(n => n + 1) }} />
    </Suspense>}
  </section>
}
