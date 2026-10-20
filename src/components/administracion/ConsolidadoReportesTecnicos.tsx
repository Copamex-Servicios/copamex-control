import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { consultarDiasTecnicos } from '../../lib/consultarConsolidadoTecnico'
import { nombreAreaTecnica, nombreTurnoTecnico, seleccionarTecnicos, turnosConsolidado, validarConsolidado } from '../../lib/consolidadoTecnico'
import type { DiaTecnico } from '../../lib/consolidadoTecnico'
import { consultarTecnicoAdmin } from '../../lib/revisionTecnica'
import type { DetalleTecnicoAdmin, FilaTecnicaAdmin } from '../../lib/revisionTecnica'
import { exigirAdminRevision } from '../../lib/revisionCapturas'
import { descargarTecnicoDiario, descargarPdfTecnicoDiario } from '../../lib/exportarTecnicoDiario'
import type { FiltrosPlanta } from '../../lib/planta'
import type { AreaOperativa, TipoTurno } from '../../lib/tiposTurno'
import { DetalleReporteCalderasPlanta } from '../planta/DetalleReporteCalderasPlanta'
import { DetalleReportePTARPlanta } from '../planta/DetalleReportePTARPlanta'
import './consolidadoTecnico.css'

interface Props { cuenta: string; filtros: FiltrosPlanta; corregir: (fila: FilaTecnicaAdmin) => void }
const fecha = (s: string) => s.split('-').reverse().join('/')

export function ConsolidadoReportesTecnicos({ cuenta, filtros, corregir }: Props) {
  const grupoDias = useId()
  const [vista, setVista] = useState<{ dias: DiaTecnico[] | null; error: string | null }>({ dias: null, error: null })
  useEffect(() => {
    let vigente = true
    const control = new AbortController(), limite = window.setTimeout(() => control.abort(), 30000)
    void consultarDiasTecnicos(cuenta, filtros, control.signal)
      .then(dias => { if (vigente) setVista({ dias, error: null }) })
      .catch(e => { if (vigente) setVista({ dias: null, error: control.signal.aborted ? 'La consulta tardó demasiado. Vuelve a consultar.' : e instanceof Error ? e.message : 'No se pudieron consultar los reportes técnicos.' }) })
      .finally(() => window.clearTimeout(limite))
    return () => { vigente = false; control.abort(); window.clearTimeout(limite) }
  }, [cuenta, filtros])
  return <section className="panel-informacion consolidado-tecnico" aria-labelledby="consolidado-tecnico-titulo">
    <h2 id="consolidado-tecnico-titulo">Reportes técnicos por día</h2>
    {vista.error ? <p className="mensaje-error" role="alert">{vista.error}</p> : !vista.dias ? <p role="status">Consultando disponibilidad de los tres turnos…</p> : vista.dias.map(dia =>
      <details className="ct-dia" name={grupoDias} key={dia.fecha}>
        <summary><strong>{fecha(dia.fecha)}</strong><span>{filtros.area === 'todas' ? `Calderas: ${Object.keys(dia.calderas).length}/3 · PTAR: ${Object.keys(dia.ptar).length}/3` : `${nombreAreaTecnica(filtros.area)}: ${Object.keys(dia[filtros.area]).length}/3`} reportes</span></summary>
        <ContenidoDia cuenta={cuenta} dia={dia} filtros={filtros} corregir={corregir} />
      </details>)}
  </section>
}

function ContenidoDia({ cuenta, dia, filtros, corregir }: Omit<Props, 'filtros'> & { dia: DiaTecnico; filtros: FiltrosPlanta }) {
  const inicial = filtros.area === 'todas' ? 'calderas' : filtros.area
  const [area, setArea] = useState<AreaOperativa>(inicial)
  const seleccionInicial = (a: AreaOperativa) => turnosConsolidado.filter(t => !!dia[a][t] && (filtros.turno === 'todos' || filtros.turno === t))
  const [seleccion, setSeleccion] = useState<TipoTurno[]>(() => seleccionInicial(inicial))
  const [vista, setVista] = useState<{ id: string; detalle: DetalleTecnicoAdmin | null; error: string | null } | null>(null)
  const [exportando, setExportando] = useState(false), [errorExportacion, setErrorExportacion] = useState<string | null>(null)
  const activo = useRef(false)
  const cache = useRef(new Map<string, DetalleTecnicoAdmin>())
  const consultas = useRef(new Map<string, Promise<DetalleTecnicoAdmin>>())
  const controles = useRef(new Set<AbortController>())
  useEffect(() => {
    const actuales = controles.current
    return () => { for (const c of actuales) c.abort() }
  }, [])

  function cargar(fila: FilaTecnicaAdmin): Promise<DetalleTecnicoAdmin> {
    exigirAdminRevision(cuenta)
    const clave = `${fila.area}:${fila.id}`
    const guardado = cache.current.get(clave)
    if (guardado) return Promise.resolve(guardado)
    const consulta = consultas.current.get(clave)
    if (consulta) return consulta
    const control = new AbortController(), limite = window.setTimeout(() => control.abort(), 20000)
    controles.current.add(control)
    const peticion = consultarTecnicoAdmin(cuenta, fila, control.signal).then(detalle => {
      control.signal.throwIfAborted(); exigirAdminRevision(cuenta)
      validarConsolidado(dia.fecha, fila.area, [detalle])
      cache.current.set(clave, detalle)
      return detalle
    }).finally(() => { window.clearTimeout(limite); controles.current.delete(control); consultas.current.delete(clave) })
    consultas.current.set(clave, peticion)
    return peticion
  }

  async function ver(fila: FilaTecnicaAdmin, reintentar = false) {
    if (!reintentar && vista?.id === fila.id) { setVista(null); return }
    setVista({ id: fila.id, detalle: null, error: null })
    try {
      const detalle = await cargar(fila)
      setVista(v => v?.id === fila.id ? { id: fila.id, detalle, error: null } : v)
    } catch (e) { setVista(v => v?.id === fila.id ? { id: fila.id, detalle: null, error: e instanceof Error ? e.message : 'No se pudo consultar el reporte.' } : v) }
  }

  async function exportar(tipo: 'excel' | 'pdf') {
    if (activo.current) return
    activo.current = true; setExportando(true); setErrorExportacion(null)
    // Releer para exportar la revisión vigente, incluso tras una consulta previa.
    try {
      const filas = seleccionarTecnicos(dia, area, seleccion)
      if (!filas.length) throw new Error('Selecciona al menos un turno con reporte.')
      for (const f of filas) cache.current.delete(`${f.area}:${f.id}`)
      const detalles = await Promise.all(filas.map(cargar))
      exigirAdminRevision(cuenta); validarConsolidado(dia.fecha, area, detalles)
      const disponibles = turnosConsolidado.filter(t => !!dia[area][t])
      if (tipo === 'excel') descargarTecnicoDiario(dia.fecha, area, detalles, disponibles)
      else await descargarPdfTecnicoDiario(dia.fecha, area, detalles, disponibles, () => exigirAdminRevision(cuenta))
    } catch (e) { setErrorExportacion(e instanceof Error ? e.message : 'No se pudo preparar la exportación.') }
    finally { activo.current = false; setExportando(false) }
  }

  const disponibles = seleccionarTecnicos(dia, area, turnosConsolidado)
  return <div className="ct-contenido" aria-busy={exportando}>
    <div className="ct-barra">
      <label>Área<select aria-label={`Área del ${fecha(dia.fecha)}`} value={area} disabled={exportando} onChange={e => {
        const nueva = e.target.value as AreaOperativa
        setArea(nueva); setSeleccion(seleccionInicial(nueva)); setVista(null); setErrorExportacion(null)
      }}>{(filtros.area === 'todas' ? ['calderas', 'ptar'] as const : [filtros.area]).map(a => <option key={a} value={a}>{nombreAreaTecnica(a)}</option>)}</select></label>
      <div className="ct-acciones">
        <button type="button" className="boton-secundario" disabled={!disponibles.length || exportando} onClick={() => setSeleccion(disponibles.map(f => f.turno))}>Seleccionar disponibles</button>
        <button type="button" className="boton-principal ct-excel" disabled={!seleccion.length || exportando} onClick={() => { void exportar('excel') }}>Excel</button>
        <button type="button" className="boton-principal ct-pdf" disabled={!seleccion.length || exportando} onClick={() => { void exportar('pdf') }}>PDF</button>
      </div>
    </div>
    {exportando && <p role="status">Preparando los reportes seleccionados…</p>}
    {errorExportacion && <p role="alert" className="mensaje-error">{errorExportacion}</p>}
    <div className="ct-turnos">{turnosConsolidado.map(turno => {
      const fila = dia[area][turno], abierto = !!fila && vista?.id === fila.id
      const detalleId = `ct-${dia.fecha}-${area}-${turno}`
      return <Fragment key={turno}>
        <div className="ct-turno">
          <label><input type="checkbox" disabled={!fila || exportando} checked={!!fila && seleccion.includes(turno)} onChange={e => setSeleccion(s => e.target.checked ? [...s, turno] : s.filter(t => t !== turno))} /><strong>{nombreTurnoTecnico[turno]}</strong></label>
          <div className="ct-operador">{fila ? <><span>{fila.operador}</span><small>Revisión {fila.revision}{seleccion.includes(turno) ? '' : ' · No seleccionado'}</small></> : <span>Sin reporte</span>}</div>
          {fila && <div className="ct-acciones"><button type="button" className="boton-secundario" aria-expanded={abierto} aria-controls={detalleId} onClick={() => { void ver(fila) }}>{abierto ? 'Ocultar' : 'Ver'}</button><button type="button" className="boton-secundario" disabled={exportando} onClick={() => corregir(fila)}>Corrección administrativa</button></div>}
        </div>
        {abierto && <div className="ct-detalle" id={detalleId}>
          {!vista.detalle ? vista.error ? <><p role="alert" className="mensaje-error">{vista.error}</p><button type="button" className="boton-secundario" onClick={() => { void ver(fila, true) }}>Reintentar detalle</button></> : <p role="status">Consultando reporte completo…</p>
            : vista.detalle.area === 'calderas' ? <div className="bc-panel"><DetalleReporteCalderasPlanta reporte={vista.detalle.reporte} /></div> : <div className="bpt-panel"><DetalleReportePTARPlanta reporte={vista.detalle.reporte} /></div>}
        </div>}
      </Fragment>
    })}</div>
  </div>
}
