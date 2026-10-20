import { ResumenHistorial } from '../diseno/ResumenHistorial'
import { DetalleReportePTARPlanta } from '../planta/DetalleReportePTARPlanta'
import { useEffect, useId, useState } from 'react'
import '../diseno/acordeonHistorial.css'
import './historialFichaTecnica.css'
import { consultarDetalleReportePTAR, consultarHistorialReportesPTAR } from '../../lib/bitacoraTecnicaPTAR'
import type { FiltrosReportesPTAR, ReporteTecnicoPTAR, ResumenReportePTAR } from '../../lib/bitacoraTecnicaPTAR'
function ReporteHistorico({ resumen, compartido, grupo }: { resumen: ResumenReportePTAR; compartido: boolean; grupo: string }) {
  const [abierto, setAbierto] = useState(false)
  const [intento, setIntento] = useState(0)
  const [reporte, setReporte] = useState<ReporteTecnicoPTAR | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!abierto) return
    let vigente = true
    const control = new AbortController(), limite = window.setTimeout(() => control.abort(), 15000)
    void consultarDetalleReportePTAR(resumen.id, resumen.turnoId, control.signal, compartido).then(r => {
      if (vigente) setReporte(r)
    }).catch(e => { if (vigente) setError(control.signal.aborted ? 'La consulta tardó demasiado. Reintenta.'
      : e instanceof Error ? e.message : 'No se pudo consultar el detalle técnico.') })
    return () => { vigente = false; window.clearTimeout(limite); control.abort() }
  }, [abierto, intento, resumen.id, resumen.turnoId, compartido])
  return <details className="bpt-reporte-historico co-acordeon-historial" name={grupo} onToggle={e => {
    if (e.currentTarget.open) { setReporte(null); setError(null) }
    setAbierto(e.currentTarget.open)
  }}>
    <ResumenHistorial fecha={resumen.fechaOperativa} titulo="Reporte técnico" operador={resumen.operador} turno={resumen.turno} />
    {error ? <div className="bpt-detalle-tecnico"><p role="alert">{error}</p>
      <button type="button" className="boton-secundario" onClick={() => { setReporte(null); setError(null); setIntento(n => n + 1) }}>Reintentar detalle</button></div>
      : reporte ? <DetalleReportePTARPlanta reporte={reporte} /> : <p className="bpt-ayuda" role="status">Consultando mediciones del reporte…</p>}
  </details>
}

export function HistorialReportesPTAR({ actualizacion, compartido = false }: { actualizacion: string; compartido?: boolean }) {
  const grupoHistorial = useId()
  const [filtros, setFiltros] = useState<FiltrosReportesPTAR>({ desde: '', hasta: '', turno: 'todos' })
  const [pagina, setPagina] = useState(0), [intento, setIntento] = useState(0)
  const clave = `${filtros.desde}:${filtros.hasta}:${filtros.turno}:${pagina}:${intento}:${actualizacion}`
  const [resultado, setResultado] = useState<{ clave: string; filas: ResumenReportePTAR[]; hayMas: boolean; error: string | null } | null>(null)
  useEffect(() => {
    let vigente = true
    const control = new AbortController(), limite = window.setTimeout(() => control.abort(), 15000)
    void consultarHistorialReportesPTAR({ desde: filtros.desde, hasta: filtros.hasta, turno: filtros.turno }, pagina, control.signal, compartido).then(r => {
      if (vigente) setResultado({ ...r, clave, error: null })
    }).catch(e => { if (vigente) setResultado({ clave, filas: [], hayMas: false, error: control.signal.aborted ? 'La consulta tardó demasiado. Reintenta.'
      : e instanceof Error ? e.message : 'No se pudo consultar el historial técnico.' }) })
    return () => { vigente = false; window.clearTimeout(limite); control.abort() }
  }, [clave, filtros.desde, filtros.hasta, filtros.turno, pagina, compartido])
  const datos = resultado?.clave === clave ? resultado : null
  return <section className="bpt-historial-tecnico" aria-label="Reportes técnicos de PTAR">
    <div className="bpt-historial-cabecera"><h4>Reportes técnicos</h4><button type="button" className="boton-secundario"
      disabled={!datos} onClick={() => { setPagina(0); setIntento(n => n + 1) }}>Actualizar reportes</button></div>
    <div className="bpt-filtros-tecnicos">
      <label className="bpt-campo"><span>Desde</span><input type="date" value={filtros.desde}
        onChange={e => { setPagina(0); setFiltros(f => ({ ...f, desde: e.target.value })) }} /></label>
      <label className="bpt-campo"><span>Hasta</span><input type="date" value={filtros.hasta}
        onChange={e => { setPagina(0); setFiltros(f => ({ ...f, hasta: e.target.value })) }} /></label>
      <label className="bpt-campo"><span>Turno del reporte</span><select aria-label="Turno del reporte" value={filtros.turno}
        onChange={e => { setPagina(0); setFiltros(f => ({ ...f, turno: e.target.value as FiltrosReportesPTAR['turno'] })) }}>
        <option value="todos">Todos</option><option value="dia">Día</option><option value="tarde">Tarde</option><option value="noche">Noche</option>
      </select></label>
    </div>
    {!datos ? <p className="bpt-ayuda" role="status">Consultando reportes técnicos…</p> : datos.error ? <p className="bpt-ayuda" role="alert">{datos.error}</p>
      : datos.filas.length === 0 ? <p className="bpt-ayuda">No hay reportes técnicos para esta consulta.</p>
      : datos.filas.map(r => <ReporteHistorico key={`${r.id}:${r.revision}`} resumen={r} compartido={compartido} grupo={grupoHistorial} />)}
    {((datos && !datos.error && (pagina > 0 || datos.hayMas)) || pagina > 0) && <nav className="bpt-paginacion-tecnica" aria-label="Páginas de reportes técnicos">
      <button type="button" className="boton-secundario" disabled={!datos || pagina === 0} onClick={() => setPagina(n => n - 1)}>Anterior</button>
      <span>Página {pagina + 1}</span><button type="button" className="boton-secundario" disabled={!datos || !datos.hayMas} onClick={() => setPagina(n => n + 1)}>Siguiente</button>
    </nav>}
  </section>
}
