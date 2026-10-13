import { useId, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { ErrorBitacora, validarCamposBitacora } from '../../lib/bitacora'
import type { CamposBitacora, LecturaBitacora } from '../../lib/tiposBitacora'

interface Props {
  original?: LecturaBitacora
  accionSecundaria?: ReactNode
  deshabilitado: boolean
  alGuardar: (campos: CamposBitacora) => Promise<boolean>
}
export function FormularioBitacora({ original, deshabilitado, alGuardar, accionSecundaria }: Props) {
  const id = useId()
  const [texto, setTexto] = useState(original?.texto ?? '')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [confirmado, setConfirmado] = useState(false)
  const activo = useRef(false)
  const bloqueado = deshabilitado || enviando || confirmado
  async function guardar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (bloqueado || activo.current) return
    try { validarCamposBitacora({ texto }) }
    catch (e) { setError(e instanceof ErrorBitacora ? e.message : 'Revisa la nota.'); return }
    activo.current = true; setEnviando(true); setError(null)
    try { if (await alGuardar({ texto })) setConfirmado(true) }
    catch { setError('No se pudo confirmar el guardado. Revisa el mensaje de Bitácora.') }
    finally { activo.current = false; setEnviando(false) }
  }
  return <form className="formulario-turno formulario-bitacora" onSubmit={guardar} aria-busy={enviando}>
    
    <div className="campo-turno">
      <label htmlFor={`${id}-texto`}>{original ? 'Corregir texto de la nota' : 'Lo relevante del turno'}</label>
      <textarea id={`${id}-texto`} name="texto" rows={5} required value={texto} disabled={bloqueado}
        aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}
        onChange={e => {
          if (bloqueado || activo.current) return
          setTexto(e.target.value); setError(null)
        }} />
    </div>
    {error && <p id={`${id}-error`} className="mensaje-error" role="alert">{error}</p>}
    <div className="acciones-turno">{accionSecundaria}<button className="boton-primario" type="submit" disabled={bloqueado}>
      {enviando ? 'Guardando…' : original ? 'Guardar corrección' : 'Guardar nota'}
    </button></div>
  </form>
}
