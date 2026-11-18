import { ConsultaMuestrasCalidad } from '../calidad/ConsultaMuestrasCalidad'
import '../bitacora/bitacoraCalderas.css'
import '../bitacora/bitacoraPTAR.css'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import type { FiltrosPlanta } from '../../lib/planta'
import { consultarPeriodoTecnicoCompleto } from '../../lib/consultarConsolidadoTecnico'
import { exigirAdminRevision } from '../../lib/revisionCapturas'
import { consultarTecnicoAdmin, guardarCorreccionTecnica, pendienteTecnica, prepararCorreccionTecnica } from '../../lib/revisionTecnica'
import type { DetalleTecnicoAdmin, FilaTecnicaAdmin } from '../../lib/revisionTecnica'
import { ConsolidadoReportesTecnicos } from './ConsolidadoReportesTecnicos'
import { DetalleReporteCalderasPlanta } from '../planta/DetalleReporteCalderasPlanta'
import { DetalleReportePTARPlanta } from '../planta/DetalleReportePTARPlanta'
import { FormularioBitacoraCalderas } from '../bitacora/FormularioBitacoraCalderas'
import { FormularioBitacoraPTAR } from '../bitacora/FormularioBitacoraPTAR'
import './gestionRegistros.css'

const PanelPozos = lazy(() => import('../pozos/PanelPozos').then(m => ({ default: m.PanelPozos })))
const PanelUF = lazy(() => import('../uf/PanelUF').then(m => ({ default: m.PanelUF })))
const seccionesCapturas = [
  { id: 'tecnicos', nombre: 'Reportes técnicos' },
  { id: 'calidad', nombre: 'Calidad de agua' },
  { id: 'pozos', nombre: 'Pozos' },
  { id: 'uf', nombre: 'UF' },
] as const
type SeccionCapturas = typeof seccionesCapturas[number]['id']

export function GestionRegistrosAdministracion() {
  const [seccion, setSeccion] = useState<SeccionCapturas>('tecnicos')
  const [abiertas, setAbiertas] = useState<SeccionCapturas[]>(['tecnicos'])
  function abrirSeccion(id: SeccionCapturas) {
    setSeccion(id)
    setAbiertas(actuales => actuales.includes(id) ? actuales : [...actuales, id])
  }
  return <div className="gestion-registros">
    <nav className="gestion-capturas-tabs" aria-label="Consultas de capturas">
      {seccionesCapturas.map(item => <button key={item.id} type="button" aria-pressed={seccion === item.id}
        onClick={() => abrirSeccion(item.id)}>{item.nombre}</button>)}
    </nav>
    <div hidden={seccion !== 'tecnicos'}><ReportesTecnicosAdmin /></div>
    {abiertas.includes('calidad') && <div hidden={seccion !== 'calidad'}><ConsultaMuestrasCalidad exportacionDiaria ocultarFiltros /></div>}
    {abiertas.includes('pozos') && <div className="co-operativo-referencia" hidden={seccion !== 'pozos'}>
      <Suspense fallback={<p role="status">Cargando Pozos…</p>}><PanelPozos /></Suspense>
    </div>}
    {abiertas.includes('uf') && <div className="co-operativo-referencia" hidden={seccion !== 'uf'}>
      <Suspense fallback={<p role="status">Cargando UF…</p>}><PanelUF /></Suspense>
    </div>}
  </div>
}
function PresentarTecnico({ detalle }: { detalle: DetalleTecnicoAdmin }) {
  return detalle.area === 'calderas' ? <div className="bc-panel"><DetalleReporteCalderasPlanta reporte={detalle.reporte} /></div>
    : <div className="bpt-panel"><DetalleReportePTARPlanta reporte={detalle.reporte} /></div>
}
function ReportesTecnicosAdmin() {
  const { estado, perfil, sesion } = useAuth()
  const cuenta = estado === 'autenticado' && perfil?.activo && perfil.rol === 'admin' && perfil.id === sesion?.user.id ? perfil.id : null
  const [periodo, setPeriodo] = useState<{ cuenta: string; desde: string; hasta: string } | null>(null)
  const [errorPeriodo, setErrorPeriodo] = useState<{ cuenta: string; mensaje: string } | null>(null)
  const [intentoPeriodo, setIntentoPeriodo] = useState(0)
  const [revision, setRevision] = useState(0)
  const [fila, setFila] = useState<FilaTecnicaAdmin | null>(() => cuenta ? pendienteTecnica(cuenta)?.detalle.fila ?? null : null)
  const [iniciarEdicion, setIniciarEdicion] = useState(false)
  const [vista, setVista] = useState<{ clave: string; detalle: DetalleTecnicoAdmin | null; error: string | null } | null>(null)
  useEffect(() => {
    if (!cuenta) return
    let vigente = true
    const control = new AbortController(), limite = window.setTimeout(() => control.abort(), 20000)
    void consultarPeriodoTecnicoCompleto(cuenta, control.signal)
      .then(rango => { if (vigente) { setPeriodo({ cuenta, ...rango }); setErrorPeriodo(null) } })
      .catch(e => { if (vigente) setErrorPeriodo({ cuenta, mensaje: control.signal.aborted ? 'La consulta tardó demasiado. Reintenta.' : e instanceof Error ? e.message : 'No se pudo preparar el historial técnico.' }) })
      .finally(() => window.clearTimeout(limite))
    return () => { vigente = false; control.abort(); window.clearTimeout(limite) }
  }, [cuenta, intentoPeriodo])
  const clave = `${cuenta}:${fila?.area}:${fila?.id}:${revision}`
  useEffect(() => {
    if (!cuenta || !fila) return
    const pendiente = pendienteTecnica(cuenta)
    if (pendiente) return
    let vivo = true; const control = new AbortController(), limite = window.setTimeout(() => control.abort(), 20000)
    void consultarTecnicoAdmin(cuenta, fila, control.signal).then(detalle => { if (vivo) setVista({ clave, detalle, error: null }) })
      .catch(e => { if (vivo) setVista({ clave, detalle: null, error: e instanceof Error ? e.message : 'Detalle no disponible.' }) })
      .finally(() => window.clearTimeout(limite))
    return () => { vivo = false; control.abort(); window.clearTimeout(limite) }
  }, [cuenta, fila, clave])
  if (!cuenta) return null
  const periodoActual = periodo?.cuenta === cuenta ? periodo : null
  const errorPeriodoActual = errorPeriodo?.cuenta === cuenta ? errorPeriodo.mensaje : null
  const filtros: FiltrosPlanta | null = periodoActual
    ? { desde: periodoActual.desde, hasta: periodoActual.hasta, area: 'todas', turno: 'todos' }
    : null
  const actual = vista?.clave === clave ? vista : null, pendiente = pendienteTecnica(cuenta)
  const detalle = pendiente?.detalle ?? actual?.detalle
  return <div className="admin-panel">
    {errorPeriodoActual && <div><p role="alert" className="mensaje-error">{errorPeriodoActual}</p><button type="button" className="boton-secundario" onClick={() => setIntentoPeriodo(n => n + 1)}>Reintentar</button></div>}
    {!periodoActual && !errorPeriodoActual && <p role="status">Preparando el historial técnico desde el primer reporte hasta hoy…</p>}
    {fila && <section className="panel-informacion">
      {!detalle ? actual?.error ? <><p role="alert" className="mensaje-error">{actual.error}</p><button type="button" className="boton-secundario" onClick={() => setRevision(n => n + 1)}>Reintentar detalle</button></> : <p role="status">Consultando reporte técnico…</p> :
        <EditorTecnico key={`${cuenta}:${fila.id}`} cuenta={cuenta} detalle={detalle} iniciarEdicion={iniciarEdicion} cerrar={() => { setFila(null); setIniciarEdicion(false); setVista(null); setRevision(n => n + 1) }} guardado={d => { setVista({ clave, detalle: d, error: null }) }} />}
      {!detalle && <button type="button" className="boton-secundario" onClick={() => { setFila(null); setIniciarEdicion(false) }}>Cerrar detalle</button>}
    </section>}
    {filtros && <div hidden={!!fila}>
      <ConsolidadoReportesTecnicos key={`${cuenta}:${JSON.stringify(filtros)}:${revision}`} cuenta={cuenta} filtros={filtros} corregir={(seleccionada, editar) => { setFila(seleccionada); setIniciarEdicion(!!editar) }} />
    </div>}
  </div>
}
export function EditorTecnico({ cuenta, detalle, cerrar, guardado, iniciarEdicion = false }: { cuenta: string; detalle: DetalleTecnicoAdmin; cerrar: () => void; guardado: (d: DetalleTecnicoAdmin) => void; iniciarEdicion?: boolean }) {
  const [borrador, setBorrador] = useState(detalle.reporte.borrador), [editando, setEditando] = useState(iniciarEdicion)
  const [motivo, setMotivo] = useState(''), [error, setError] = useState<string | null>(null), [exito, setExito] = useState(false)
  const [guardando, setGuardando] = useState(false), activo = useRef(false)
  const pendiente = pendienteTecnica(cuenta), bloqueado = guardando || !!pendiente
  async function guardar() {
    if (activo.current) return
    if (!motivo.trim()) { setError('Escribe el motivo obligatorio de la corrección antes de guardar.'); return }
    try {
      exigirAdminRevision(cuenta)
      const s = pendienteTecnica(cuenta) ?? prepararCorreccionTecnica(cuenta, detalle, borrador, motivo)
      activo.current = true; setGuardando(true); setError(null)
      const resultado = await guardarCorreccionTecnica(s)
      exigirAdminRevision(cuenta); setExito(true); setEditando(false); guardado(resultado)
    } catch (e) { try { exigirAdminRevision(cuenta); setError(e instanceof Error ? e.message : 'No se confirmó la corrección.') } catch { /* La cuenta anterior no recibe datos de otra sesión. */ } }
    finally { activo.current = false; setGuardando(false) }
  }
  return <div className={`gestion-editor-tecnico${iniciarEdicion ? ' co-pendiente-editor' : ''}`} aria-busy={guardando}>
    <div className="planta-encabezado"><h3>Reporte técnico · {detalle.area === 'calderas' ? 'Calderas' : 'PTAR'} · Revisión {detalle.reporte.revision}</h3><button type="button" className="boton-secundario" disabled={bloqueado} onClick={cerrar}>Cerrar detalle</button></div>
    {error && <p role="alert" className="mensaje-error">{error}</p>}{exito && <p role="status" className="mensaje-exito">Corrección confirmada.</p>}
    {pendiente && <div className="admin-pendiente"><strong>Corrección pendiente de confirmación</strong><p>Se conserva la solicitud original y su motivo.</p><button type="button" className="boton-principal" disabled={guardando} onClick={() => { void guardar() }}>Comprobar / reintentar</button></div>}
    {!editando ? <><PresentarTecnico detalle={detalle} /><button type="button" className="boton-principal" disabled={bloqueado} onClick={() => { setBorrador(detalle.reporte.borrador); setMotivo(''); setEditando(true); setExito(false) }}>Corregir reporte técnico</button></> :
      <form noValidate onSubmit={e => { e.preventDefault(); void guardar() }}>
        {detalle.area === 'calderas' && 'equipos' in borrador ? <div className="bc-panel"><FormularioBitacoraCalderas completarAdministracion={iniciarEdicion ? {
          guardando, confirmado: exito, incierto: !!pendiente, guardar: () => { void guardar() }, cerrar,
          contenidoFinal: <label className="gestion-motivo">Motivo obligatorio<textarea required maxLength={4000} rows={3} value={motivo} disabled={bloqueado} onChange={e => setMotivo(e.target.value)} /></label>,
        } : undefined} captura={{ reporte: detalle.reporte, borrador, editable: !bloqueado, unidadPresion: detalle.reporte.unidadCondensado,
          cambiarBorrador: cambio => setBorrador(b => 'equipos' in b ? cambio(b) : b) }} observaciones={null} ocultarHistorial /></div>
          : detalle.area === 'ptar' && 'bombas' in borrador ? <div className="bpt-panel"><FormularioBitacoraPTAR completarAdministracion={iniciarEdicion ? {
            guardando, confirmado: exito, incierto: !!pendiente, guardar: () => { void guardar() }, cerrar,
            contenidoFinal: <label className="gestion-motivo">Motivo obligatorio<textarea required maxLength={4000} rows={3} value={motivo} disabled={bloqueado} onChange={e => setMotivo(e.target.value)} /></label>,
          } : undefined} captura={{ reporte: detalle.reporte, borrador, editable: !bloqueado,
            cambiarBorrador: cambio => setBorrador(b => 'bombas' in b ? cambio(b) : b) }} turnoTipo={detalle.fila.turno} observaciones={null} ocultarHistorial /></div> : null}
        {!iniciarEdicion && <><label className="gestion-motivo">Motivo obligatorio<textarea required maxLength={4000} rows={3} value={motivo} disabled={bloqueado} onChange={e => setMotivo(e.target.value)} /></label>
        <div className="acciones-turno"><button type="submit" className="boton-principal" disabled={bloqueado}>{guardando ? 'Guardando…' : 'Guardar corrección'}</button><button type="button" className="boton-secundario" disabled={bloqueado} onClick={() => setEditando(false)}>Cancelar</button></div></>}
      </form>}
  </div>
}
