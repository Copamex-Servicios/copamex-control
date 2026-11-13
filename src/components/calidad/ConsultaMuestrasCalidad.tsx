import { useEffect, useId, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { consultarGruposMuestras, consultarPaginaMuestras, consultarAdicionalesTurnoCalidad, ordenarMuestrasCalidad, validarFiltrosMuestras } from '../../lib/consultaMuestrasCalidad'
import type { FiltrosMuestrasCalidad } from '../../lib/consultaMuestrasCalidad'
import type { TurnoPlanta } from '../../lib/planta'
import type { RegistroCalidad } from '../../lib/tiposCalidad'
import type { AreaOperativa } from '../../lib/tiposTurno'
import { fechaHoraCalidad } from '../../lib/formatoCalidad'
import { consultarLecturaCalidad } from '../../lib/calidad'
import { hojasRegistroCalidad } from '../../lib/hojaRegistroCalidad'
import { ExportacionDiaCalidad } from './ExportacionDiaCalidad'
import { ResumenHistorial } from '../diseno/ResumenHistorial'
import { LecturaCalidadGuardada } from './LecturaCalidadGuardada'
import { PaginacionHistorial } from '../diseno/PaginacionHistorial'
import '../diseno/acordeonHistorial.css'
import './calidadReferencia.css'
import './consultaMuestrasCalidad.css'

interface Props {
  titulo?: string; areaFija?: AreaOperativa; filtrosIniciales?: FiltrosMuestrasCalidad; actualizacion?: string
  exportable?: boolean
  exportacionDiaria?: boolean
  ocultarFiltros?: boolean
}
const nombreArea = (area: AreaOperativa) => area === 'calderas' ? 'Calderas' : 'PTAR'
const turnos = { dia: 'Día', tarde: 'Tarde', noche: 'Noche' }

export function ConsultaMuestrasCalidad(props: Props) {
  const { estado, sesion, perfil } = useAuthStore()
  if (estado !== 'autenticado' || !perfil?.activo || perfil.id !== sesion?.user.id
    || !['admin', 'calidad', 'calderas', 'ptar'].includes(perfil.rol)) return null
  const clave = JSON.stringify([perfil.id, perfil.rol, props.areaFija, props.filtrosIniciales, props.actualizacion])
  const puedeExportar = perfil.rol === 'admin' || perfil.rol === 'calidad'
  return <ConsultaCuenta key={clave} {...props} tamanoPagina={perfil.rol === 'calderas' || perfil.rol === 'ptar' ? 7 : 10} exportable={puedeExportar && props.exportable} exportacionDiaria={puedeExportar && props.exportacionDiaria} />
}

function ConsultaCuenta({ titulo = 'Calidad de agua', areaFija, filtrosIniciales, tamanoPagina = 10, exportable = false, exportacionDiaria = false, ocultarFiltros = false }: Props & { tamanoPagina?: number }) {
  const inicial = { desde: '', hasta: '', area: areaFija ?? 'todas', turno: 'todos', ...filtrosIniciales } as FiltrosMuestrasCalidad
  if (areaFija) inicial.area = areaFija
  const [edicion, setEdicion] = useState(inicial), [filtros, setFiltros] = useState(inicial)
  const [revision, setRevision] = useState(0), [error, setError] = useState<string | null>(null)
  return <section className="panel-informacion calidad-consulta-agrupada" aria-label={titulo}>
    <div className="planta-encabezado"><h3>{titulo}</h3><button type="button" className="boton-secundario" aria-label="Actualizar muestras de Calidad" title="Actualizar muestras" onClick={() => setRevision(n => n + 1)}><RefreshCw size={18} aria-hidden="true" /></button></div>
    {!ocultarFiltros && <form className="cmc-filtros" onSubmit={e => {
      e.preventDefault()
      try { validarFiltrosMuestras(edicion); setFiltros({ ...edicion }); setRevision(n => n + 1); setError(null) }
      catch (fallo) { setError(fallo instanceof Error ? fallo.message : 'Revisa los filtros.') }
    }}>
      <label>Desde<input type="date" value={edicion.desde} onChange={e => setEdicion({ ...edicion, desde: e.target.value })} /></label>
      <label>Hasta<input type="date" value={edicion.hasta} onChange={e => setEdicion({ ...edicion, hasta: e.target.value })} /></label>
      {!areaFija && <label>Área<select value={edicion.area} onChange={e => setEdicion({ ...edicion, area: e.target.value as FiltrosMuestrasCalidad['area'] })}><option value="todas">Ambas áreas</option><option value="calderas">Calderas</option><option value="ptar">PTAR</option></select></label>}
      <label>Turno<select value={edicion.turno} onChange={e => setEdicion({ ...edicion, turno: e.target.value as FiltrosMuestrasCalidad['turno'] })}><option value="todos">Todos</option>{Object.entries(turnos).map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}</select></label>
      <button type="submit" className="boton-principal">Consultar</button>
    </form>}
    {exportacionDiaria && <ExportacionDiaCalidad fechaInicial={filtros.desde} areaInicial={filtros.area==='ptar'?'ptar':'calderas'}/>}
    {error && <p role="alert" className="mensaje-error">{error}</p>}
    <ResultadosMuestras key={JSON.stringify([filtros, revision, tamanoPagina])} filtros={filtros} exportable={exportable} tamanoPagina={tamanoPagina} />
  </section>
}

function ResultadosMuestras({ filtros, exportable, tamanoPagina }: { filtros: FiltrosMuestrasCalidad; exportable: boolean; tamanoPagina: number }) {
  const nombreGrupo = useId()
  const [pagina, setPagina] = useState(0)
  const [vista, setVista] = useState<{ pagina: number; datos: Awaited<ReturnType<typeof consultarGruposMuestras>> | null; error: string | null } | null>(null)
  useEffect(() => {
    let vigente = true
    const control = new AbortController(), limite = window.setTimeout(() => control.abort(), 20000)
    void consultarGruposMuestras(filtros, pagina, control.signal, tamanoPagina)
      .then(datos => { if (vigente) setVista({ pagina, datos, error: null }) })
      .catch(e => { if (vigente) setVista({ pagina, datos: null, error: control.signal.aborted ? 'La consulta tardó demasiado. Pulsa Actualizar muestras para reintentar.' : e instanceof Error ? e.message : 'No se pudo consultar Calidad.' }) })
      .finally(() => window.clearTimeout(limite))
    return () => { vigente = false; control.abort(); window.clearTimeout(limite) }
  }, [filtros, pagina, tamanoPagina])
  const actual = vista?.pagina === pagina ? vista : null
  return <>
    {!actual ? <p role="status">Consultando turnos con muestras…</p> : actual.error ? <p role="alert" className="mensaje-error">{actual.error}</p> : <>
      {actual.datos?.grupos.map(grupo => <GrupoMuestras key={grupo.turno.id} grupo={grupo} nombreGrupo={nombreGrupo} exportable={exportable} />)}
      {!actual.datos?.grupos.length && <p>No hay muestras para esta consulta.</p>}
    </>}
    {((pagina > 0) || !!actual?.datos?.hayMas) && <PaginacionHistorial etiqueta="Calidad de agua" pagina={pagina}
      anterior={() => setPagina(n => n - 1)} siguiente={() => setPagina(n => n + 1)}
      hayAnterior={pagina > 0} haySiguiente={!!actual?.datos?.hayMas} />}
  </>
}

type DatosMuestras = { muestras: RegistroCalidad[]; total: number; hayMas: boolean; ultimaHabitual: RegistroCalidad | null; adicionales: RegistroCalidad[] }
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
    void Promise.all([
      consultarPaginaMuestras(grupo, pagina, control.signal),
      pagina === 0 ? consultarLecturaCalidad(grupo.turno.id,control.signal) : Promise.resolve(acumulado.current?.ultimaHabitual ?? null),
      pagina === 0 ? consultarAdicionalesTurnoCalidad(grupo,control.signal) : Promise.resolve(acumulado.current?.adicionales ?? []),
    ]).then(([lote,ultimaHabitual,adicionales]) => {
      if (!vigente) return
      const anterior = pagina === 0 ? null : acumulado.current
      if (pagina > 0 && (!anterior || anterior.total !== lote.total)) throw new Error('Las muestras cambiaron durante la consulta. Actualiza el turno.')
      const datos = { ...lote, ultimaHabitual, adicionales, muestras: ordenarMuestrasCalidad([...(anterior?.muestras ?? []), ...lote.muestras]) }
      if (datos.muestras.length > datos.total) throw new Error('La consulta cambió. Actualiza el turno.')
      acumulado.current = datos; ultima.current = clave
      setVista({ clave, datos, error: null })
    }).catch(e => {
      if (vigente) { ultima.current = clave; setVista({ clave, datos: acumulado.current, error: control.signal.aborted ? 'La consulta tardó demasiado. Reintenta.' : e instanceof Error ? e.message : 'No se pudieron cargar las muestras.' }) }
    }).finally(() => window.clearTimeout(limite))
    return () => { vigente = false; control.abort(); window.clearTimeout(limite) }
  }, [abierto, clave, grupo, pagina])
  const cargando = abierto && vista?.clave !== clave, datos = vista?.datos
  const hojas = hojasRegistroCalidad(datos?.muestras ?? [],datos?.ultimaHabitual ?? null,datos?.adicionales ?? [])
  return <details className="cmc-grupo co-acordeon-historial" name={nombreGrupo} open={abierto} onToggle={e => { if (e.currentTarget.open !== abierto) setAbierto(e.currentTarget.open) }}>
    <ResumenHistorial fecha={grupo.turno.fecha_operativa} titulo={`Calidad de agua · ${nombreArea(grupo.turno.area)}`} operador={grupo.operadorNombre} turno={grupo.turno.turno} />
    {abierto && <div className="cmc-contenido">
      {hojas.map(({registro,adicionales}) => <div className="cmc-muestra" key={registro.lectura.id}>
        <DetalleMuestra registro={registro} adicionales={adicionales} exportable={exportable} nombreGrupo={nombreMuestras} />
      </div>)}
      {cargando && <p role="status">Cargando muestras…</p>}
      {vista?.clave === clave && vista.error && <div><p role="alert" className="mensaje-error">{vista.error}</p><button type="button" className="boton-secundario" onClick={() => setIntento(n => n + 1)}>Reintentar muestras</button></div>}
      {!cargando && !vista?.error && datos?.hayMas && <button type="button" className="boton-secundario" onClick={() => setPagina(n => n + 1)}>Cargar más muestras</button>}
    </div>}
  </details>
}

function DetalleMuestra({ registro, adicionales = [], exportable, nombreGrupo }: { registro: RegistroCalidad; adicionales?: readonly RegistroCalidad[]; exportable: boolean; nombreGrupo: string }) {
  const [visitado, setVisitado] = useState(false)
  return <details className="cmc-detalle co-acordeon-historial" name={nombreGrupo} onToggle={e => { if (e.currentTarget.open) setVisitado(true) }}>
    <summary onClick={() => setVisitado(true)}><span><strong>Hora de registro</strong> <time dateTime={registro.lectura.capturado_en}>{fechaHoraCalidad(registro.lectura.capturado_en)}</time><small>{registro.lectura.resultados.length + adicionales.reduce((n,m) => n + m.lectura.resultados.length,0)} resultados</small></span><span className="cmc-ver">Ver</span><span className="cmc-ocultar">Ocultar</span></summary>
    {visitado && <LecturaCalidadGuardada registro={registro} adicionales={adicionales} historial compacta exportable={exportable} />}
  </details>
}
