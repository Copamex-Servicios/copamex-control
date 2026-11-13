import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSeguimientoCalidad } from '../../hooks/useSeguimientoCalidad'
import { ejecutarSeguimiento, pendienteSeguimiento } from '../../lib/seguimientoCalidad'
import type { SolicitudSeguimiento } from '../../lib/seguimientoCalidad'
import type { TurnoOperativo } from '../../lib/tiposTurno'
import { claveResultadoCalidad, validarCamposCalidad } from '../../lib/calidad'
import { mayusculasNota } from '../../lib/notasOperativas'
import './seguimientoColorM4.css'

interface Props {
  cuenta: string; administracion?: boolean; turno?: TurnoOperativo | null
  habilitado?: boolean; muestraHabitual?: boolean; alGuardar?: () => void
  contenedorAcciones?: HTMLDivElement | null
}
export function SeguimientoColorM4({ cuenta, administracion = false, turno, habilitado = false, muestraHabitual = false, alGuardar, contenedorAcciones }: Props) {
  const { seguimiento, error, cargando, actualizar } = useSeguimientoCalidad(cuenta)
  const [instruccion, setInstruccion] = useState('')
  const [valor, setValor] = useState('')
  const [abierto, setAbierto] = useState(() => !!pendienteSeguimiento(cuenta))
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [exito, setExito] = useState(false)
  const [pendiente, setPendiente] = useState(() => pendienteSeguimiento(cuenta))
  const ocupado = useRef(false), peticion = useRef<AbortController | null>(null)
  const dialogo = useRef<HTMLDialogElement>(null)
  const idDialogo = useId()
  const modalAbierto = !administracion && abierto
  useEffect(() => () => peticion.current?.abort(),[])
  useEffect(() => {
    if (!exito || !mensaje) return
    const temporizador = window.setTimeout(() => setMensaje(null),10000)
    return () => window.clearTimeout(temporizador)
  },[exito,mensaje])
  useEffect(() => {
    const elemento = dialogo.current
    if (!modalAbierto || !elemento) return
    elemento.showModal()
    elemento.querySelector<HTMLInputElement>('input')?.focus()
    const previo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { elemento.close(); document.body.style.overflow = previo }
  },[modalAbierto])

  async function ejecutar(operacion: SolicitudSeguimiento['operacion']) {
    if (ocupado.current) return
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
          if (!seguimiento || !turno || !habilitado || !muestraHabitual) throw new Error('Se requiere tu turno abierto y su muestra habitual de Calidad.')
          const numero = validarCamposCalidad({ notas:'',valores:{ [claveResultadoCalidad(seguimiento.punto_id,seguimiento.parametro_id)]:valor } }).resultados[0].valor
          solicitud = { id:crypto.randomUUID(),operacion,turno:turno.id,seguimiento:seguimiento.id,valor:numero }
        }
      }
      ocupado.current = true; setGuardando(true); setPendiente(solicitud); setMensaje(null); setExito(false)
      const control = new AbortController(); peticion.current = control
      const limite = window.setTimeout(() => control.abort(),25000)
      try { await ejecutarSeguimiento(cuenta,solicitud,control.signal) }
      finally { window.clearTimeout(limite); peticion.current = null }
      setExito(true)
      setMensaje(solicitud.operacion === 'lectura' ? 'Lectura adicional de color M4 guardada.'
        : solicitud.operacion === 'activar' ? 'Activación y aviso confirmados. Revisa el estado actual.' : 'Seguimiento y aviso finalizados.')
      setValor(''); setAbierto(false); actualizar()
      if (solicitud.operacion === 'lectura') alGuardar?.()
    } catch (e) { setExito(false); setMensaje(e instanceof Error ? e.message : 'No se confirmó la operación. Reintenta.') }
    finally { setPendiente(pendienteSeguimiento(cuenta)); ocupado.current = false; setGuardando(false) }
  }
  const bloqueado = guardando || !!pendiente
  const puedeFinalizar = seguimiento?.creado_por === cuenta
  const botonTomar = !administracion && (seguimiento || pendiente) && <button type="button" className="boton-primario co-tomar-color-m4"
    aria-haspopup="dialog" aria-controls={idDialogo}
    disabled={guardando || (!pendiente && (!habilitado || !muestraHabitual || !!error))}
    title={!muestraHabitual ? 'Registra primero la muestra habitual del turno' : !habilitado ? 'Se requiere tu turno abierto y disponible' : 'Registrar una lectura adicional de color M4'}
    onClick={() => { setAbierto(true); setMensaje(null) }}>Tomar color M4</button>
  if (!administracion) return <>
    {contenedorAcciones ? createPortal(botonTomar,contenedorAcciones) : botonTomar}
    {!abierto && mensaje && <p className={exito ? 'mensaje-exito' : 'mensaje-error'} role={exito ? 'status' : 'alert'}>{mensaje}</p>}
    {!abierto && error && <p role="alert">{error} <button type="button" className="boton-secundario" onClick={actualizar}>Reintentar consulta</button></p>}
    <dialog id={idDialogo} ref={dialogo} className="co-color-m4-dialogo" aria-labelledby={idDialogo+'-titulo'}
      aria-busy={guardando} onCancel={e => { e.preventDefault(); if (!guardando) setAbierto(false) }}>
      <h2 id={idDialogo+'-titulo'}>Tomar color M4</h2>
      {mensaje && <p className={exito ? 'mensaje-exito' : 'mensaje-error'} role={exito ? 'status' : 'alert'}>{mensaje}</p>}
      {error && <p role="alert">{error}</p>}
      {pendiente ? <div className="operacion-pendiente">
        <p>Color pendiente de confirmar: <strong>{pendiente.valor}</strong></p>
        <button type="button" className="boton-primario" disabled={guardando}
          onClick={() => { void ejecutar(pendiente.operacion) }}>Reintentar la misma lectura</button>
        <button type="button" className="boton-secundario" disabled={guardando} onClick={() => setAbierto(false)}>Cerrar</button>
      </div> : seguimiento ? <form onSubmit={e => { e.preventDefault(); void ejecutar('lectura') }}>
        <label>Color M4<input type="text" inputMode="decimal" autoComplete="off" required value={valor}
          disabled={guardando || !habilitado} onChange={e => setValor(e.target.value)} /></label>
        <div className="acciones-turno">
          <button type="submit" className="boton-primario" disabled={guardando || !habilitado || !muestraHabitual || !!error}>{guardando ? 'Guardando…' : 'Guardar'}</button>
          <button type="button" className="boton-secundario" disabled={guardando} onClick={() => setAbierto(false)}>Cancelar</button>
        </div>
      </form> : <><p>El seguimiento ya no está activo.</p><button type="button" className="boton-secundario" onClick={() => setAbierto(false)}>Cerrar</button></>}
    </dialog>
  </>
  return <>
    <section className="co-seguimiento-m4 co-seguimiento-admin" aria-label="Seguimiento de color M4" aria-busy={guardando}>
    <div className="co-seguimiento-cabecera"><h2>Seguimiento de color M4</h2><span className={seguimiento ? 'co-seguimiento-activo' : ''}>{seguimiento ? 'Activo' : cargando ? 'Consultando…' : 'Inactivo'}</span></div>
    {error && <div><p className="mensaje-error" role="alert">{error}</p><button type="button" className="boton-secundario" disabled={guardando} onClick={actualizar}>Reintentar consulta</button></div>}
    {seguimiento && <p className="notas-turno">{seguimiento.instruccion}</p>}
    {pendiente && <div className="operacion-pendiente"><strong>Operación pendiente de confirmación</strong>
      <p>{pendiente.operacion === 'lectura' ? `Color enviado: ${pendiente.valor}. Se conserva el turno original.` : 'Se conserva la solicitud original del seguimiento.'}</p>
      <button type="button" className="boton-primario" disabled={guardando} onClick={() => { void ejecutar(pendiente.operacion) }}>Reintentar la misma solicitud</button></div>}
    {mensaje && <p className={exito ? 'mensaje-exito' : 'mensaje-error'} role={exito ? 'status' : 'alert'}>{mensaje}</p>}
    {seguimiento ? <>
      <button type="button" className="boton-secundario" disabled={bloqueado || !puedeFinalizar} onClick={() => { void ejecutar('finalizar') }}>Finalizar seguimiento</button>
      {!puedeFinalizar && <small>Solo la cuenta creadora puede finalizar el aviso vinculado.</small>}
    </> : <form onSubmit={e => { e.preventDefault(); void ejecutar('activar') }}>
      <input className="co-seguimiento-instruccion" aria-label="Instrucciones para los operadores" type="text" maxLength={4000} required
        placeholder="Ej. Tomar color M4 cada dos horas hasta nuevo aviso"
        value={instruccion} disabled={bloqueado || cargando || !!error} onChange={e => setInstruccion(mayusculasNota(e.target.value))} />
      <button type="submit" className="boton-primario" disabled={bloqueado || cargando || !!error}>Activar</button>
    </form>}
  </section>
  </>
}
