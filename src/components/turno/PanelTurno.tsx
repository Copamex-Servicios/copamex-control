import { useTurno } from '../../hooks/useTurno'
import type { AreaOperativa, TipoTurno } from '../../lib/tiposTurno'
import { InicioTurno } from './InicioTurno'
import { TurnoActivo } from './TurnoActivo'

interface PropsPanelTurno {
  referencia?: boolean
  area: AreaOperativa
}

const nombresTurno: Record<TipoTurno, string> = {
  dia: 'Día', tarde: 'Tarde', noche: 'Noche',
}

const accionesEnCurso = {
  iniciar: 'Iniciando turno…', cambiar: 'Cambiando de turno…', cerrar: 'Cerrando turno…',
}

export function PanelTurno({ area, referencia = false }: PropsPanelTurno) {
  const {
    cuentaId, area: areaCuenta, operadores, turno, estadoCarga, mensaje,
    accionEnCurso, solicitudPendiente, mensajeAccion,
    iniciarOCambiarTurno, cerrarTurnoActual, reintentarOperacion, actualizarTurno,
  } = useTurno()

  if (!cuentaId || areaCuenta !== area) return null

  const ocupado = accionEnCurso !== null
  const bloqueado = ocupado || solicitudPendiente !== null || estadoCarga !== 'listo'
  const pertenece = turno?.iniciado_por === cuentaId
  const nombreOperador = turno
    ? operadores.find((operador) => operador.id === turno.operador_id)?.nombre
    : null
  const confirmado = mensajeAccion === 'Turno guardado.' || mensajeAccion === 'Cierre confirmado.'

  return (
    <section className="panel-informacion panel-turno" aria-label={`Turno de ${area === 'calderas' ? 'Calderas' : 'PTAR'}`}>
      <div className="cabecera-turno" style={{ justifyContent: 'flex-start' }}>
        <h2>Gestión del turno</h2>
        {referencia && estadoCarga === 'listo' && !turno && <span className="co-turno-estado co-turno-sin-abierto"><span aria-hidden="true" />No hay un turno abierto</span>}
        {referencia && estadoCarga === 'listo' && turno && <span className={`co-turno-estado ${turno.finalizado_en === null ? 'co-turno-abierto' : 'co-turno-cerrado'}`}><span aria-hidden="true" />{turno.finalizado_en === null ? 'Turno abierto' : 'Turno cerrado'}</span>}
      </div>

      {mensajeAccion && (
        <p className={confirmado ? 'mensaje-exito' : 'mensaje-error'} role={confirmado ? 'status' : 'alert'}>
          {mensajeAccion}
        </p>
      )}

      {solicitudPendiente && (
        <div className="operacion-pendiente" aria-busy={ocupado}>
          <h3>{accionEnCurso ? accionesEnCurso[accionEnCurso] : 'Operación sin confirmar'}</h3>
          {solicitudPendiente.accion === 'cerrar' ? (
            <>
              <p>Cierre solicitado para el turno que estaba abierto.</p>
              <p className="notas-turno">Notas: {solicitudPendiente.notas || 'Sin notas.'}</p>
            </>
          ) : (
            <dl className="datos-turno">
              <div><dt>Operación</dt><dd>{solicitudPendiente.accion === 'cambiar' ? 'Cambio de turno' : 'Inicio de turno'}</dd></div>
              <div><dt>Operador entrante</dt><dd>{solicitudPendiente.solicitud.nombreOperador}</dd></div>
              <div><dt>Tipo de turno</dt><dd>{nombresTurno[solicitudPendiente.solicitud.tipoTurno]}</dd></div>
              <div><dt>Fecha operativa</dt><dd>Asignada automáticamente al iniciar</dd></div>
            </dl>
          )}
          {!ocupado && (
            <>
              <p>Reintenta esta misma operación para confirmar el resultado. Se conservarán los datos que enviaste.</p>
              <button className="boton-primario" type="button" onClick={() => { void reintentarOperacion() }}>
                Reintentar la misma operación
              </button>
            </>
          )}
        </div>
      )}

      {estadoCarga === 'cargando' && <p role="status">Consultando el turno…</p>}
      {estadoCarga === 'error' && (
        <div>
          <p className="mensaje-error" role="alert">{mensaje || 'No se pudo consultar el turno.'}</p>
          <button className="boton-secundario" type="button" disabled={ocupado}
            onClick={() => { void actualizarTurno() }}>
            Reintentar consulta
          </button>
        </div>
      )}

      {estadoCarga === 'listo' && (
        turno ? (
          nombreOperador ? (
            <TurnoActivo key={`${cuentaId}:${turno.id}`} turno={turno} nombreOperador={nombreOperador}
              operadores={operadores} deshabilitado={bloqueado} soloLectura={!pertenece}
              alCerrar={pertenece ? cerrarTurnoActual : undefined} />
          ) : <p className="mensaje-error" role="alert">Actualiza el turno para consultar el nombre del operador.</p>
        ) : (
          <div>
            {!referencia && <h3>No hay un turno abierto</h3>}
            <InicioTurno key={`${cuentaId}:${area}:inicio`} operadores={operadores}
              alGuardar={iniciarOCambiarTurno} deshabilitado={bloqueado} />
          </div>
        )
      )}
    </section>
  )
}
