import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { areasBitacora, consultarPaginaBitacora, eventoBitacora, guardarActividad, pendienteBitacora,
  prepararActividad, consultarRegistroDiario, mensajeRegistroDiario } from '../../lib/bitacoraAdministrativa'
import type { ActividadAdministrativa, AreaBitacora, CursorBitacora, FiltroBitacora,
  PaginaBitacora, SolicitudBitacora } from '../../lib/bitacoraAdministrativa'
import './bitacoraAdministrativa.css'

const fecha = (v: string) => v.split('-').reverse().join('/')
function ajustarAltura(campo: HTMLTextAreaElement | null) {
  if (!campo || campo.clientWidth === 0) return
  campo.style.height = 'auto'
  const bordes = campo.offsetHeight - campo.clientHeight
  campo.style.height = `${campo.scrollHeight + bordes}px`
}
export function PanelBitacoraAdministrativa() {
  const { perfil, sesion, estado } = useAuth()
  if (estado !== 'autenticado' || !perfil?.activo || perfil.id !== sesion?.user.id || perfil.rol !== 'admin') return null
  return <EditorActividades key={perfil.id} />
}
export function NovedadesAdministracion() {
  const { perfil, sesion, estado } = useAuth()
  if (estado !== 'autenticado' || !perfil?.activo || perfil.id !== sesion?.user.id
    || !['calderas', 'ptar'].includes(perfil.rol)) return null
  return <ConsultaActividades key={`${perfil.id}:${perfil.rol}`} mensual />
}

function EditorActividades() {
  const [inicial] = useState<SolicitudBitacora | null>(() => {
    try { return pendienteBitacora() } catch { return null }
  })
  const [area, setArea] = useState<AreaBitacora>(inicial?.area ?? 'ptar')
  const [actividad, setActividad] = useState(inicial?.actividad ?? '')
  const [original, setOriginal] = useState<ActividadAdministrativa | null>(null)
  const [pendiente, setPendiente] = useState(inicial)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null), [mensaje, setMensaje] = useState<string | null>(null)
  const enviando = useRef(false), vivo = useRef(true), texto = useRef<HTMLTextAreaElement>(null)
  const [hoy, setHoy] = useState<{ area: AreaBitacora; registro: ActividadAdministrativa | null } | null>(null)
  const [revisionDiaria, setRevisionDiaria] = useState(0)
  const id = useId()
  useEffect(() => {
    const control = new AbortController(), limite = setTimeout(() => control.abort(), 20000)
    void consultarRegistroDiario(area, control.signal)
      .then(d => { if (!control.signal.aborted) setHoy({ area, registro: d.registro }) })
      .catch(() => { /* El servidor valida siempre el guardado, también si esta consulta falla. */ })
      .finally(() => clearTimeout(limite))
    return () => { clearTimeout(limite); control.abort() }
  }, [area, revisionDiaria])
  useEffect(() => {
    const actualizar = () => setRevisionDiaria(n => n + 1)
    const intervalo = window.setInterval(() => { if (document.visibilityState === 'visible') actualizar() }, 60000)
    window.addEventListener(eventoBitacora, actualizar); window.addEventListener('focus', actualizar)
    return () => { window.clearInterval(intervalo); window.removeEventListener(eventoBitacora, actualizar); window.removeEventListener('focus', actualizar) }
  }, [])
  const registradoHoy = !original && !pendiente && hoy?.area === area && !!hoy.registro
  useEffect(() => { vivo.current = true; return () => { vivo.current = false } }, [])
  useLayoutEffect(() => { ajustarAltura(texto.current) }, [actividad])
  useLayoutEffect(() => {
    const campo = texto.current
    if (!campo) return
    let ancho = campo.clientWidth, activo = true
    let cuadro: number | null = null
    const alCambiarAncho = () => {
      if (campo.clientWidth !== ancho) {
        ancho = campo.clientWidth
        if (cuadro !== null) window.cancelAnimationFrame(cuadro)
        cuadro = window.requestAnimationFrame(() => { cuadro = null; if (activo) ajustarAltura(campo) })
      }
    }
    const observador = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(alCambiarAncho)
    observador?.observe(campo)
    if (!observador) window.addEventListener('resize', alCambiarAncho)
    void document.fonts?.ready.then(() => { if (activo) ajustarAltura(campo) })
    return () => {
      activo = false; observador?.disconnect(); window.removeEventListener('resize', alCambiarAncho)
      if (cuadro !== null) window.cancelAnimationFrame(cuadro)
    }
  }, [])
  async function guardar() {
    if (enviando.current || registradoHoy) return
    enviando.current = true; setGuardando(true); setError(null); setMensaje(null)
    try {
      const solicitud = pendienteBitacora() ?? prepararActividad(area, actividad, original)
      setPendiente(solicitud)
      const fila = await guardarActividad(solicitud)
      if (!vivo.current) return
      if (solicitud.revision === null) setHoy({ area: solicitud.area, registro: fila })
      setPendiente(null); setActividad(''); setOriginal(null)
      setMensaje(`Actividad ${solicitud.revision === null ? 'registrada' : 'corregida'}.`)
    } catch (e) {
      if (vivo.current) {
        setError(e instanceof Error ? e.message : 'No se confirmó el guardado.')
        setRevisionDiaria(n => n + 1)
        try { setPendiente(pendienteBitacora()) } catch { /* Conservar la solicitud que ya se estaba confirmando. */ }
      }
    } finally { enviando.current = false; if (vivo.current) setGuardando(false) }
  }
  function corregir(fila: ActividadAdministrativa) {
    if (guardando || pendiente) return
    setOriginal(fila); setArea(fila.area); setActividad(fila.actividad); setMensaje(null); setError(null)
    texto.current?.focus(); texto.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
  return <div className="ba-panel">
    <section className="ba-captura" aria-labelledby={`${id}-titulo`}>
      <h2 id={`${id}-titulo`}>Bitácora administrativa</h2>
      <form onSubmit={e => { e.preventDefault(); void guardar() }}>
        {original && <p className="ba-editando">Corregir actividad</p>}
        <div className="ba-captura-fila">
        <fieldset disabled={guardando || pendiente !== null}>
          <label htmlFor={`${id}-area`}><span className="ba-etiqueta-sr">Área</span><select id={`${id}-area`} value={area} onChange={e => setArea(e.target.value as AreaBitacora)}>
            {Object.entries(areasBitacora).map(([v, n]) => <option key={v} value={v}>{n}</option>)}
          </select></label>
          <div className="ba-descripcion"><label className="ba-etiqueta-sr" htmlFor={`${id}-actividad`}>Actividad relevante</label><textarea ref={texto} id={`${id}-actividad`}
          placeholder="Actividad relevante" disabled={registradoHoy} value={actividad} onChange={e => setActividad(e.target.value.toLocaleUpperCase('es-MX'))} rows={1} required maxLength={10000} /></div>
        </fieldset>
        <div className="ba-acciones">
          {original && !pendiente && <button type="button" className="boton-secundario" disabled={guardando}
            onClick={() => { setOriginal(null); setActividad(''); setError(null) }}>Cancelar corrección</button>}
          <button type="submit" className="boton-principal" disabled={guardando || registradoHoy}>
            {guardando ? 'Confirmando…' : pendiente ? 'Reintentar el mismo guardado' : 'Guardar'}
          </button>
        </div>
        </div>
        {registradoHoy && <p className="ba-editando" role="status">{mensajeRegistroDiario}</p>}
        {error && <p className="mensaje-error" role="alert">{error}</p>}
        {mensaje && <p className="mensaje-exito" role="status">{mensaje}</p>}
        {pendiente && !guardando && <p className="ba-pendiente" role="status">Guardado sin confirmar. El reintento conserva la misma actividad y evita duplicados.</p>}
      </form>
    </section>
    <ConsultaActividades admin corregir={corregir} bloqueado={guardando || pendiente !== null} />
  </div>
}

function ConsultaActividades({ admin = false, mensual = false, corregir, bloqueado = false }: {
  admin?: boolean; mensual?: boolean; corregir?: (fila: ActividadAdministrativa) => void; bloqueado?: boolean
}) {
  const id = useId()
  const [filtro, setFiltro] = useState<FiltroBitacora>({ mes: '', area: 'todas', recientes: !admin && !mensual })
  const [cursores, setCursores] = useState<(CursorBitacora | null)[]>([null]), [pagina, setPagina] = useState(0)
  const [revision, setRevision] = useState(0)
  const [exportando, setExportando] = useState(false), [errorWord, setErrorWord] = useState<string | null>(null)
  const exportacion = useRef<AbortController | null>(null)
  const [vista, setVista] = useState<{ clave: string; datos: PaginaBitacora | null; error: string | null } | null>(null)
  const cursor = cursores[pagina] ?? null
  const clave = JSON.stringify([filtro, cursor, revision])
  const actual = vista?.clave === clave ? vista : null
  useEffect(() => () => { exportacion.current?.abort(); exportacion.current = null }, [])
  async function exportarWord() {
    const mes = filtro.mes || actual?.datos?.mes
    if (!admin || !mes || exportacion.current) return
    const control = new AbortController()
    exportacion.current = control; setExportando(true); setErrorWord(null)
    const limite = setTimeout(() => control.abort(), 60000)
    try {
      const { prepararWordBitacora, descargarWordBitacora } = await import('../../lib/exportarBitacoraAdministrativa')
      const archivo = await prepararWordBitacora(mes, filtro.area, control.signal)
      control.signal.throwIfAborted(); descargarWordBitacora(archivo)
    } catch (e) {
      if (exportacion.current === control) setErrorWord(control.signal.aborted ? 'La preparación tardó demasiado. Reintenta la exportación.' : e instanceof Error ? e.message : 'No se pudo preparar Word.')
    } finally {
      clearTimeout(limite)
      if (exportacion.current === control) { exportacion.current = null; setExportando(false) }
    }
  }
  useEffect(() => {
    let vivo = true
    const control = new AbortController(), limite = setTimeout(() => control.abort(), 20000)
    void consultarPaginaBitacora(filtro, cursor, control.signal, revision > 0)
      .then(datos => { if (vivo) setVista({ clave, datos, error: null }) })
      .catch(e => { if (vivo) setVista({ clave, datos: null, error: e instanceof Error ? e.message : 'No se pudieron consultar las actividades.' }) })
      .finally(() => clearTimeout(limite))
    return () => { vivo = false; clearTimeout(limite); control.abort() }
  }, [clave, filtro, cursor, revision])
  useEffect(() => {
    const actualizar = () => { setPagina(0); setCursores([null]); setRevision(n => n + 1) }
    window.addEventListener(eventoBitacora, actualizar)
    return () => window.removeEventListener(eventoBitacora, actualizar)
  }, [])
  function filtrar(cambio: Partial<FiltroBitacora>) {
    setFiltro(v => ({ ...v, ...cambio })); setPagina(0); setCursores([null])
  }
  return <section className="ba-historial" aria-labelledby={`${id}-titulo`}>
    <div className={admin ? 'ba-herramientas ba-herramientas-admin' : 'ba-herramientas'}>
    <div className="ba-cabecera"><h2 id={`${id}-titulo`}>{admin ? 'Historial de actividades' : 'Novedades de Administración'}</h2>
      {!admin && <button className="boton-secundario" type="button" onClick={() => filtrar({ recientes: !filtro.recientes })}>
        {filtro.recientes ? 'Historial mensual' : 'Ver recientes'}
      </button>}
    </div>
    <div className="ba-filtros">
      {!filtro.recientes && <label><span className={admin ? 'ba-etiqueta-sr' : undefined}>Mes y año</span><input type="month" disabled={exportando} value={filtro.mes || actual?.datos?.mes || ''} onChange={e => filtrar({ mes: e.target.value })} /></label>}
      <label><span className={admin ? 'ba-etiqueta-sr' : undefined}>Área</span><select disabled={exportando} value={filtro.area} onChange={e => filtrar({ area: e.target.value as FiltroBitacora['area'] })}>
        <option value="todas">Todas</option>
        {Object.entries(areasBitacora).filter(([a]) => admin || a !== 'obra_civil').map(([a, n]) => <option key={a} value={a}>{n}</option>)}
      </select></label>
      <button type="button" className="boton-secundario" disabled={exportando} onClick={() => { setPagina(0); setCursores([null]); setRevision(n => n + 1) }}>Actualizar</button>
      {admin && <button type="button" className="boton-secundario ba-word" title="Descargar Word del mes y área seleccionados"
        disabled={exportando || bloqueado || !(filtro.mes || actual?.datos?.mes)} onClick={() => { void exportarWord() }}>{exportando ? 'Preparando…' : 'Word'}</button>}
    </div>
    </div>
    {errorWord && <p className="mensaje-error" role="alert">{errorWord}</p>}
    {!actual ? <p role="status">Consultando actividades…</p> : actual.error ? <p className="mensaje-error" role="alert">{actual.error}</p>
      : !actual.datos?.filas.length ? <p className="ba-vacio">No hay actividades para esta consulta.</p>
      : <>{admin && <div className="ba-lista-cabecera" aria-hidden="true"><span>Fecha</span><span>Área</span><span>Actividad</span></div>}
      <ol className={admin ? 'ba-lista ba-lista-admin' : 'ba-lista'}>{actual.datos.filas.map(fila => <li key={fila.id}>
        <time className="ba-fecha" dateTime={fila.fecha}>{fecha(fila.fecha)}</time>
        <span className="ba-area">{areasBitacora[fila.area]}</span>
        <p>{fila.actividad}</p>
        {admin && corregir && <button type="button" className="boton-secundario" disabled={bloqueado} onClick={() => corregir(fila)}>Corregir</button>}
      </li>)}</ol></>}
    {!filtro.recientes && (pagina > 0 || actual?.datos?.mas) && <nav className="ba-paginacion" aria-label="Páginas de actividades">
      <button className="boton-secundario" type="button" disabled={pagina === 0 || !actual?.datos} onClick={() => setPagina(n => n - 1)}>Anterior</button>
      <span>Página {pagina + 1}</span>
      <button className="boton-secundario" type="button" disabled={!actual?.datos?.mas} onClick={() => {
        const ultimo = actual?.datos?.filas.at(-1)
        if (ultimo) {
          if (!filtro.mes && actual?.datos) setFiltro(v => ({ ...v, mes: actual.datos!.mes }))
          setCursores(v => [...v.slice(0, pagina + 1), { creado_en: ultimo.creado_en, id: ultimo.id }]); setPagina(n => n + 1)
        }
      }}>Siguiente</button>
    </nav>}
  </section>
}
