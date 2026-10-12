import './plantaReferencia.css'
import { useMemo, useState } from 'react'
import { usePlanta } from '../../hooks/usePlanta'
import { capturasPlanta, filtrarCapturas, filtrosInicialesPlanta, modulosPlanta, nombresModulo, nombresTurno, resumenCaptura, validarFiltrosPlanta } from '../../lib/planta'
import type { FiltrosPlanta, ModuloPlanta } from '../../lib/planta'
import { DetallePlanta } from './DetallePlanta'

const fecha = (v: string) => v.split('-').reverse().join('/')
const instante = (v: string) => new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v))
const nombreArea = (v: string) => v === 'calderas' ? 'Calderas' : 'PTAR'
export function PanelPlanta() {
  const [filtros, setFiltros] = useState<FiltrosPlanta>(() => filtrosInicialesPlanta())
  const [edicion, setEdicion] = useState(filtros)
  const [errorFiltro, setErrorFiltro] = useState<string | null>(null)
  const [modulo, setModulo] = useState<ModuloPlanta | 'todos'>('todos')
  const [busqueda, setBusqueda] = useState('')
  const [pagina, setPagina] = useState(1)
  const [detalle, setDetalle] = useState<string | null>(null)
  const { datos, cargando, error, actualizado, conectado, actualizar } = usePlanta(filtros)
  const capturas = useMemo(() => datos ? capturasPlanta(datos) : [], [datos])
  const visibles = useMemo(() => filtrarCapturas(capturas, modulo, busqueda), [capturas, modulo, busqueda])
  const paginas = Math.max(1, Math.ceil(visibles.length / 20)), actual = Math.min(pagina, paginas)
  const filas = visibles.slice((actual - 1) * 20, actual * 20)
  const problemas = datos ? [ ...(datos.turnos.error ? ['Turnos'] : []), ...modulosPlanta.filter(m => datos.fuentes[m].error).map(m => nombresModulo[m]) ] : []
  const incompletas = datos ? [ ...(datos.turnos.incompleta ? ['Turnos'] : []), ...modulosPlanta.filter(m => datos.fuentes[m].incompleta).map(m => nombresModulo[m]) ] : []
  function aplicar() {
    try { validarFiltrosPlanta(edicion); setErrorFiltro(null); setFiltros({ ...edicion }); setPagina(1); setDetalle(null) }
    catch (e) { setErrorFiltro(e instanceof Error ? e.message : 'Revisa los filtros.') }
  }
  return <div className="vista-planta">
    <section className="panel-informacion planta-filtros" aria-labelledby="filtros-planta">
      <div className="planta-encabezado"><div><h2 id="filtros-planta">Consulta de registros</h2></div><button type="button" className="boton-secundario" onClick={actualizar} disabled={cargando}>{cargando ? 'Consultando…' : 'Actualizar'}</button></div>
      <form onSubmit={e => { e.preventDefault(); aplicar() }} className="planta-formulario">
        <label>Desde<input type="date" required value={edicion.desde} onChange={e => setEdicion({ ...edicion, desde: e.target.value })} /></label>
        <label>Hasta<input type="date" required value={edicion.hasta} onChange={e => setEdicion({ ...edicion, hasta: e.target.value })} /></label>
        <label>Área<select value={edicion.area} onChange={e => setEdicion({ ...edicion, area: e.target.value as FiltrosPlanta['area'] })}><option value="todas">Ambas áreas</option><option value="calderas">Calderas</option><option value="ptar">PTAR</option></select></label>
        <label>Turno<select value={edicion.turno} onChange={e => setEdicion({ ...edicion, turno: e.target.value as FiltrosPlanta['turno'] })}><option value="todos">Todos los turnos</option>{Object.entries(nombresTurno).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>
        <button type="submit" className="boton-principal"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>Consultar</button>
      </form>
      {errorFiltro && <p className="mensaje-error" role="alert">{errorFiltro}</p>}
      <div className="planta-estado" aria-live="polite"><span className={`planta-indicador ${conectado ? 'conectado' : ''}`} />{conectado ? 'Conectado' : 'Actualización periódica cada 30 segundos'}<span>{actualizado ? `Última consulta: ${instante(actualizado)}` : 'Preparando consulta…'}</span></div>
      
    </section>

    {error && <p className="mensaje-error" role="alert">No se pudo actualizar. {datos ? 'Se conserva la consulta anterior; revisa la hora de actualización.' : 'Revisa tu conexión y pulsa Actualizar.'}</p>}
    {problemas.length > 0 && <p className="mensaje-error" role="alert">Consulta parcial: no se pudo cargar {problemas.join(', ')}. Pulsa Actualizar para reintentar.</p>}
    {incompletas.length > 0 && <p className="planta-aviso" role="status">Consulta limitada en {incompletas.join(', ')} (hasta 1,000 capturas por módulo). Reduce el período para consultar todos los registros.</p>}

    <section className="panel-informacion" aria-labelledby="historial-planta">
      <div className="planta-encabezado"><div><h2 id="historial-planta">Actividad y registros</h2></div><span className="estado-seccion">Solo consulta</span></div>
      <div className="planta-busqueda"><label>Módulo<select value={modulo} onChange={e => { setModulo(e.target.value as ModuloPlanta | 'todos'); setPagina(1); setDetalle(null) }}><option value="todos">Todos los módulos</option>{modulosPlanta.map(m => <option key={m} value={m}>{nombresModulo[m]}</option>)}</select></label><label>Buscar operador o contenido<input type="search" placeholder="Operador, punto de muestreo, nota…" value={busqueda} onChange={e => { setBusqueda(e.target.value); setPagina(1); setDetalle(null) }} /></label></div>
      <p className="ayuda-turno" aria-live="polite">{visibles.length} registros encontrados</p>
      <div className="planta-tabla-scroll"><table className="planta-tabla"><caption>Capturas ordenadas de la más reciente a la más antigua. Horarios de México.</caption><thead><tr><th scope="col">Fecha y hora</th><th scope="col">Área / turno</th><th scope="col">Operador</th><th scope="col">Módulo</th><th scope="col">Resumen</th><th scope="col">Detalle</th></tr></thead><tbody>
        {filas.map(e => {
          const clave = `${e.modulo}:${e.registro.lectura.id}`, abierto = detalle === clave
          return <FilaPlanta key={clave} captura={e} abierto={abierto} cambiar={() => setDetalle(abierto ? null : clave)} />
        })}
      </tbody></table></div>
      {!filas.length && <p className="planta-vacio">{cargando && !datos ? 'Consultando registros…' : !datos ? 'La consulta todavía no está disponible.' : problemas.length && !capturas.length ? 'No se pudieron consultar todas las fuentes. Actualiza para reintentar.' : 'No hay capturas que coincidan con esta consulta.'}</p>}
      <div className="planta-paginacion"><button type="button" className="boton-secundario" disabled={actual <= 1} onClick={() => { setPagina(actual - 1); setDetalle(null) }}>Anterior</button><span>Página {actual} de {paginas}</span><button type="button" className="boton-secundario" disabled={actual >= paginas} onClick={() => { setPagina(actual + 1); setDetalle(null) }}>Siguiente</button></div>
    </section>

    <details className="panel-informacion planta-turnos-adicionales"><summary>Turnos del período</summary>
      <div className="planta-turnos">{datos?.turnos.elementos.map(({ turno: t, operadorNombre }) => {
        const modulos = t.area === 'calderas' ? ['bitacora', 'pozos', 'uf', 'calidad'] as const : ['bitacora', 'ptar', 'calidad'] as const
        return <article className="planta-turno" key={t.id}><div className="planta-encabezado"><strong>{nombreArea(t.area)} · {nombresTurno[t.turno]}</strong><span className={`planta-etiqueta ${t.finalizado_en ? '' : 'abierto'}`}>{t.finalizado_en ? 'Cerrado' : 'Abierto'}</span></div><h3>{operadorNombre}</h3><p>{fecha(t.fecha_operativa)}</p><p className="ayuda-turno">Inicio: {instante(t.iniciado_en)}<br />Cierre: {t.finalizado_en ? instante(t.finalizado_en) : 'En curso'}</p><div className="planta-conteos">{modulos.map(m => <span key={m}>{nombresModulo[m]} <b>{datos.fuentes[m].error ? '?' : `${capturas.filter(c => c.modulo === m && c.registro.turno.id === t.id).length}${datos.fuentes[m].incompleta ? '+' : ''}`}</b></span>)}</div>{t.notas_cierre && <p className="notas-turno">Nota de cierre: {t.notas_cierre}</p>}</article>
      })}</div>
      {!datos?.turnos.elementos.length && <p>{datos?.turnos.error ? 'No se pudieron consultar los turnos.' : datos ? 'No hay turnos en este período.' : 'Consultando turnos…'}</p>}
    </details>
  </div>
}

function FilaPlanta({ captura: e, abierto, cambiar }: { captura: import('../../lib/planta').CapturaPlanta; abierto: boolean; cambiar: () => void }) {
  const l = e.registro.lectura, t = e.registro.turno, detalleId = `detalle-planta-${e.modulo}-${l.id}`
  return <><tr><td><time dateTime={l.capturado_en}>{instante(l.capturado_en)}</time><small>Operativa: {fecha(t.fecha_operativa)}</small></td><td>{nombreArea(t.area)}<small>{nombresTurno[t.turno]}</small></td><td>{e.registro.operadorNombre}</td><td><span className={`planta-modulo modulo-${e.modulo}`}>{nombresModulo[e.modulo]}</span></td><td><span className="planta-resumen-captura">{resumenCaptura(e)}</span></td><td><button type="button" className="boton-secundario" aria-expanded={abierto} aria-controls={detalleId} onClick={cambiar} aria-label={`${abierto ? 'Ocultar' : 'Ver'} captura de ${nombresModulo[e.modulo]}, ${e.registro.operadorNombre}, ${instante(l.capturado_en)}`}>{abierto ? 'Ocultar' : 'Ver'}</button></td></tr><tr hidden={!abierto} id={detalleId} className="planta-detalle"><td colSpan={6}>{abierto && <DetallePlanta captura={e} />}</td></tr></>
}
