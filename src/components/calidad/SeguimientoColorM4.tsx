import { useEffect, useId, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useSeguimientoCalidad } from '../../hooks/useSeguimientoCalidad'
import { ejecutarSeguimiento, pendienteSeguimiento } from '../../lib/seguimientoCalidad'
import { validarValorNumericoCalidad } from '../../lib/calidad'
import type { SolicitudSeguimiento, TipoLecturaColor } from '../../lib/seguimientoCalidad'
import type { TurnoOperativo } from '../../lib/tiposTurno'
import { mayusculasNota } from '../../lib/notasOperativas'
import { supabase } from '../../lib/supabase'
import { configuracionAdmin, ErrorAdmin, guardarAdministracion, leerFilaAdmin } from '../../lib/administracion'
import type { FilaAdmin, SolicitudAdmin } from '../../lib/administracion'
import { finalizarAviso } from '../../lib/finalizarAviso'
import { escucharCambiosInformacion, intervaloAviso, notificarInformacionActualizada } from '../../lib/actualizacionInformacion'
import { esAutorAviso } from '../../lib/permisosAvisos'
import './seguimientoColorM4.css'

type DuracionAviso = '1' | '2' | '4' | '8' | '12' | '24' | 'hasta_quitar'
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
  const [hayMasAvisosAdmin, setHayMasAvisosAdmin] = useState(false)
  const [cargandoAvisosAdmin, setCargandoAvisosAdmin] = useState(false)
  const [cargadosAvisosAdmin, setCargadosAvisosAdmin] = useState(false)
  const [errorAvisosAdmin, setErrorAvisosAdmin] = useState<string | null>(null)
  const [revisionAvisosAdmin, setRevisionAvisosAdmin] = useState(0)
  const [nuevoAvisoAbierto, setNuevoAvisoAbierto] = useState(false)
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
  useEffect(() => {
    const campo = textoAvisoAdminRef.current
    if (!campo) return
    campo.style.height = 'auto'
    campo.style.height = `${campo.scrollHeight}px`
  }, [textoAvisoAdmin, nuevoAvisoAbierto])
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
          .or('permanente.eq.true,and(or(inicio.is.null,inicio.lte.now),or(fin.is.null,fin.gt.now))')
          .order('creado_en',{ ascending:false }).limit(51).abortSignal(control.signal)
        if (!vivo || control.signal.aborted) return
        if (error || !Array.isArray(data)) throw new Error('Consulta no disponible')
        setHayMasAvisosAdmin(data.length > 50)
        setAvisosAdmin(data.slice(0,50).map(fila => leerFilaAdmin(fila,c)))
        setErrorAvisosAdmin(null)
      } catch {
        if (vivo && !control.signal.aborted) setErrorAvisosAdmin('No se pudieron consultar los avisos. Reintenta la consulta.')
      } finally {
        window.clearTimeout(limite)
        if (controller === control) controller = null
        if (vivo && !control.signal.aborted) {
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
        const permanente = duracionAvisoAdmin === 'hasta_quitar'
        const inicio = new Date()
        solicitud = {
          cuenta, tabla:'avisos', id:crypto.randomUUID(), original:null,
          valores:{
            mensaje:mensajeLimpio,
            permanente,
            inicio:permanente ? null : inicio.toISOString(),
            fin:permanente ? null : new Date(inicio.getTime() + Number(duracionAvisoAdmin) * 3600000).toISOString(),
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
      setNuevoAvisoAbierto(false)
      setExitoAvisoAdmin('Aviso publicado para los operadores.')
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
  async function quitarAvisoAdmin(aviso: FilaAdmin) {
    if (ocupadoAvisoAdmin.current || !esAutorAviso(cuenta,aviso)) return
    ocupadoAvisoAdmin.current = true
    setGuardandoAvisoAdmin(true)
    setErrorGuardarAvisoAdmin(null)
    setExitoAvisoAdmin(null)
    try {
      if (seguimiento?.id === aviso.id) {
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
  return <>
    <section className="co-seguimiento-m4 co-seguimiento-admin" aria-label="Avisos para operadores" aria-busy={guardandoAvisoAdmin || cargandoAvisosAdmin}>
      <header className="co-avisos-admin-cabecera">
        <div className="co-avisos-admin-titulo"><h2>Avisos para operadores</h2><span className="co-avisos-admin-conteo">{hayMasAvisosAdmin ? '50+' : avisosAdmin.length} {avisosAdmin.length === 1 && !hayMasAvisosAdmin ? 'activo' : 'activos'}</span></div>
        <button type="button" className="co-aviso-admin-mas" aria-label="Agregar aviso" aria-expanded={nuevoAvisoAbierto}
          onClick={() => { setNuevoAvisoAbierto(valor => !valor); setErrorGuardarAvisoAdmin(null); setExitoAvisoAdmin(null) }}><Plus size={20} aria-hidden="true" /></button>
      </header>
      {cargandoAvisosAdmin && !cargadosAvisosAdmin && <p className="co-avisos-admin-estado">Consultando avisos…</p>}
      {errorAvisosAdmin && <p className="co-avisos-admin-error" role="alert">{errorAvisosAdmin} <button type="button" className="boton-secundario" onClick={() => setRevisionAvisosAdmin(n => n + 1)}>Reintentar</button></p>}
      {avisosAdmin.map(aviso => {
        const mensajeAviso = typeof aviso.mensaje === 'string' ? aviso.mensaje : ''
        const autor = esAutorAviso(cuenta,aviso)
        return <article className="co-aviso-admin-fila" key={aviso.id}>
          <div className="co-aviso-admin-detalle"><strong>{mensajeAviso}</strong><span>{detalleDuracionAviso(aviso)}{typeof aviso.creado_en === 'string' ? ` · Publicado ${fechaHoraAviso(aviso.creado_en)}` : ''}</span></div>
          <span className="co-aviso-admin-activo">Activo</span>
          <button type="button" className="co-aviso-admin-quitar" disabled={!autor || guardandoAvisoAdmin}
            title={autor ? 'Quitar aviso' : 'Solo la cuenta que publicó el aviso puede quitarlo'} onClick={() => { void quitarAvisoAdmin(aviso) }}>Quitar</button>
        </article>
      })}
      {cargadosAvisosAdmin && !errorAvisosAdmin && avisosAdmin.length === 0 && <p className="co-avisos-admin-estado">No hay avisos activos para los operadores.</p>}
      {exitoAvisoAdmin && <p className="co-avisos-admin-exito" role="status">{exitoAvisoAdmin}</p>}
      {errorGuardarAvisoAdmin && <p className="co-avisos-admin-error" role="alert">{errorGuardarAvisoAdmin}</p>}
      {nuevoAvisoAbierto && <form className="co-aviso-admin-nuevo" onSubmit={e => { e.preventDefault(); void publicarAvisoAdmin() }}>
        <strong>Nuevo aviso</strong>
        <label><span>Texto del aviso</span><textarea ref={textoAvisoAdminRef} rows={1} maxLength={4000} required value={textoAvisoAdmin}
          placeholder="Escribe el aviso para los operadores" disabled={guardandoAvisoAdmin || !!solicitudAvisoAdmin}
          onChange={e => setTextoAvisoAdmin(e.target.value)} /></label>
        <label><span>Duración</span><select value={duracionAvisoAdmin} disabled={guardandoAvisoAdmin || !!solicitudAvisoAdmin}
          onChange={e => setDuracionAvisoAdmin(e.target.value as DuracionAviso)}>
          {opcionesDuracionAviso.map(opcion => <option key={opcion.valor} value={opcion.valor}>{opcion.etiqueta}</option>)}
        </select></label>
        <button type="submit" className="boton-primario" disabled={guardandoAvisoAdmin || (!textoAvisoAdmin.trim() && !solicitudAvisoAdmin)}>
          {guardandoAvisoAdmin ? 'Publicando…' : solicitudAvisoAdmin ? 'Comprobar / reintentar' : 'Publicar'}
        </button>
      </form>}
    </section>
  </>
}
