import { useRef, useState } from 'react'
import type { CamposInicioTurno } from '../../hooks/useTurno'
import type { Operador, TipoTurno, TurnoOperativo } from '../../lib/tiposTurno'
import { InicioTurno } from './InicioTurno'

interface PropsTurnoActivo {
  turno: TurnoOperativo
  nombreOperador: string
  operadores: readonly Operador[]
  deshabilitado?: boolean
  soloLectura?: boolean
  alCambiar?: (campos: CamposInicioTurno) => Promise<boolean>
  alCerrar?: (notas: string) => Promise<boolean>
}

const nombresTurno: Record<TipoTurno, string> = {
  dia: 'Día', tarde: 'Tarde', noche: 'Noche',
}

const formatoHora = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' })

function fechaOperativa(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-')
  return `${dia}/${mes}/${anio}`
}

export function TurnoActivo({
  turno, nombreOperador, operadores, deshabilitado = false,
  soloLectura = false, alCambiar, alCerrar,
}: PropsTurnoActivo) {
  const [accion, setAccion] = useState<'cambiar' | 'cerrar' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cerrando, setCerrando] = useState(false)
  const cierreActivo = useRef(false)
  const bloqueado = deshabilitado || cerrando
  const abierto = turno.finalizado_en === null
  const puedeCambiar = abierto && !soloLectura && !!alCambiar
  const puedeCerrar = abierto && !soloLectura && !!alCerrar

  function cancelar(): void {
    if (bloqueado || cierreActivo.current) return
    setAccion(null)
    setError(null)
  }

  async function cerrar(): Promise<void> {
    if (!puedeCerrar || !alCerrar || accion !== 'cerrar' || bloqueado || cierreActivo.current) return
    cierreActivo.current = true
    setCerrando(true)
    setError(null)
    try {
      if (await alCerrar('')) {
        setAccion(null)
      }
    } catch {
      setError('No se pudo completar el cierre. Revisa el mensaje del turno antes de volver a intentar.')
    } finally {
      cierreActivo.current = false
      setCerrando(false)
    }
  }

  return (
    <div className="turno-actual">
      <h2>{abierto ? 'Turno actual' : 'Turno cerrado'}</h2>
      <dl className="datos-turno">
        <div><dt>Área</dt><dd>{turno.area === 'calderas' ? 'Calderas' : 'PTAR'}</dd></div>
        <div><dt>Tipo de turno</dt><dd>{nombresTurno[turno.turno]}</dd></div>
        <div><dt>Operador</dt><dd>{nombreOperador}</dd></div>
        <div><dt>Fecha operativa</dt><dd>{fechaOperativa(turno.fecha_operativa)}</dd></div>
        <div>
          <dt>Inicio</dt>
          <dd><time dateTime={turno.iniciado_en}>{formatoHora.format(new Date(turno.iniciado_en))}</time></dd>
        </div>
        {turno.finalizado_en && (
          <div>
            <dt>Cierre</dt>
            <dd><time dateTime={turno.finalizado_en}>{formatoHora.format(new Date(turno.finalizado_en))}</time></dd>
          </div>
        )}
      </dl>

      {!abierto && turno.notas_cierre && <p className="notas-turno">{turno.notas_cierre}</p>}
      

      {accion === null && (puedeCambiar || puedeCerrar) && (
        <div className="acciones-turno">
          {puedeCambiar && (
            <button className="boton-primario" type="button" disabled={bloqueado}
              onClick={() => { if (!bloqueado) setAccion('cambiar') }}>
              Cambiar de turno 
            </button>
          )}
          {puedeCerrar && (
            <button className={puedeCambiar ? 'boton-secundario' : 'boton-primario'} type="button" disabled={bloqueado}
              onClick={() => { if (!bloqueado) setAccion('cerrar') }}>
              Cerrar turno
            </button>
          )}
        </div>
      )}

      {accion === 'cambiar' && puedeCambiar && alCambiar && (
        <div className="gestion-turno">
          <h3>Cambio de turno</h3>
          <InicioTurno modo="cambiar" operadores={operadores} alGuardar={alCambiar}
            deshabilitado={bloqueado} alCancelar={cancelar} />
        </div>
      )}

      {accion === 'cerrar' && puedeCerrar && (
        <div className="formulario-turno gestion-turno" aria-busy={cerrando}>
          <h3>Cierre de turno</h3>
          <p className="texto-secundario">¿Estás seguro de que deseas cerrar tu turno?</p>
          {error && <p className="mensaje-error" role="alert">{error}</p>}
          <div className="acciones-turno">
            <button className="boton-primario" type="button" disabled={bloqueado} onClick={() => { void cerrar() }}>
              {cerrando ? 'Cerrando…' : 'Sí, cerrar turno'}
            </button>
            <button className="boton-secundario" type="button" onClick={cancelar} disabled={bloqueado}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
