import { RefreshCw } from 'lucide-react'
import { cacheConsultas } from '../../lib/cacheConsultas'
import { ResumenHistorial } from '../diseno/ResumenHistorial'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import '../diseno/acordeonHistorial.css'
import './historialFichaTecnica.css'
import { consultarDetalleReporteCalderas, consultarHistorialReportesCalderas } from '../../lib/bitacoraTecnicaCalderas'
import type { FiltrosReportesCalderas, ReporteTecnicoCalderas, ResumenReporteCalderas } from '../../lib/bitacoraTecnicaCalderas'
import { DetalleReporteCalderasPlanta } from '../planta/DetalleReporteCalderasPlanta'

function ReporteHistorico({ resumen, compartido, grupo }: { resumen: ResumenReporteCalderas; compartido: boolean; grupo: string }) {
  const [abierto, setAbierto] = useState(false)
  const elemento = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (!abierto) return
    const temporizador = window.setTimeout(() => elemento.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }), 260)
    return () => window.clearTimeout(temporizador)
  }, [abierto])
  const [intento, setIntento] = useState(0)
  const [reporte, setReporte] = useState<ReporteTecnicoCalderas | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!abierto) return
    let vigente = true
    const control = new AbortController(), limite = window.setTimeout(() => control.abort(), 15000)
    void consultarDetalleReporteCalderas(resumen.id, resumen.turnoId, control.signal, compartido).then(r => {
      if (vigente) setReporte(r)
    }).catch(e => { if (vigente) setError(control.signal.aborted ? 'La consulta tardó demasiado. Reintenta.'
      : e instanceof Error ? e.message : 'No se pudo consultar el detalle técnico.') })
    return () => { vigente = false; window.clearTimeout(limite); control.abort() }
  }, [abierto, intento, resumen.id, resumen.turnoId, compartido])
  return <details ref={elemento} className="bc-reporte-historico co-acordeon-historial" name={grupo} onToggle={e => {
    if (e.currentTarget.open) { setReporte(null); setError(null) }
    setAbierto(e.currentTarget.open)
  }}>
    <ResumenHistorial fecha={resumen.fechaOperativa} titulo="Reporte técnico" operador={resumen.operador} turno={resumen.turno} />
    {error ? <div className="bc-detalle-tecnico"><p role="alert">{error}</p>
      <button type="button" className="boton-secundario" onClick={() => { setReporte(null); setError(null); setIntento(n => n + 1) }}>Reintentar detalle</button></div>
      : reporte ? <DetalleReporteCalderasPlanta reporte={reporte} /> : <p className="bc-ayuda" role="status">Consultando mediciones del reporte…</p>}
  </details>
}

const cacheHistorial = cacheConsultas<{ filas: ResumenReporteCalderas[]; hayMas: boolean; error: string | null }>('historial-Calderas')

export function HistorialReportesCalderas({ actualizacion, compartido = false, filtroArea }: { actualizacion: string; compartido?: boolean; filtroArea?: ReactNode }) {
  const grupoHistorial = useId()
  const [filtros, setFiltros] = useState<FiltrosReportesCalderas>({ desde: '', hasta: '', turno: 'todos' })
  const [pagina, setPagina] = useState(0), [intento, setIntento] = useState(0)
  const clave = `${filtros.desde}:${filtros.hasta}:${filtros.turno}:${pagina}:${intento}:${actualizacion}`
  const filtroCache = JSON.stringify([filtros, pagina, compartido])
  const [resultado, setResultado] = useState<{ clave: string; filas: ResumenReporteCalderas[]; hayMas: boolean; error: string | null } | null>(null)
  useEffect(() => {
    const guardarCache = cacheHistorial.preparar()
    let vigente = true
    const control = new AbortController(), limite = window.setTimeout(() => control.abort(), 15000)
    void consultarHistorialReportesCalderas({ desde: filtros.desde, hasta: filtros.hasta, turno: filtros.turno }, pagina, control.signal, compartido).then(r => {
      if (vigente) { guardarCache(filtroCache, { ...r, error: null }); setResultado({ ...r, clave, error: null }) }
    }).catch(e => { if (vigente) setResultado({ clave, filas: [], hayMas: false, error: control.signal.aborted ? 'La consulta tardó demasiado. Reintenta.'
      : e instanceof Error ? e.message : 'No se pudo consultar el historial técnico.' }) })
    return () => { vigente = false; window.clearTimeout(limite); control.abort() }
  }, [clave, filtros.desde, filtros.hasta, filtros.turno, pagina, compartido, filtroCache])
  const datos = resultado?.clave === clave ? resultado : cacheHistorial.leer(filtroCache)
  return <section className="bc-historial-tecnico" aria-label="Reportes técnicos de Calderas">
    <div className="bc-historial-cabecera">{!filtroArea && <h4>Reportes técnicos</h4>}<button type="button" className="boton-secundario"
      disabled={!datos} onClick={() => { setPagina(0); setIntento(n => n + 1) }} data-actualizar="true" aria-label="Actualizar reportes" title="Actualizar reportes"><RefreshCw size={18} style={{ width: 18, height: 18, flexShrink: 0 }} aria-hidden="true" /></button></div>
    <div className="bc-filtros-tecnicos">
      {filtroArea}
      <label className="bc-campo"><span>Desde</span><input type="date" value={filtros.desde}
        onChange={e => { setPagina(0); setFiltros(f => ({ ...f, desde: e.target.value })) }} /></label>
      <label className="bc-campo"><span>Hasta</span><input type="date" value={filtros.hasta}
        onChange={e => { setPagina(0); setFiltros(f => ({ ...f, hasta: e.target.value })) }} /></label>
      <label className="bc-campo"><span>Turno del reporte</span><select aria-label="Turno del reporte" value={filtros.turno}
        onChange={e => { setPagina(0); setFiltros(f => ({ ...f, turno: e.target.value as FiltrosReportesCalderas['turno'] })) }}>
        <option value="todos">Todos</option><option value="dia">Día</option><option value="tarde">Tarde</option><option value="noche">Noche</option>
      </select></label>
    </div>
    {!datos ? <p className="bc-ayuda" role="status">Consultando reportes técnicos…</p> : datos.error ? <p className="bc-ayuda" role="alert">{datos.error}</p>
      : datos.filas.length === 0 ? <p className="bc-ayuda">No hay reportes técnicos para esta consulta.</p>
      : datos.filas.map(r => <ReporteHistorico key={`${r.id}:${r.revision}`} resumen={r} compartido={compartido} grupo={grupoHistorial} />)}
    {((datos && !datos.error && (pagina > 0 || datos.hayMas)) || pagina > 0) && <nav className="bc-paginacion-tecnica" aria-label="Páginas de reportes técnicos">
      <button type="button" className="boton-secundario" disabled={!datos || pagina === 0} onClick={() => setPagina(n => n - 1)}>Anterior</button>
      <span>Página {pagina + 1}</span><button type="button" className="boton-secundario" disabled={!datos || !datos.hayMas} onClick={() => setPagina(n => n + 1)}>Siguiente</button>
    </nav>}
  </section>
}
