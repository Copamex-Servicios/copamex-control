import { ConsultaMuestrasCalidad } from '../calidad/ConsultaMuestrasCalidad'
import { RefreshCw } from 'lucide-react'
import './plantaReferencia.css'
import { ReportesTecnicosPlanta } from './ReportesTecnicosPlanta'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ResumenHistorial } from '../diseno/ResumenHistorial'
import '../diseno/acordeonHistorial.css'
import { usePlanta } from '../../hooks/usePlanta'
import { capturasPlanta, filtrarCapturas, filtrosInicialesPlanta, modulosPlanta, nombresModulo, nombresTurno, validarFiltrosPlanta } from '../../lib/planta'
import type { FiltrosPlanta, ModuloPlanta } from '../../lib/planta'
import { DetallePlanta } from './DetallePlanta'
import { useAuth } from '../../hooks/useAuth'
import { PanelSupervisionPlanta } from './PanelSupervisionPlanta'

const instante = (v: string) => new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v))
const nombreArea = (v: string) => v === 'calderas' ? 'Calderas' : 'PTAR'
export function PanelPlanta() {
  const { perfil } = useAuth()
  return perfil?.rol === 'admin' ? <PanelSupervisionPlanta /> : <ConsultaPlantaOperativa />
}

function ConsultaPlantaOperativa() {
  const id = useId()
  const [pestana, setPestana] = useState<'reportes' | 'registros' | 'calidad'>('reportes')
  const [calidadAbierta, setCalidadAbierta] = useState(false)
  const [filtros, setFiltros] = useState<FiltrosPlanta>(() => filtrosInicialesPlanta())
  const [edicion, setEdicion] = useState(filtros)
  const [errorFiltro, setErrorFiltro] = useState<string | null>(null)
  const [modulo, setModulo] = useState<ModuloPlanta | 'todos'>('todos')
  const [busqueda, setBusqueda] = useState('')
  const [pagina, setPagina] = useState(1)
  const [detalle, setDetalle] = useState<string | null>(null)
  const { datos, cargando, error, actualizado, conectado, actualizar } = usePlanta(filtros)
  const capturas = useMemo(() => datos ? capturasPlanta(datos).filter(c => c.modulo !== 'calidad') : [], [datos])
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
    <div className="pestanas-modulos" role="tablist" aria-label="Consultas de la operación">
      {([['reportes', 'Reportes técnicos'], ['registros', 'Consulta de registros'], ['calidad', 'Calidad de agua']] as const).map(([clave, nombre], indice) => <button
        key={clave} type="button" role="tab" id={`${id}-${clave}-tab`} aria-controls={`${id}-${clave}`}
        aria-selected={pestana === clave} tabIndex={pestana === clave ? 0 : -1} onClick={() => { setPestana(clave); if (clave === 'calidad') setCalidadAbierta(true) }}
        onKeyDown={e => {
          let siguiente: number | null = null
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') siguiente = (indice + (e.key === 'ArrowRight' ? 1 : 2)) % 3
          if (e.key === 'Home') siguiente = 0
          if (e.key === 'End') siguiente = 2
          if (siguiente === null) return
          e.preventDefault(); setPestana((['reportes', 'registros', 'calidad'] as const)[siguiente]); if (siguiente === 2) setCalidadAbierta(true)
          e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[siguiente]?.focus()
        }}>{nombre}</button>)}
    </div>
    <div id={`${id}-reportes`} role="tabpanel" aria-labelledby={`${id}-reportes-tab`} hidden={pestana !== 'reportes'}>
      <ReportesTecnicosPlanta />
    </div>
    <div id={`${id}-calidad`} role="tabpanel" aria-labelledby={`${id}-calidad-tab`} hidden={pestana !== 'calidad'}>
      {calidadAbierta && <ConsultaMuestrasCalidad />}
    </div>
    <div id={`${id}-registros`} role="tabpanel" aria-labelledby={`${id}-registros-tab`} hidden={pestana !== 'registros'}>
    <div className="vista-planta">
    <section className="panel-informacion planta-filtros" aria-labelledby="filtros-planta">
      <div className="planta-encabezado"><div><h2 id="filtros-planta">Consulta de registros</h2></div><button type="button" className="boton-secundario" onClick={actualizar} disabled={cargando} data-actualizar="true" aria-label={cargando ? 'Consultando…' : 'Actualizar'} title="Actualizar"><RefreshCw size={18} style={{ width: 18, height: 18, flexShrink: 0 }} aria-hidden="true" /></button></div>
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
      <div className="planta-encabezado"><div><h2 id="historial-planta">Actividad y registros</h2></div></div>
      <div className="planta-busqueda"><label>Módulo<select value={modulo} onChange={e => { setModulo(e.target.value as ModuloPlanta | 'todos'); setPagina(1); setDetalle(null) }}><option value="todos">Todos los módulos</option>{modulosPlanta.filter(m => m !== 'ptar' && m !== 'calidad').map(m => <option key={m} value={m}>{nombresModulo[m]}</option>)}</select></label><label>Buscar operador o contenido<input type="search" placeholder="Operador o captura técnica…" value={busqueda} onChange={e => { setBusqueda(e.target.value); setPagina(1); setDetalle(null) }} /></label></div>
      <p className="ayuda-turno" aria-live="polite">{visibles.length} registros encontrados</p>
      <div className="planta-registros-desplegables">
        {filas.map(e => {
          const clave = `${e.modulo}:${e.registro.lectura.id}`, abierto = detalle === clave
          return <FilaPlanta key={clave} captura={e} abierto={abierto} grupo={`${id}-capturas`} cambiar={abrir => setDetalle(actual => abrir ? clave : actual === clave ? null : actual)} />
        })}
      </div>
      {!filas.length && <p className="planta-vacio">{cargando && !datos ? 'Consultando registros…' : !datos ? 'La consulta todavía no está disponible.' : problemas.length && !capturas.length ? 'No se pudieron consultar todas las fuentes. Actualiza para reintentar.' : 'No hay capturas que coincidan con esta consulta.'}</p>}
      <div className="planta-paginacion"><button type="button" className="boton-secundario" disabled={actual <= 1} onClick={() => { setPagina(actual - 1); setDetalle(null) }}>Anterior</button><span>Página {actual} de {paginas}</span><button type="button" className="boton-secundario" disabled={actual >= paginas} onClick={() => { setPagina(actual + 1); setDetalle(null) }}>Siguiente</button></div>
    </section>
    </div>
    </div>
  </div>
}

function FilaPlanta({ captura: e, abierto, cambiar, grupo }: { captura: import('../../lib/planta').CapturaPlanta; abierto: boolean; cambiar: (abrir: boolean) => void; grupo: string }) {
  const elemento = useRef<HTMLDetailsElement>(null)
  const l = e.registro.lectura, t = e.registro.turno
  useEffect(() => {
    if (!abierto) return
    const temporizador = window.setTimeout(() => elemento.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }), 260)
    return () => window.clearTimeout(temporizador)
  }, [abierto])
  return <details ref={elemento} className="planta-registro-desplegable co-acordeon-historial" name={grupo} open={abierto}
    onToggle={e => { if (e.currentTarget.open !== abierto) cambiar(e.currentTarget.open) }}>
    <ResumenHistorial fecha={t.fecha_operativa} titulo={e.modulo==='pozos'?'Lectura de pozos':e.modulo==='uf'?`Lectura de ultrafiltración · ${nombreArea(t.area)}`:nombresModulo[e.modulo]} operador={e.registro.operadorNombre} turno={t.turno}
      adicional={e.modulo==='pozos'||e.modulo==='uf'?undefined:`${nombreArea(t.area)} · Captura: ${instante(l.capturado_en)}`} />
    {abierto && <div className="planta-registro-contenido"><DetallePlanta captura={e} /></div>}
  </details>
}
