import { Icono } from '../diseno/Icono'
import { useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { CamposInicioTurno } from '../../hooks/useTurno'
import { useRelojServidor } from '../../hooks/useRelojServidor'
import type { Operador } from '../../lib/tiposTurno'
import './inicioEmpleado.css'
import { buscarOperadorEmpleado } from '../../lib/operadoresTurno'
import { esTipoTurno } from '../../lib/turnos'

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
  const [tipo, setTipo] = useState('')
  const [numero, setNumero] = useState('')
  const [confirmacion, setConfirmacion] = useState<Operador | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const envioActivo = useRef(false)
  const bloqueado = deshabilitado || enviando
  const cambio = modo === 'cambiar'

  function buscar(evento: FormEvent<HTMLFormElement>): void {
    evento.preventDefault()
    if (bloqueado || envioActivo.current) return
    setError(null)
    if (!esTipoTurno(tipo)) { setError('Selecciona el tipo de turno.'); return }
    try { setConfirmacion(buscarOperadorEmpleado(operadores, numero)) }
    catch (e) { setConfirmacion(null); setError(e instanceof Error ? e.message : 'No se pudo identificar al operador.') }
  }
  async function confirmar(): Promise<void> {
    if (bloqueado || envioActivo.current || !confirmacion || !esTipoTurno(tipo)) return
    try {
      const operador = buscarOperadorEmpleado(operadores, numero)
      if (operador.id !== confirmacion.id || operador.nombre !== confirmacion.nombre) {
        setConfirmacion(null); setError('El operador cambió. Presiona Enter para comprobarlo de nuevo.'); return
      }
      envioActivo.current = true; setEnviando(true); setError(null)
      const guardado = await alGuardar({ tipoTurno: tipo, nombreOperador: operador.nombre,
        operadorId: operador.id, numeroEmpleado: numero.trim() })
      if (guardado) setConfirmacion(null)
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
            <p className="ayuda-turno">Revisa la conexión. La fecha de inicio se asignará automáticamente al guardar.</p>
          )}
        </div>

        <div className="campo-turno campo-turno-ancho">
          <label htmlFor={id + '-empleado'}>Número de empleado</label>
          <input id={id + '-empleado'} name="numero_empleado" type="text" required
            autoComplete="off" value={numero} placeholder="Escribe tu número"
            onChange={evento => { setNumero(evento.target.value); setConfirmacion(null); setError(null) }} />
          <span className="co-empleado-icono" aria-hidden="true"><Icono nombre="cuenta" /></span>
        </div>

        <div className="campo-turno">
          <label htmlFor={`${id}-tipo`}>Tipo de turno</label>
          <select id={`${id}-tipo`} name="tipo_turno" required
            value={tipo} onChange={(evento) => { setTipo(evento.target.value); setConfirmacion(null); setError(null) }}>
            <option value="" disabled>Selecciona un turno</option>
            <option value="dia">Día</option>
            <option value="tarde">Tarde</option>
            <option value="noche">Noche</option>
          </select>
        </div>

      </fieldset>

      {confirmacion && <section className="co-confirmar-empleado" aria-label="Confirmar operador" aria-live="polite">
        <div><span>Operador identificado</span><strong>{confirmacion.nombre}</strong>
          <p>{cambio ? '¿Deseas cambiar de turno?' : '¿Deseas iniciar turno?'}</p></div>
        <div className="co-confirmar-empleado-botones">
          <button type="button" className="boton-primario" disabled={bloqueado} onClick={() => { void confirmar() }}>{enviando ? 'Guardando…' : cambio ? 'Sí, cambiar de turno' : 'Sí, iniciar turno'}</button>
          <button type="button" className="boton-secundario" disabled={bloqueado} onClick={() => setConfirmacion(null)}>Cancelar</button>
        </div>
      </section>}
      {error && <p className="mensaje-error" role="alert">{error}</p>}
      <div className="acciones-turno">
        <button className="boton-primario" type="submit" disabled={bloqueado}>
          <Icono nombre="cuenta" /> Identificar operador
        </button>
        {alCancelar && (
          <button className="boton-secundario" type="button" onClick={alCancelar} disabled={bloqueado}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  )
}
