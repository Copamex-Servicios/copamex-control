import { Fragment, useEffect, useId, useState } from 'react'
import type { FiltrosPlanta } from '../../lib/planta'
import { nombresTurno } from '../../lib/planta'
import type { AreaOperativa } from '../../lib/tiposTurno'
import { consultarResumenesTecnicosPlanta } from '../../lib/reportesTecnicosPlanta'
import { consultarDetalleReporteCalderas } from '../../lib/bitacoraTecnicaCalderas'
import type { ReporteTecnicoCalderas, ResumenReporteCalderas } from '../../lib/bitacoraTecnicaCalderas'
import { consultarDetalleReportePTAR } from '../../lib/bitacoraTecnicaPTAR'
import type { ReporteTecnicoPTAR } from '../../lib/bitacoraTecnicaPTAR'
import { DetalleReporteCalderasPlanta } from './DetalleReporteCalderasPlanta'
import { DetalleReportePTARPlanta } from './DetalleReportePTARPlanta'
import '../bitacora/bitacoraCalderas.css'
import '../bitacora/bitacoraPTAR.css'

type Fila = ResumenReporteCalderas & { area: AreaOperativa }
type Detalle = { area: 'calderas'; reporte: ReporteTecnicoCalderas } | { area: 'ptar'; reporte: ReporteTecnicoPTAR }
const nombreArea = (a: AreaOperativa) => a === 'calderas' ? 'Calderas' : 'PTAR'

export function TablaReportesSupervision({ filtros, revision, alAbrir }: { filtros: FiltrosPlanta; revision: number; alAbrir?: (fila: Fila) => void }) {
  const id = useId()
  const [navegacion, setNavegacion] = useState({ filtro: '', pagina: 0 })
  const [recarga, setRecarga] = useState(0)
  const filtro = JSON.stringify([filtros, revision, recarga])
  const pagina = navegacion.filtro === filtro ? navegacion.pagina : 0
  const clave = `${filtro}:${pagina}`
  const [vista, setVista] = useState<{ clave: string; filas: Fila[]; mas: boolean; error: string | null } | null>(null)
  const [seleccion, setSeleccion] = useState<{ clave: string; fila: Fila } | null>(null)
  useEffect(() => {
    setSeleccion(null)
    let vivo = true
    const c = new AbortController(), limite = window.setTimeout(() => c.abort(), 20000)
    const areas: AreaOperativa[] = filtros.area === 'todas' ? ['calderas', 'ptar'] : [filtros.area]
    void Promise.all(areas.map(async area => {
      const filas: Fila[] = [], ids = new Set<string>()
      let mas = false
      // Cada fuente entrega páginas de 20. Lee solo el prefijo necesario para combinar ambas.
      for (let p = 0; p <= pagina; p++) {
        c.signal.throwIfAborted()
        const r = await consultarResumenesTecnicosPlanta(area, filtros, p, c.signal)
        for (const fila of r.filas) {
          if (ids.has(fila.id)) throw new Error('Los reportes cambiaron durante la consulta. Actualiza.')
          ids.add(fila.id); filas.push({ ...fila, area })
        }
        mas = r.hayMas
        if (!mas) break
        if (!r.filas.length) throw new Error('Consulta incompleta. Actualiza los reportes.')
      }
      return { filas, mas }
    })).then(resultados => {
      const filas = resultados.flatMap(r => r.filas).sort((a, b) => b.fechaOperativa.localeCompare(a.fechaOperativa) || b.creadoEn.localeCompare(a.creadoEn) || a.area.localeCompare(b.area) || a.id.localeCompare(b.id))
      if (vivo) setVista({ clave, filas: filas.slice(pagina * 20, (pagina + 1) * 20), mas: resultados.some(r => r.mas) || filas.length > (pagina + 1) * 20, error: null })
    }).catch(e => { if (vivo) setVista({ clave, filas: [], mas: false, error: c.signal.aborted ? 'La consulta tardó demasiado. Actualiza para reintentar.' : e instanceof Error ? e.message : 'No se pudieron consultar los reportes.' }) })
      .finally(() => window.clearTimeout(limite))
    return () => { vivo = false; c.abort(); window.clearTimeout(limite) }
  }, [clave, filtros, pagina])
  const actual = vista?.clave === clave ? vista : null
  const elegido = seleccion?.clave === clave ? seleccion.fila : null
  return <section className="panel-informacion supervision-tecnicos">
    <div className="planta-encabezado"><h2>Reportes técnicos</h2><button type="button" className="boton-secundario" disabled={!actual} onClick={() => setRecarga(n => n + 1)}>Actualizar reportes</button></div>
    <div className="planta-tabla-scroll"><table className="planta-tabla supervision-tabla-tecnicos"><caption>Reportes técnicos por fecha operativa; hasta 20 por página.</caption><thead><tr><th>Fecha</th><th>Turno</th><th>Área</th><th>Operador</th><th>Acciones</th></tr></thead><tbody>
      {actual?.filas.map(r => {
        const abierto = !alAbrir && elegido?.id === r.id && elegido.area === r.area
        const detalleId = `${id}-detalle-${r.area}-${r.id}`
        return <Fragment key={`${r.area}:${r.id}`}>
          <tr className="supervision-fila-reporte"><td data-label="Fecha">{r.fechaOperativa.split('-').reverse().join('/')}</td><td data-label="Turno">{nombresTurno[r.turno]}</td><td data-label="Área">{nombreArea(r.area)}</td><td data-label="Operador">{r.operador}</td><td><button id={`${detalleId}-boton`} type="button" className="boton-secundario" aria-expanded={alAbrir ? undefined : abierto} aria-controls={alAbrir ? undefined : detalleId} onClick={() => alAbrir ? alAbrir(r) : setSeleccion(abierto ? null : { clave, fila: r })}>Ver</button></td></tr>
          {abierto && <tr className="supervision-fila-detalle"><td colSpan={5}><div id={detalleId}><DetalleSeleccionado fila={r} cerrar={() => { setSeleccion(null); document.getElementById(`${detalleId}-boton`)?.focus() }} /></div></td></tr>}
        </Fragment>
      })}
    </tbody></table></div>
    {!actual ? <p role="status">Consultando reportes…</p> : actual.error ? <p role="alert" className="mensaje-error">{actual.error}</p> : !actual.filas.length && <p>No hay reportes técnicos para esta consulta.</p>}
    <nav className="planta-paginacion" aria-label="Páginas de reportes técnicos"><span>{actual && !actual.error ? `${actual.filas.length} reportes en esta página` : ''}</span><button className="boton-secundario" type="button" disabled={!actual || pagina === 0} onClick={() => setNavegacion({ filtro, pagina: pagina - 1 })}>Anterior</button><span>Página {pagina + 1}</span><button className="boton-secundario" type="button" disabled={!actual?.mas} onClick={() => setNavegacion({ filtro, pagina: pagina + 1 })}>Siguiente</button></nav>
  </section>
}

function DetalleSeleccionado({ fila, cerrar }: { fila: Fila; cerrar: () => void }) {
  const [intento, setIntento] = useState(0)
  const [vista, setVista] = useState<{ intento: number; detalle: Detalle | null; error: string | null } | null>(null)
  useEffect(() => {
    let vivo = true
    const c = new AbortController(), limite = window.setTimeout(() => c.abort(), 15000)
    const cargar = async (): Promise<Detalle> => fila.area === 'calderas'
      ? { area: 'calderas', reporte: await consultarDetalleReporteCalderas(fila.id, fila.turnoId, c.signal, true) }
      : { area: 'ptar', reporte: await consultarDetalleReportePTAR(fila.id, fila.turnoId, c.signal, true) }
    void cargar().then(detalle => { if (vivo) setVista({ intento, detalle, error: null }) })
      .catch(e => { if (vivo) setVista({ intento, detalle: null, error: c.signal.aborted ? 'La consulta tardó demasiado.' : e instanceof Error ? e.message : 'No se pudo consultar el reporte.' }) }).finally(() => window.clearTimeout(limite))
    return () => { vivo = false; c.abort(); window.clearTimeout(limite) }
  }, [fila, intento])
  const actual = vista?.intento === intento ? vista : null
  return <section className="supervision-detalle-reporte" aria-label={`Detalle técnico de ${nombreArea(fila.area)}`}>
    <div className="planta-encabezado"><div><h3>Reporte técnico de {nombreArea(fila.area)}</h3><p>{fila.fechaOperativa.split('-').reverse().join('/')} · {nombresTurno[fila.turno]} · {fila.operador}</p></div><button type="button" className="boton-secundario" onClick={cerrar}>Cerrar detalle</button></div>
    {!actual ? <p role="status">Consultando mediciones del reporte…</p> : actual.error ? <><p role="alert" className="mensaje-error">{actual.error}</p><button type="button" className="boton-secundario" onClick={() => setIntento(n => n + 1)}>Reintentar detalle</button></> : actual.detalle?.area === 'calderas' ? <div className="bc-panel"><DetalleReporteCalderasPlanta reporte={actual.detalle.reporte} /></div> : actual.detalle?.area === 'ptar' ? <div className="bpt-panel"><DetalleReportePTARPlanta reporte={actual.detalle.reporte} /></div> : null}
  </section>
}
