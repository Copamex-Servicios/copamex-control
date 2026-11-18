import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSeguimientoCalidad } from '../../hooks/useSeguimientoCalidad'
import { ejecutarSeguimiento, pendienteSeguimiento } from '../../lib/seguimientoCalidad'
import { validarValorNumericoCalidad } from '../../lib/calidad'
import type { SolicitudSeguimiento, TipoLecturaColor } from '../../lib/seguimientoCalidad'
import type { TurnoOperativo } from '../../lib/tiposTurno'
import { mayusculasNota } from '../../lib/notasOperativas'
import './seguimientoColorM4.css'

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
  const { seguimiento, error, cargando, actualizar } = useSeguimientoCalidad(cuenta)
  const [instruccion, setInstruccion] = useState('')
  const [valor, setValor] = useState('')
  const [tipoLectura, setTipoLectura] = useState<TipoLecturaColor>(() => pendienteSeguimiento(cuenta)?.tipo ?? 'color_m4')
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
    const temporizador = window.setTimeout(() => setMensaje(null),5000)
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
    } catch (e) { setExito(false); setMensaje(e instanceof Error ? e.message : 'No se confirmó la operación. Reintenta.') }
    finally { setPendiente(pendienteSeguimiento(cuenta)); ocupado.current = false; setGuardando(false) }
  }
  const bloqueado = guardando || !!pendiente
  const puedeFinalizar = seguimiento?.creado_por === cuenta
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
    <section className="co-seguimiento-m4 co-seguimiento-admin" aria-label="Aviso" aria-busy={guardando}>
    <div className="co-seguimiento-cabecera"><h2>Aviso</h2><span className={seguimiento ? 'co-seguimiento-activo' : ''}>{seguimiento ? 'Activo' : cargando ? 'Consultando…' : 'Inactivo'}</span></div>
    {error && <div><p className="mensaje-error" role="alert">{error}</p><button type="button" className="boton-secundario" disabled={guardando} onClick={actualizar}>Reintentar consulta</button></div>}
    {seguimiento && <p className="notas-turno">{seguimiento.instruccion}</p>}
    {pendiente && <div className="operacion-pendiente"><strong>Operación pendiente de confirmación</strong>
      <p>{pendiente.operacion === 'lectura' ? `Color enviado: ${pendiente.valor}. Se conserva el turno original.` : 'Se conserva la solicitud original del seguimiento.'}</p>
      <button type="button" className="boton-primario" disabled={guardando} onClick={() => { void ejecutar(pendiente.operacion) }}>Reintentar la misma solicitud</button></div>}
    {mensaje && <p className={exito ? 'mensaje-exito' : 'mensaje-error'} role={exito ? 'status' : 'alert'}>{mensaje}</p>}
    {seguimiento ? <>
      <button type="button" className="boton-secundario admin-finalizar-aviso" disabled={bloqueado || !puedeFinalizar} onClick={() => { void ejecutar('finalizar') }}>Finalizar</button>
      {!puedeFinalizar && <small>Solo la cuenta creadora puede finalizar el aviso vinculado.</small>}
    </> : <form onSubmit={e => { e.preventDefault(); void ejecutar('activar') }}>
      <input className="co-seguimiento-instruccion" aria-label="Aviso para los operadores" type="text" maxLength={4000} required
        placeholder="Escribe el aviso para los operadores"
        value={instruccion} disabled={bloqueado || cargando || !!error} onChange={e => setInstruccion(mayusculasNota(e.target.value))} />
      <button type="submit" className="boton-primario" disabled={bloqueado || cargando || !!error}>Activar</button>
    </form>}
  </section>
  </>
}
