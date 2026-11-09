import { Icono } from '../diseno/Icono'
import { Pencil } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { CamposInicioTurno } from '../../hooks/useTurno'
import { useRelojServidor } from '../../hooks/useRelojServidor'
import type { Operador } from '../../lib/tiposTurno'
import './inicioEmpleado.css'
import { buscarOperadorEmpleado } from '../../lib/operadoresTurno'
import { esTipoTurno, tipoTurnoPorHora } from '../../lib/turnos'

const horariosTurno = {
  dia: 'Día · 7:01 a. m. a 3:00 p. m.',
  tarde: 'Tarde · 3:01 p. m. a 9:00 p. m.',
  noche: 'Noche · 9:01 p. m. a 7:00 a. m. del día siguiente',
}

interface PropsInicioTurno {
  operadores: readonly Operador[]
  alGuardar: (campos: CamposInicioTurno) => Promise<boolean>
  deshabilitado?: boolean
  modo?: 'iniciar' | 'cambiar'
  alCancelar?: () => void
}

export function InicioTurno({
  operadores, alGuardar, deshabilitado = false, modo = 'iniciar', alCancelar,
}: PropsInicioTurno) {
  const id = useId()
  const reloj = useRelojServidor()
  const tipo = reloj.estado === 'listo' ? tipoTurnoPorHora(reloj.hora) : null
  const [numero, setNumero] = useState('')
  const [numeroAcompanante, setNumeroAcompanante] = useState('')
  const [operador, setOperador] = useState<Operador | null>(null)
  const [confirmacion, setConfirmacion] = useState<{ operador: Operador; acompanante: Operador } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const envioActivo = useRef(false)
  const acompananteRef = useRef<HTMLInputElement>(null)
  const [capturaAcompanante, setCapturaAcompanante] = useState(false)
  const bloqueado = deshabilitado || enviando || !tipo
  const cambio = modo === 'cambiar'

  useEffect(() => {
    if (capturaAcompanante && !confirmacion) acompananteRef.current?.focus()
  }, [capturaAcompanante, confirmacion])

  function buscar(evento: FormEvent<HTMLFormElement>): void {
    evento.preventDefault()
    if (bloqueado || envioActivo.current) return
    setError(null)
    if (!esTipoTurno(tipo)) { setError('Selecciona el tipo de turno.'); return }
    try {
      if (!capturaAcompanante) {
        setOperador(buscarOperadorEmpleado(operadores, numero))
        setNumeroAcompanante('')
        setConfirmacion(null)
        setCapturaAcompanante(true)
        return
      }
      if (!operador) throw new Error('Primero identifica al operador inicial.')
      const acompanante = buscarOperadorEmpleado(operadores, numeroAcompanante)
      if (acompanante.id === operador.id) throw new Error('Ingresa el número de otro operador; no puede repetirse.')
      setConfirmacion({ operador, acompanante })
    } catch (e) { setConfirmacion(null); setError(e instanceof Error ? e.message : 'No se pudo identificar al operador.') }
  }
  async function confirmar(): Promise<void> {
    if (bloqueado || envioActivo.current || !confirmacion || !esTipoTurno(tipo)) return
    try {
      const actual = buscarOperadorEmpleado(operadores, numero)
      const actualAcompanante = buscarOperadorEmpleado(operadores, numeroAcompanante)
      if (actual.id !== confirmacion.operador.id || actual.nombre !== confirmacion.operador.nombre
        || actualAcompanante.id !== confirmacion.acompanante.id || actualAcompanante.nombre !== confirmacion.acompanante.nombre) {
        setConfirmacion(null); setError('Cambió un operador. Presiona Enter para comprobarlos de nuevo.'); return
      }
      envioActivo.current = true; setEnviando(true); setError(null)
      const guardado = await alGuardar({ tipoTurno: tipo,
        nombreOperador: actual.nombre, operadorId: actual.id, numeroEmpleado: numero.trim(),
        nombreOperadorAcompanante: actualAcompanante.nombre, operadorAcompananteId: actualAcompanante.id,
        numeroEmpleadoAcompanante: numeroAcompanante.trim() })
      if (guardado) { setConfirmacion(null); setOperador(null); setNumero(''); setNumeroAcompanante(''); setCapturaAcompanante(false) }
    } catch (e) {
      setConfirmacion(null)
      setError(e instanceof Error ? e.message : 'No se pudo completar la operación.')
    } finally { envioActivo.current = false; setEnviando(false) }
  }

  return (
    <form className="formulario-turno" onSubmit={buscar} aria-busy={enviando}>
      

      <fieldset className="campos-turno" disabled={bloqueado}>
        <legend>{cambio ? 'Datos del nuevo turno' : 'Datos del turno'}</legend>

        <div className="campo-turno">
          <label htmlFor={`${id}-fecha`}>Fecha y hora (México)</label>
          <output id={`${id}-fecha`}>
            {reloj.estado === 'listo'
              ? `${reloj.fecha} · ${reloj.hora}`
              : reloj.estado === 'error' ? 'Fecha y hora no disponibles' : 'Consultando fecha y hora…'}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M8 3v4m8-4v4M4 10h16" /></svg>
          </output>
          
          {reloj.estado === 'error' && (
            <p className="ayuda-turno">Revisa la conexión para consultar el turno correspondiente. Vuelve a esta ventana para reintentar.</p>
          )}
        </div>

        {!capturaAcompanante ? <div className="campo-turno campo-turno-ancho">
          <label htmlFor={id + '-empleado'}>Número de empleado — primer operador</label>
          <input id={id + '-empleado'} name="numero_empleado" type="text" required
            autoComplete="off" value={numero} placeholder="Escribe tu número y presiona Enter"
            onChange={evento => { setNumero(evento.target.value); setOperador(null); setConfirmacion(null); setError(null) }} />
          <span className="co-empleado-icono" aria-hidden="true"><Icono nombre="cuenta" /></span>
        </div> : <>
          <div className="campo-turno campo-turno-ancho">
            <label htmlFor={id + '-empleado'}>Primer operador</label>
            <div className="turno-operador-confirmado">
              <output id={id + '-empleado'}>{operador?.nombre}</output>
              <button className="boton-icono turno-editar-operador" type="button" aria-label="Editar primer operador" title="Editar primer operador" onClick={() => { setCapturaAcompanante(false); setOperador(null); setNumero(''); setNumeroAcompanante(''); setConfirmacion(null) }}><Pencil aria-hidden="true" /></button>
            </div>
          </div>
          <div className="campo-turno campo-turno-ancho">
            <label htmlFor={id + '-empleado-acompanante'}>{confirmacion ? 'Segundo operador' : 'Número de empleado — segundo operador'}</label>
            {confirmacion ? <>
              <div className="turno-operador-confirmado">
                <output id={id + '-empleado-acompanante'}>{confirmacion.acompanante.nombre}</output>
                <button className="boton-icono turno-editar-operador" type="button" aria-label="Editar segundo operador" title="Editar segundo operador" onClick={() => { setConfirmacion(null); setNumeroAcompanante('') }}><Pencil aria-hidden="true" /></button>
              </div>
            </> :
            <input ref={acompananteRef} id={id + '-empleado-acompanante'} name="numero_empleado_acompanante" type="text" required
              autoComplete="off" value={numeroAcompanante} placeholder="Escribe su número y presiona Enter"
              onChange={evento => { setNumeroAcompanante(evento.target.value); setConfirmacion(null); setError(null) }} />}
          </div>
        </>}

        <div className="campo-turno">
          <label htmlFor={`${id}-tipo`}>Turno correspondiente</label>
          <output id={`${id}-tipo`} aria-live="polite">{tipo ? horariosTurno[tipo].split(' · ')[0] : reloj.estado === 'error' ? 'Turno no disponible' : 'Consultando turno…'}</output>
          {tipo && <p className="ayuda-turno">{horariosTurno[tipo].split(' · ')[1]}</p>}
        </div>

      </fieldset>

      {confirmacion && <section className="co-confirmar-empleado" aria-label="Confirmar operadores" aria-live="polite">
        <div><p>{cambio ? '¿Deseas cambiar de turno?' : '¿Deseas iniciar turno?'}</p></div>
        <div className="co-confirmar-empleado-botones">
          <button type="button" className="boton-primario" disabled={bloqueado} onClick={() => { void confirmar() }}>{enviando ? 'Guardando…' : cambio ? 'Sí, cambiar de turno' : 'Sí, iniciar turno'}</button>
          <button type="button" className="boton-secundario" disabled={bloqueado} onClick={() => setConfirmacion(null)}>Cancelar</button>
        </div>
      </section>}
      {error && <p className="mensaje-error" role="alert">{error}</p>}
      <div className="acciones-turno">
        {!confirmacion && <button className="boton-primario" type="submit" disabled={bloqueado}>
          <Icono nombre="cuenta" /> Identificar {capturaAcompanante ? 'segundo' : 'primer'} operador
        </button>}
        {alCancelar && (
          <button className="boton-secundario" type="button" onClick={alCancelar} disabled={bloqueado}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  )
}
