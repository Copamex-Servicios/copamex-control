import { useEffect, useId, useRef, useState } from 'react'
import { Calendar, Plus } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useSeguimientoCalidad } from '../../hooks/useSeguimientoCalidad'
import { ejecutarSeguimiento, pendienteSeguimiento } from '../../lib/seguimientoCalidad'
import { validarValorNumericoCalidad } from '../../lib/calidad'
import type { SolicitudSeguimiento, TipoLecturaColor } from '../../lib/seguimientoCalidad'
import type { TurnoOperativo } from '../../lib/tiposTurno'
import { mayusculasNota } from '../../lib/notasOperativas'
import { supabase } from '../../lib/supabase'
import { configuracionAdmin, ErrorAdmin, fechaMexicoAdmin, guardarAdministracion, instanteMexicoAdmin, leerFilaAdmin } from '../../lib/administracion'
import type { FilaAdmin, SolicitudAdmin } from '../../lib/administracion'
import { finalizarAviso } from '../../lib/finalizarAviso'
import { escucharCambiosInformacion, intervaloAviso, notificarInformacionActualizada } from '../../lib/actualizacionInformacion'
import { esAutorAviso } from '../../lib/permisosAvisos'
import './seguimientoColorM4.css'

type DuracionAviso = '1' | '2' | '4' | '8' | '12' | '24' | 'hasta_quitar'
type ModoAviso = 'publicar' | 'programar'
const fechaAvisoHoy = () => fechaMexicoAdmin(new Date().toISOString()).slice(0, 10)
const opcionesDuracionAviso: readonly { valor: DuracionAviso; etiqueta: string }[] = [
  { valor:'1',etiqueta:'1 hora' }, { valor:'2',etiqueta:'2 horas' }, { valor:'4',etiqueta:'4 horas' },
  { valor:'8',etiqueta:'8 horas' }, { valor:'12',etiqueta:'12 horas' }, { valor:'24',etiqueta:'24 horas' },
  { valor:'hasta_quitar',etiqueta:'Hasta quitar' },
]

function fechaHoraAviso(iso: string): string {
  return new Intl.DateTimeFormat('es-MX',{ timeZone:'America/Mexico_City',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23' }).format(new Date(iso))
}

function detalleDuracionAviso(aviso: FilaAdmin): string {
  if (aviso.permanente === true) return 'Duración: hasta quitar'
  const fin = typeof aviso.fin === 'string' ? aviso.fin : null
  const inicio = typeof aviso.inicio === 'string' ? aviso.inicio : typeof aviso.creado_en === 'string' ? aviso.creado_en : null
  if (!fin) return 'Duración temporal'
  const horas = inicio ? Math.round((Date.parse(fin) - Date.parse(inicio)) / 3600000) : 0
  const duracion = horas > 0 ? `Duración: ${horas} ${horas === 1 ? 'hora' : 'horas'}` : 'Duración temporal'
  return `${duracion} · Vence ${fechaHoraAviso(fin)}`
}

function horarioProgramado(inicio: string, fin: string): string {
  const desde = fechaHoraAviso(inicio)
  const hasta = fechaHoraAviso(fin)
  return `${desde} a ${fechaMexicoAdmin(inicio).slice(0, 10) === fechaMexicoAdmin(fin).slice(0, 10) ? hasta.slice(-5) : hasta}`
}

const lecturasColor: readonly { tipo: TipoLecturaColor; etiqueta: string }[] = [
  { tipo: 'color_m4', etiqueta: 'Color M4' },
  { tipo: 'color_m2', etiqueta: 'Color M2' },
  { tipo: 'color_aimsu', etiqueta: 'Color AIMSU' },
]

interface Props {
  cuenta: string; administracion?: boolean; turno?: TurnoOperativo | null
  habilitado?: boolean; muestraHabitual?: boolean; alGuardar?: () => void
  contenedorAcciones?: HTMLDivElement | null
}
export function SeguimientoColorM4({ cuenta, administracion = false, turno, habilitado = false, muestraHabitual = false, alGuardar, contenedorAcciones }: Props) {
  const { seguimiento, error, actualizar } = useSeguimientoCalidad(cuenta)
  const [instruccion, setInstruccion] = useState('')
  const [valor, setValor] = useState('')
  const [tipoLectura, setTipoLectura] = useState<TipoLecturaColor>(() => pendienteSeguimiento(cuenta)?.tipo ?? 'color_m4')
  const [abierto, setAbierto] = useState(() => !!pendienteSeguimiento(cuenta))
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [exito, setExito] = useState(false)
  const [pendiente, setPendiente] = useState(() => pendienteSeguimiento(cuenta))
  const ocupado = useRef(false), peticion = useRef<AbortController | null>(null)
  const [avisosAdmin, setAvisosAdmin] = useState<FilaAdmin[]>([])
  const [ahoraAvisosAdmin, setAhoraAvisosAdmin] = useState(Date.now)
  const [hayMasAvisosAdmin, setHayMasAvisosAdmin] = useState(false)
  const [cargandoAvisosAdmin, setCargandoAvisosAdmin] = useState(false)
  const [cargadosAvisosAdmin, setCargadosAvisosAdmin] = useState(false)
  const [errorAvisosAdmin, setErrorAvisosAdmin] = useState<string | null>(null)
  const [revisionAvisosAdmin, setRevisionAvisosAdmin] = useState(0)
  const [modoAviso, setModoAviso] = useState<ModoAviso | null>(null)
  const [fechaProgramada, setFechaProgramada] = useState(fechaAvisoHoy)
  const [horaInicio, setHoraInicio] = useState('07:00')
  const [horaFin, setHoraFin] = useState('15:00')
  const [textoAvisoAdmin, setTextoAvisoAdmin] = useState('')
  const textoAvisoAdminRef = useRef<HTMLTextAreaElement>(null)
  const [duracionAvisoAdmin, setDuracionAvisoAdmin] = useState<DuracionAviso>('8')
  const [solicitudAvisoAdmin, setSolicitudAvisoAdmin] = useState<SolicitudAdmin | null>(null)
  const [guardandoAvisoAdmin, setGuardandoAvisoAdmin] = useState(false)
  const [errorGuardarAvisoAdmin, setErrorGuardarAvisoAdmin] = useState<string | null>(null)
  const [exitoAvisoAdmin, setExitoAvisoAdmin] = useState<string | null>(null)
  const cargaAvisosInicial = useRef(false)
  const ocupadoAvisoAdmin = useRef(false)
  const dialogo = useRef<HTMLDialogElement>(null)
  const idDialogo = useId()
  const modalAbierto = !administracion && abierto
  const esProgramado = modoAviso === 'programar'
  const avisoOcupado = guardandoAvisoAdmin || !!solicitudAvisoAdmin
  useEffect(() => {
    const campo = textoAvisoAdminRef.current
    if (!campo) return
    campo.style.height = 'auto'
    campo.style.height = `${campo.scrollHeight}px`
  }, [textoAvisoAdmin, modoAviso])
  useEffect(() => {
    if (!administracion) return
    let vivo = true
    let controller: AbortController | null = null
    const c = configuracionAdmin('avisos')
    async function cargarAvisos() {
      if (!vivo) return
      if (document.visibilityState === 'hidden') return
      const control = new AbortController()
      controller = control
      const limite = window.setTimeout(() => control.abort(),15000)
      if (!cargaAvisosInicial.current) setCargandoAvisosAdmin(true)
      try {
        const { data, error } = await supabase.from('avisos').select(c.columnas)
          .or('permanente.eq.true,fin.gt.now,and(fin.is.null,or(inicio.is.null,inicio.lte.now))')
          .order('creado_en',{ ascending:false }).limit(51).abortSignal(control.signal)
        if (!vivo) return
        control.signal.throwIfAborted()
        if (error || !Array.isArray(data)) throw new Error('Consulta no disponible')
        setHayMasAvisosAdmin(data.length > 50)
        setAvisosAdmin(data.slice(0,50).map(fila => leerFilaAdmin(fila,c)))
        setAhoraAvisosAdmin(Date.now())
        setErrorAvisosAdmin(null)
      } catch {
        if (vivo) setErrorAvisosAdmin('No se pudieron consultar los avisos. Reintenta la consulta.')
      } finally {
        window.clearTimeout(limite)
        if (controller === control) controller = null
        if (vivo) {
          cargaAvisosInicial.current = true
          setCargadosAvisosAdmin(true)
          setCargandoAvisosAdmin(false)
        }
      }
    }
    void cargarAvisos()
    return () => {
      vivo = false
      controller?.abort()
    }
  },[administracion,cuenta,revisionAvisosAdmin])
  useEffect(() => {
    if (!administracion) return
    let proximo = Infinity
    for (const aviso of avisosAdmin) {
      if (aviso.permanente === true) continue
      for (const valor of [aviso.inicio, aviso.fin]) {
        const instante = typeof valor === 'string' ? Date.parse(valor) : NaN
        if (instante > ahoraAvisosAdmin) proximo = Math.min(proximo, instante)
      }
    }
    if (!Number.isFinite(proximo)) return
    const demora = Math.min(2_147_483_647, Math.max(0, proximo - Date.now()))
    const temporizador = window.setTimeout(() => setAhoraAvisosAdmin(Date.now()), demora)
    return () => window.clearTimeout(temporizador)
  }, [administracion, avisosAdmin, ahoraAvisosAdmin])
  useEffect(() => {
    if (!administracion) return
    const refrescar = () => { if (document.visibilityState === 'visible') setRevisionAvisosAdmin(n => n + 1) }
    const dejarEscuchar = escucharCambiosInformacion(refrescar)
    const intervalo = window.setInterval(refrescar,intervaloAviso)
    window.addEventListener('focus',refrescar)
    window.addEventListener('online',refrescar)
    document.addEventListener('visibilitychange',refrescar)
    return () => {
      dejarEscuchar()
      window.clearInterval(intervalo)
      window.removeEventListener('focus',refrescar)
      window.removeEventListener('online',refrescar)
      document.removeEventListener('visibilitychange',refrescar)
    }
  },[administracion])
  useEffect(() => () => peticion.current?.abort(),[])
  useEffect(() => {
    if (!exito || !mensaje) return
    const temporizador = window.setTimeout(() => setMensaje(null),5000)
    return () => window.clearTimeout(temporizador)
  },[exito,mensaje])
  useEffect(() => {
    if (!exitoAvisoAdmin) return
    const temporizador = window.setTimeout(() => setExitoAvisoAdmin(null),5000)
    return () => window.clearTimeout(temporizador)
  },[exitoAvisoAdmin])
  useEffect(() => {
    const elemento = dialogo.current
    if (!modalAbierto || !elemento) return
    elemento.showModal()
    elemento.querySelector<HTMLInputElement>('input')?.focus()
    const previo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { elemento.close(); document.body.style.overflow = previo }
  },[modalAbierto])

  async function ejecutar(operacion: SolicitudSeguimiento['operacion']): Promise<boolean> {
    if (ocupado.current) return false
    let solicitud = pendienteSeguimiento(cuenta)
    try {
      if (!solicitud) {
        if (operacion === 'activar') {
          const texto = mayusculasNota(instruccion).trim()
          if (!texto) throw new Error('Escribe las instrucciones para los operadores.')
          solicitud = { id:crypto.randomUUID(),operacion,instruccion:texto }
        } else if (operacion === 'finalizar') {
          if (!seguimiento) throw new Error('Actualiza el seguimiento antes de finalizar.')
          solicitud = { id:seguimiento.id,operacion }
        } else {
          if (!turno || !habilitado || !muestraHabitual) throw new Error('Se requiere tu turno abierto y su muestra habitual de Calidad.')
          let numero: number
          try { numero = validarValorNumericoCalidad(valor) }
          catch { throw new Error(`Escribe un valor numérico válido para ${lecturasColor.find(l => l.tipo === tipoLectura)?.etiqueta ?? 'el color'}.`) }
          solicitud = { id:crypto.randomUUID(),operacion,tipo:tipoLectura,turno:turno.id,
            seguimiento:tipoLectura === 'color_m4' ? seguimiento?.id ?? null : null,valor:numero }
        }
      }
      const solicitudConfirmada = solicitud
      if (!solicitudConfirmada) throw new Error('No se pudo preparar la lectura de color. Reintenta.')
      ocupado.current = true; setGuardando(true); setPendiente(solicitudConfirmada); setMensaje(null); setExito(false)
      const control = new AbortController(); peticion.current = control
      const limite = window.setTimeout(() => control.abort(),25000)
      try { await ejecutarSeguimiento(cuenta,solicitudConfirmada,control.signal) }
      finally { window.clearTimeout(limite); peticion.current = null }
      setExito(true)
      setMensaje(solicitudConfirmada.operacion === 'lectura' ? `Lectura adicional de ${lecturasColor.find(l => l.tipo === (solicitudConfirmada.tipo ?? 'color_m4'))?.etiqueta ?? 'color'} guardada.`
        : solicitudConfirmada.operacion === 'activar' ? 'Activación y aviso confirmados. Revisa el estado actual.' : 'Seguimiento y aviso finalizados.')
      setValor(''); setAbierto(false); actualizar()
      if (solicitudConfirmada.operacion === 'finalizar') setInstruccion('')
      if (solicitudConfirmada.operacion === 'lectura') alGuardar?.()
      return true
    } catch (e) {
      const detalle = e instanceof Error ? e.message : 'No se confirmó la operación. Reintenta.'
      setExito(false); setMensaje(detalle)
      if (administracion) setErrorGuardarAvisoAdmin(detalle)
      return false
    }
    finally { setPendiente(pendienteSeguimiento(cuenta)); ocupado.current = false; setGuardando(false) }
  }
  async function publicarAvisoAdmin() {
    if (ocupadoAvisoAdmin.current) return
    let solicitud = solicitudAvisoAdmin
    try {
      if (!solicitud) {
        const mensajeLimpio = mayusculasNota(textoAvisoAdmin).trim()
        if (!mensajeLimpio) throw new Error('Escribe el aviso para los operadores.')
        if (mensajeLimpio.length > 4000) throw new Error('El aviso supera el máximo de 4,000 caracteres.')
        const permanente = !esProgramado && duracionAvisoAdmin === 'hasta_quitar'
        const ahora = Date.now()
        const inicio = permanente ? null : esProgramado
          ? instanteMexicoAdmin(`${fechaProgramada}T${horaInicio}`) : new Date(ahora).toISOString()
        const fin = permanente ? null : esProgramado
          ? instanteMexicoAdmin(`${fechaProgramada}T${horaFin}`) : new Date(ahora + Number(duracionAvisoAdmin) * 3600000).toISOString()
        if (esProgramado && inicio && fin) {
          if (Date.parse(inicio) <= ahora) throw new ErrorAdmin('Elige una fecha y hora de inicio futuras.')
          if (Date.parse(fin) <= Date.parse(inicio)) throw new ErrorAdmin('La hora de fin debe ser posterior a la hora de inicio.')
        }
        solicitud = {
          cuenta, tabla:'avisos', id:crypto.randomUUID(), original:null,
          valores:{
            mensaje:mensajeLimpio,
            permanente,
            inicio,
            fin,
          },
        }
        setSolicitudAvisoAdmin(solicitud)
      }
      ocupadoAvisoAdmin.current = true
      setGuardandoAvisoAdmin(true)
      setErrorGuardarAvisoAdmin(null)
      setExitoAvisoAdmin(null)
      await guardarAdministracion(solicitud)
      setSolicitudAvisoAdmin(null)
      setTextoAvisoAdmin('')
      setModoAviso(null)
      setExitoAvisoAdmin(esProgramado ? 'Aviso programado.' : 'Aviso publicado para los operadores.')
      notificarInformacionActualizada()
      setRevisionAvisosAdmin(n => n + 1)
    } catch (e) {
      const incierto = e instanceof ErrorAdmin && e.incierto
      if (!incierto) setSolicitudAvisoAdmin(null)
      setErrorGuardarAvisoAdmin(e instanceof Error ? e.message : 'No se pudo publicar el aviso.')
    } finally {
      ocupadoAvisoAdmin.current = false
      setGuardandoAvisoAdmin(false)
    }
  }
  async function quitarAvisoAdmin(aviso: FilaAdmin, programado: boolean) {
    if (ocupadoAvisoAdmin.current || !esAutorAviso(cuenta,aviso)) return
    ocupadoAvisoAdmin.current = true
    setGuardandoAvisoAdmin(true)
    setErrorGuardarAvisoAdmin(null)
    setExitoAvisoAdmin(null)
    try {
      if (programado) {
        const { creado_en, mensaje } = aviso
        if (typeof creado_en !== 'string' || typeof mensaje !== 'string') throw new ErrorAdmin('No se pudo comprobar el aviso programado.')
        // Usa su fecha de creación para cerrar el aviso sin depender del reloj del dispositivo.
        await guardarAdministracion({ cuenta, tabla:'avisos', id:aviso.id, original:aviso,
          valores:{ mensaje, permanente:false, inicio:null, fin:creado_en } })
        setExitoAvisoAdmin('Aviso programado cancelado.')
      } else if (seguimiento?.id === aviso.id) {
        const finalizado = await ejecutar('finalizar')
        if (!finalizado) return
        setExitoAvisoAdmin('Aviso finalizado.')
      }
      else {
        await finalizarAviso(cuenta,aviso)
        setExitoAvisoAdmin('Aviso quitado.')
      }
      notificarInformacionActualizada()
      setRevisionAvisosAdmin(n => n + 1)
    } catch (e) {
      setErrorGuardarAvisoAdmin(e instanceof Error ? e.message : 'No se pudo quitar el aviso.')
    } finally {
      ocupadoAvisoAdmin.current = false
      setGuardandoAvisoAdmin(false)
    }
  }
  function abrirFormularioAviso(modo: ModoAviso) {
    if (avisoOcupado) return
    setAhoraAvisosAdmin(Date.now())
    setModoAviso(actual => actual === modo ? null : modo)
    if (modo === 'programar' && fechaProgramada < fechaAvisoHoy()) setFechaProgramada(fechaAvisoHoy())
    setErrorGuardarAvisoAdmin(null)
    setExitoAvisoAdmin(null)
  }

  const botonesColor = !administracion && (turno || pendiente) && <div className="co-colores-adicionales">
    {lecturasColor.map(lectura => <button key={lectura.tipo} type="button" className="boton-primario co-tomar-color-m4"
      aria-haspopup="dialog" aria-controls={idDialogo}
      disabled={guardando || (pendiente ? (pendiente.tipo ?? 'color_m4') !== lectura.tipo : (!habilitado || !muestraHabitual))}
      title={pendiente ? 'Confirma la lectura pendiente' : !muestraHabitual ? 'Registra primero la muestra habitual del turno' : !habilitado ? 'Se requiere tu turno abierto y disponible' : `Registrar una lectura adicional de ${lectura.etiqueta}`}
      onClick={() => { setTipoLectura(pendiente?.tipo ?? lectura.tipo); setAbierto(true); setMensaje(null) }}>{lectura.etiqueta}</button>)}
  </div>
  if (!administracion) return <>
    {contenedorAcciones ? createPortal(botonesColor,contenedorAcciones) : botonesColor}
    {!abierto && mensaje && <p className={exito ? 'mensaje-exito' : 'mensaje-error'} role={exito ? 'status' : 'alert'}>{mensaje}</p>}
    {!abierto && error && <p role="alert">{error} <button type="button" className="boton-secundario" onClick={actualizar}>Reintentar consulta</button></p>}
    <dialog id={idDialogo} ref={dialogo} className="co-color-m4-dialogo" aria-labelledby={idDialogo+'-titulo'}
      aria-busy={guardando} onCancel={e => { e.preventDefault(); if (!guardando) setAbierto(false) }}>
      <h2 id={idDialogo+'-titulo'}>Registrar {lecturasColor.find(l => l.tipo === (pendiente?.tipo ?? tipoLectura))?.etiqueta ?? 'color'}</h2>
      {mensaje && <p className={exito ? 'mensaje-exito' : 'mensaje-error'} role={exito ? 'status' : 'alert'}>{mensaje}</p>}
      {error && <p role="alert">{error}</p>}
      {pendiente ? <div className="operacion-pendiente">
        <p>{lecturasColor.find(l => l.tipo === (pendiente.tipo ?? 'color_m4'))?.etiqueta ?? 'Color'} pendiente de confirmar: <strong>{pendiente.valor}</strong></p>
        <button type="button" className="boton-primario" disabled={guardando}
          onClick={() => { void ejecutar(pendiente.operacion) }}>Reintentar la misma lectura</button>
        <button type="button" className="boton-secundario" disabled={guardando} onClick={() => setAbierto(false)}>Cerrar</button>
      </div> : <form onSubmit={e => { e.preventDefault(); void ejecutar('lectura') }}>
        {tipoLectura === 'color_m4' && seguimiento?.instruccion && <p className="notas-turno">Aviso: {seguimiento.instruccion}</p>}
        <label>{lecturasColor.find(l => l.tipo === tipoLectura)?.etiqueta ?? 'Color'}<input type="text" inputMode="decimal" autoComplete="off" required value={valor}
          disabled={guardando || !habilitado} onChange={e => setValor(e.target.value)} /></label>
        <div className="acciones-turno">
          <button type="submit" className="boton-primario" disabled={guardando || !habilitado || !muestraHabitual}>{guardando ? 'Guardando…' : 'Guardar'}</button>
          <button type="button" className="boton-secundario" disabled={guardando} onClick={() => setAbierto(false)}>Cancelar</button>
        </div>
      </form>}
    </dialog>
  </>
  const ahora = ahoraAvisosAdmin
  const fechaMinima = fechaMexicoAdmin(new Date(ahora).toISOString()).slice(0, 10)
  const avisosVigentes = avisosAdmin.filter(aviso => aviso.permanente === true || typeof aviso.fin !== 'string' || Date.parse(aviso.fin) > ahora)
  const programados = avisosVigentes.filter(aviso => aviso.permanente !== true && typeof aviso.inicio === 'string' && Date.parse(aviso.inicio) > ahora)
  const activos = avisosVigentes.filter(aviso => !programados.includes(aviso))
  return <>
    <section className="co-seguimiento-m4 co-seguimiento-admin" aria-label="Avisos para operadores" aria-busy={guardandoAvisoAdmin || cargandoAvisosAdmin}>
      <header className="co-avisos-admin-cabecera">
        <div className="co-avisos-admin-titulo">
          <h2>Avisos para operadores</h2>
          <span className="co-avisos-admin-conteo">{activos.length} {activos.length === 1 ? 'activo' : 'activos'}</span>
          {programados.length > 0 && <span className="co-avisos-admin-conteo co-aviso-admin-programado">{programados.length} {programados.length === 1 ? 'programado' : 'programados'}</span>}
        </div>
        <div className="co-avisos-admin-acciones">
          <button type="button" className="co-aviso-admin-programar" aria-expanded={esProgramado} disabled={avisoOcupado}
            onClick={() => abrirFormularioAviso('programar')}><Calendar size={16} aria-hidden="true" />Programar</button>
          <button type="button" className="co-aviso-admin-mas" aria-label="Agregar aviso" aria-expanded={modoAviso === 'publicar'} disabled={avisoOcupado}
            onClick={() => abrirFormularioAviso('publicar')}><Plus size={20} aria-hidden="true" /></button>
        </div>
      </header>
      {cargandoAvisosAdmin && !cargadosAvisosAdmin && <p className="co-avisos-admin-estado">Consultando avisos…</p>}
      {errorAvisosAdmin && <p className="co-avisos-admin-error" role="alert">{errorAvisosAdmin} <button type="button" className="boton-secundario" onClick={() => setRevisionAvisosAdmin(n => n + 1)}>Reintentar</button></p>}
      {[...activos, ...programados].map(aviso => {
        const mensajeAviso = typeof aviso.mensaje === 'string' ? aviso.mensaje : ''
        const autor = esAutorAviso(cuenta,aviso)
        const programado = programados.includes(aviso)
        const accion = programado ? 'Cancelar' : 'Quitar'
        const detalle = programado && typeof aviso.inicio === 'string' && typeof aviso.fin === 'string'
          ? horarioProgramado(aviso.inicio, aviso.fin)
          : detalleDuracionAviso(aviso) + (typeof aviso.creado_en === 'string' ? ` · Publicado ${fechaHoraAviso(aviso.creado_en)}` : '')
        return <article className="co-aviso-admin-fila" key={aviso.id}>
          <div className="co-aviso-admin-detalle"><strong>{mensajeAviso}</strong><span>{detalle}</span></div>
          <span className={`co-aviso-admin-activo${programado ? ' co-aviso-admin-programado' : ''}`}>{programado ? 'Programado' : 'Activo'}</span>
          <button type="button" className="co-aviso-admin-quitar" disabled={!autor || avisoOcupado}
            title={autor ? `${accion} aviso` : 'Solo la cuenta que creó el aviso puede quitarlo o cancelarlo'}
            onClick={() => { void quitarAvisoAdmin(aviso, programado) }}>{accion}</button>
        </article>
      })}
      {cargadosAvisosAdmin && !errorAvisosAdmin && avisosVigentes.length === 0 && <p className="co-avisos-admin-estado">No hay avisos activos ni programados.</p>}
      {hayMasAvisosAdmin && <p className="co-avisos-admin-estado">Se muestran hasta 50 avisos.</p>}
      {exitoAvisoAdmin && <p className="co-avisos-admin-exito" role="status">{exitoAvisoAdmin}</p>}
      {errorGuardarAvisoAdmin && <p className="co-avisos-admin-error" role="alert">{errorGuardarAvisoAdmin}</p>}
      {modoAviso && <form className={`co-aviso-admin-nuevo${esProgramado ? ' co-aviso-admin-horario' : ''}`} onSubmit={e => { e.preventDefault(); void publicarAvisoAdmin() }}>
        <strong>Nuevo aviso</strong>
        <label className="co-aviso-admin-texto"><span>Texto del aviso</span><textarea ref={textoAvisoAdminRef} rows={1} maxLength={4000} required value={textoAvisoAdmin}
          placeholder="Escribe el aviso para los operadores" disabled={avisoOcupado}
          onChange={e => setTextoAvisoAdmin(e.target.value)} /></label>
        {esProgramado ? <>
          <label><span>Fecha</span><input type="date" required min={fechaMinima} value={fechaProgramada} disabled={avisoOcupado} onChange={e => setFechaProgramada(e.target.value)} /></label>
          <label><span>Hora de inicio</span><input type="time" required value={horaInicio} disabled={avisoOcupado} onChange={e => setHoraInicio(e.target.value)} /></label>
          <label><span>Hora de fin</span><input type="time" required value={horaFin} disabled={avisoOcupado} onChange={e => setHoraFin(e.target.value)} /></label>
        </> : <label><span>Duración</span><select value={duracionAvisoAdmin} disabled={avisoOcupado}
          onChange={e => setDuracionAvisoAdmin(e.target.value as DuracionAviso)}>
          {opcionesDuracionAviso.map(opcion => <option key={opcion.valor} value={opcion.valor}>{opcion.etiqueta}</option>)}
        </select></label>}
        <button type="submit" className="boton-primario" disabled={guardandoAvisoAdmin || (!textoAvisoAdmin.trim() && !solicitudAvisoAdmin)}>
          {guardandoAvisoAdmin ? 'Guardando…' : solicitudAvisoAdmin ? 'Comprobar / reintentar' : esProgramado ? 'Programar' : 'Publicar'}
        </button>
      </form>}
    </section>
  </>
}
