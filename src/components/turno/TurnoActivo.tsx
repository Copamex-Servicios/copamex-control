import { useState } from 'react'
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
  soloLectura = false, alCambiar,
}: PropsTurnoActivo) {
  const [accion, setAccion] = useState<'cambiar' | null>(null)
  const bloqueado = deshabilitado
  const abierto = turno.finalizado_en === null
  const puedeCambiar = abierto && !soloLectura && !!alCambiar

  function cancelar(): void {
    if (bloqueado) return
    setAccion(null)
  }

  return (
    <div className="turno-actual">
      <h2>{abierto ? 'Turno actual' : 'Turno cerrado'}</h2>
      <dl className="datos-turno">
        <div><dt>Área</dt><dd>{turno.area === 'calderas' ? 'Calderas' : 'PTAR'}</dd></div>
        <div><dt>Tipo de turno</dt><dd>{nombresTurno[turno.turno]}</dd></div>
        <div><dt>{nombreOperador.includes(' · ') ? 'Operadores del turno' : 'Operador'}</dt><dd>{nombreOperador.includes(' · ')
          ? <span className="operadores-turno-lista">{nombreOperador.split(' · ').map((nombre, indice) => <span key={`${indice}-${nombre}`}>{nombre}</span>)}</span>
          : nombreOperador}</dd></div>
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
      {abierto && !soloLectura && <p className="ayuda-turno">El turno se cierra automáticamente al terminar su horario.</p>}
      

      {accion === null && puedeCambiar && (
        <div className="acciones-turno">
          {puedeCambiar && (
            <button className="boton-primario" type="button" disabled={bloqueado}
              onClick={() => { if (!bloqueado) setAccion('cambiar') }}>
              Cambiar de turno 
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

    </div>
  )
}
