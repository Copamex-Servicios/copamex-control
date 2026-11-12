import { useEffect, useId, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { consultarGruposMuestras, consultarPaginaMuestras, ordenarMuestrasCalidad, validarFiltrosMuestras } from '../../lib/consultaMuestrasCalidad'
import type { FiltrosMuestrasCalidad } from '../../lib/consultaMuestrasCalidad'
import type { TurnoPlanta } from '../../lib/planta'
import type { RegistroCalidad } from '../../lib/tiposCalidad'
import type { AreaOperativa } from '../../lib/tiposTurno'
import { fechaHoraCalidad } from '../../lib/formatoCalidad'
import { ExportacionDiaCalidad } from './ExportacionDiaCalidad'
import { ResumenHistorial } from '../diseno/ResumenHistorial'
import { LecturaCalidadGuardada } from './LecturaCalidadGuardada'
import '../diseno/acordeonHistorial.css'
import './calidadReferencia.css'
import './consultaMuestrasCalidad.css'

interface Props {
  titulo?: string; areaFija?: AreaOperativa; filtrosIniciales?: FiltrosMuestrasCalidad; actualizacion?: string
  exportable?: boolean
  exportacionDiaria?: boolean
}
const nombreArea = (area: AreaOperativa) => area === 'calderas' ? 'Calderas' : 'PTAR'
const turnos = { dia: 'Día', tarde: 'Tarde', noche: 'Noche' }

export function ConsultaMuestrasCalidad(props: Props) {
  const { estado, sesion, perfil } = useAuthStore()
  if (estado !== 'autenticado' || !perfil?.activo || perfil.id !== sesion?.user.id
    || !['admin', 'calidad', 'calderas', 'ptar'].includes(perfil.rol)) return null
  const clave = JSON.stringify([perfil.id, perfil.rol, props.areaFija, props.filtrosIniciales, props.actualizacion])
  const puedeExportar = perfil.rol === 'admin' || perfil.rol === 'calidad'
  return <ConsultaCuenta key={clave} {...props} exportable={puedeExportar && props.exportable} exportacionDiaria={puedeExportar && props.exportacionDiaria} />
}

function ConsultaCuenta({ titulo = 'Calidad de agua', areaFija, filtrosIniciales, exportable = false, exportacionDiaria = false }: Props) {
  const inicial = { desde: '', hasta: '', area: areaFija ?? 'todas', turno: 'todos', ...filtrosIniciales } as FiltrosMuestrasCalidad
  if (areaFija) inicial.area = areaFija
  const [edicion, setEdicion] = useState(inicial), [filtros, setFiltros] = useState(inicial)
  const [revision, setRevision] = useState(0), [error, setError] = useState<string | null>(null)
  return <section className="panel-informacion calidad-consulta-agrupada" aria-label={titulo}>
    <div className="planta-encabezado"><h3>{titulo}</h3><button type="button" className="boton-secundario" aria-label="Actualizar muestras de Calidad" title="Actualizar muestras" onClick={() => setRevision(n => n + 1)}><RefreshCw size={18} aria-hidden="true" /></button></div>
    <form className="cmc-filtros" onSubmit={e => {
      e.preventDefault()
      try { validarFiltrosMuestras(edicion); setFiltros({ ...edicion }); setRevision(n => n + 1); setError(null) }
      catch (fallo) { setError(fallo instanceof Error ? fallo.message : 'Revisa los filtros.') }
    }}>
      <label>Desde<input type="date" value={edicion.desde} onChange={e => setEdicion({ ...edicion, desde: e.target.value })} /></label>
      <label>Hasta<input type="date" value={edicion.hasta} onChange={e => setEdicion({ ...edicion, hasta: e.target.value })} /></label>
      {!areaFija && <label>Área<select value={edicion.area} onChange={e => setEdicion({ ...edicion, area: e.target.value as FiltrosMuestrasCalidad['area'] })}><option value="todas">Ambas áreas</option><option value="calderas">Calderas</option><option value="ptar">PTAR</option></select></label>}
      <label>Turno<select value={edicion.turno} onChange={e => setEdicion({ ...edicion, turno: e.target.value as FiltrosMuestrasCalidad['turno'] })}><option value="todos">Todos</option>{Object.entries(turnos).map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}</select></label>
      <button type="submit" className="boton-principal">Consultar</button>
    </form>
    {exportacionDiaria && <ExportacionDiaCalidad fechaInicial={filtros.desde} areaInicial={filtros.area==='ptar'?'ptar':'calderas'}/>}
    {error && <p role="alert" className="mensaje-error">{error}</p>}
    <ResultadosMuestras key={JSON.stringify([filtros, revision])} filtros={filtros} exportable={exportable} />
  </section>
}

function ResultadosMuestras({ filtros, exportable }: { filtros: FiltrosMuestrasCalidad; exportable: boolean }) {
  const nombreGrupo = useId()
  const [pagina, setPagina] = useState(0)
  const [vista, setVista] = useState<{ pagina: number; datos: Awaited<ReturnType<typeof consultarGruposMuestras>> | null; error: string | null } | null>(null)
  useEffect(() => {
    let vigente = true
    const control = new AbortController(), limite = window.setTimeout(() => control.abort(), 20000)
    void consultarGruposMuestras(filtros, pagina, control.signal)
      .then(datos => { if (vigente) setVista({ pagina, datos, error: null }) })
      .catch(e => { if (vigente) setVista({ pagina, datos: null, error: control.signal.aborted ? 'La consulta tardó demasiado. Pulsa Actualizar muestras para reintentar.' : e instanceof Error ? e.message : 'No se pudo consultar Calidad.' }) })
      .finally(() => window.clearTimeout(limite))
    return () => { vigente = false; control.abort(); window.clearTimeout(limite) }
  }, [filtros, pagina])
  const actual = vista?.pagina === pagina ? vista : null
  return <>
    {!actual ? <p role="status">Consultando turnos con muestras…</p> : actual.error ? <p role="alert" className="mensaje-error">{actual.error}</p> : <>
      {actual.datos?.grupos.map(grupo => <GrupoMuestras key={grupo.turno.id} grupo={grupo} nombreGrupo={nombreGrupo} exportable={exportable} />)}
      {!actual.datos?.grupos.length && <p>No hay muestras para esta consulta.</p>}
    </>}
    <nav className="cmc-paginacion" aria-label="Páginas de turnos de Calidad"><button type="button" className="boton-secundario" disabled={!actual || pagina === 0} onClick={() => setPagina(n => n - 1)}>Anterior</button><span>Página {pagina + 1}</span><button type="button" className="boton-secundario" disabled={!actual?.datos?.hayMas} onClick={() => setPagina(n => n + 1)}>Siguiente</button></nav>
  </>
}

type DatosMuestras = { muestras: RegistroCalidad[]; total: number; hayMas: boolean }
interface PropsGrupo {
  grupo: TurnoPlanta; nombreGrupo: string
  exportable: boolean
}
function GrupoMuestras({ grupo, nombreGrupo, exportable }: PropsGrupo) {
  const nombreMuestras = useId()
  const [abierto, setAbierto] = useState(false), [pagina, setPagina] = useState(0), [intento, setIntento] = useState(0)
  const [vista, setVista] = useState<{ clave: string; datos: DatosMuestras | null; error: string | null } | null>(null)
  const acumulado = useRef<DatosMuestras | null>(null), ultima = useRef('')
  const clave = `${pagina}:${intento}`
  useEffect(() => {
    if (!abierto || ultima.current === clave) return
    let vigente = true
    const control = new AbortController(), limite = window.setTimeout(() => control.abort(), 20000)
    void consultarPaginaMuestras(grupo, pagina, control.signal).then(lote => {
      if (!vigente) return
      const anterior = pagina === 0 ? null : acumulado.current
      if (pagina > 0 && (!anterior || anterior.total !== lote.total)) throw new Error('Las muestras cambiaron durante la consulta. Actualiza el turno.')
      const datos = { ...lote, muestras: ordenarMuestrasCalidad([...(anterior?.muestras ?? []), ...lote.muestras]) }
      if (datos.muestras.length > datos.total) throw new Error('La consulta cambió. Actualiza el turno.')
      acumulado.current = datos; ultima.current = clave
      setVista({ clave, datos, error: null })
    }).catch(e => {
      if (vigente) { ultima.current = clave; setVista({ clave, datos: acumulado.current, error: control.signal.aborted ? 'La consulta tardó demasiado. Reintenta.' : e instanceof Error ? e.message : 'No se pudieron cargar las muestras.' }) }
    }).finally(() => window.clearTimeout(limite))
    return () => { vigente = false; control.abort(); window.clearTimeout(limite) }
  }, [abierto, clave, grupo, pagina])
  const cargando = abierto && vista?.clave !== clave, datos = vista?.datos
  return <details className="cmc-grupo co-acordeon-historial" name={nombreGrupo} open={abierto} onToggle={e => { if (e.currentTarget.open !== abierto) setAbierto(e.currentTarget.open) }}>
    <ResumenHistorial fecha={grupo.turno.fecha_operativa} titulo={`Calidad de agua · ${nombreArea(grupo.turno.area)}`} operador={grupo.operadorNombre} turno={grupo.turno.turno} />
    {abierto && <div className="cmc-contenido">
      {datos?.muestras.map(registro => <div className="cmc-muestra" key={registro.lectura.id}>
        <DetalleMuestra registro={registro} exportable={exportable} nombreGrupo={nombreMuestras} />
      </div>)}
      {cargando && <p role="status">Cargando muestras…</p>}
      {vista?.clave === clave && vista.error && <div><p role="alert" className="mensaje-error">{vista.error}</p><button type="button" className="boton-secundario" onClick={() => setIntento(n => n + 1)}>Reintentar muestras</button></div>}
      {!cargando && !vista?.error && datos?.hayMas && <button type="button" className="boton-secundario" onClick={() => setPagina(n => n + 1)}>Cargar más muestras</button>}
    </div>}
  </details>
}

function DetalleMuestra({ registro, exportable, nombreGrupo }: { registro: RegistroCalidad; exportable: boolean; nombreGrupo: string }) {
  const [visitado, setVisitado] = useState(false)
  return <details className="cmc-detalle co-acordeon-historial" name={nombreGrupo} onToggle={e => { if (e.currentTarget.open) setVisitado(true) }}>
    <summary onClick={() => setVisitado(true)}><span><strong>Hora de registro</strong> <time dateTime={registro.lectura.capturado_en}>{fechaHoraCalidad(registro.lectura.capturado_en)}</time><small>{registro.lectura.resultados.length} resultados</small></span><span className="cmc-ver">Ver</span><span className="cmc-ocultar">Ocultar</span></summary>
    {visitado && <LecturaCalidadGuardada registro={registro} historial compacta exportable={exportable} />}
  </details>
}
