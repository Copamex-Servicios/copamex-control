import { ResumenHistorial } from '../diseno/ResumenHistorial'
import { RefreshCw } from 'lucide-react'
import '../operativo/medicionesVisual.css'
import { useId, useState } from 'react'
import '../diseno/acordeonHistorial.css'
import { usePozos } from '../../hooks/usePozos'
import type { TipoTurno } from '../../lib/tiposTurno'
import { FormularioPozos } from './FormularioPozos'
import { formatearVolumenPozos } from '../../lib/formatoPozos'
import { LecturaPozosGuardada } from './LecturaPozosGuardada'
import { MonitorConcesionPozos } from './MonitorConcesionPozos'

const nombresTurno: Record<TipoTurno, string> = {
  dia: 'Día', tarde: 'Tarde', noche: 'Noche',
}


interface PropsContenidoPozos {
  datos: ReturnType<typeof usePozos>
}

function ContenidoPozos({ datos }: PropsContenidoPozos) {
  const grupoHistorial = useId()
  const [revisionConcesion, setRevisionConcesion] = useState(0)
  const {
    cuentaId, rol, turno, lecturaActual, historial, estadoCarga, mensaje,
    guardando, solicitudPendiente, mensajeAccion, puedeCrear,
    guardarPozos, reintentarGuardadoPozos, actualizarPozos,
  } = datos
  const listo = estadoCarga === 'listo'
  const ocupado = guardando || solicitudPendiente !== null
  const actual = lecturaActual ?? historial.find((registro) => registro.lectura.turno_id === turno?.id) ?? null
  const turnoPropio = rol === 'calderas' && turno !== null && turno.iniciado_por === cuentaId
  const anteriores = actual ? historial.filter((registro) => registro.lectura.id !== actual.lectura.id) : historial
  const confirmado = mensajeAccion === 'Lectura de Pozos guardada.'
    || mensajeAccion === 'Corrección de Pozos confirmada.'

  async function reintentar(): Promise<void> {
    if (guardando || !solicitudPendiente) return
    await reintentarGuardadoPozos()
  }

  return (
    <section className="panel-informacion panel-pozos panel-mediciones" aria-label="Pozos de Calderas">
      <div className="cabecera-turno">
        <h2>Pozos</h2>
        <button className="boton-secundario" type="button" disabled={guardando || estadoCarga === 'cargando'}
          onClick={() => { setRevisionConcesion(n => n + 1); void actualizarPozos() }}>
          <RefreshCw className="mediciones-actualizar" aria-hidden="true" />Actualizar Pozos
        </button>
      </div>
      <MonitorConcesionPozos revision={revisionConcesion} />
      
      

      {mensajeAccion && (
        <p className={confirmado ? 'mensaje-exito' : 'mensaje-error'} role={confirmado ? 'status' : 'alert'}>
          {mensajeAccion}
        </p>
      )}
      {solicitudPendiente && (
        <div className="operacion-pendiente" aria-busy={guardando}>
          <h3>{guardando ? 'Guardando Pozos…' : solicitudPendiente.solicitud.original ? 'Corrección sin confirmar' : 'Lectura sin confirmar'}</h3>
          <p>Estos son los datos enviados para el turno seleccionado. El reintento conservará esos mismos datos, aunque haya cambiado el turno.</p>
          <dl className="datos-turno">
            <div><dt>Pozo 1 — Inicial</dt><dd>{formatearVolumenPozos(solicitudPendiente.solicitud.valores.pozo1_ini)}</dd></div>
            <div><dt>Pozo 1 — Final</dt><dd>{formatearVolumenPozos(solicitudPendiente.solicitud.valores.pozo1_fin)}</dd></div>
            <div><dt>Pozo 2 — Inicial</dt><dd>{formatearVolumenPozos(solicitudPendiente.solicitud.valores.pozo2_ini)}</dd></div>
            <div><dt>Pozo 2 — Final</dt><dd>{formatearVolumenPozos(solicitudPendiente.solicitud.valores.pozo2_fin)}</dd></div>
          </dl>
          <p className="notas-turno">Notas: {solicitudPendiente.solicitud.valores.notas || 'Sin notas.'}</p>
          {!guardando && (
            <button className="boton-primario" type="button" onClick={() => { void reintentar() }}>
              Reintentar el mismo guardado
            </button>
          )}
        </div>
      )}

      {estadoCarga === 'cargando' && <p role="status">Consultando las lecturas de Pozos…</p>}
      {estadoCarga === 'error' && (
        <div>
          <p className="mensaje-error" role="alert">{mensaje || 'No se pudieron consultar las lecturas de Pozos.'}</p>
          <button className="boton-secundario" type="button" disabled={guardando}
            onClick={() => { void actualizarPozos() }}>
            Reintentar consulta de Pozos
          </button>
        </div>
      )}

      {/* Conservar esta instancia al recargar Pozos del mismo turno para mantener el borrador. */}
      {turnoPropio && turno && (
        <div className="captura-pozos" hidden={!listo || actual !== null}>
          <h3>Nueva lectura del turno de {nombresTurno[turno.turno]}</h3>
          {!puedeCrear && !ocupado && listo && actual === null && (
            <p className="ayuda-turno">Confirma la operación del turno antes de guardar una lectura nueva.</p>
          )}
          <FormularioPozos key={`${cuentaId}:${turno.id}:captura`} alGuardar={guardarPozos}
            deshabilitado={!listo || !puedeCrear || ocupado || actual !== null} />
        </div>
      )}

      {listo && actual && (
        <LecturaPozosGuardada registro={actual} deshabilitado={ocupado} />
      )}
      {listo && (
        <div className="historial-pozos">
          <h3>Historial de Pozos</h3>
          
          {anteriores.length === 0 ? (
            <p>{actual ? 'No hay otras lecturas guardadas para consultar.' : 'No hay lecturas guardadas para consultar.'}</p>
          ) : anteriores.map((registro) => (
            <details className="item-historial-pozos co-acordeon-historial" name={grupoHistorial} key={registro.lectura.id}>
              <ResumenHistorial fecha={registro.turno.fecha_operativa} titulo="Lectura de Pozos" operador={registro.operadorNombre} turno={registro.turno.turno} />
              <LecturaPozosGuardada registro={registro} deshabilitado={ocupado} />
            </details>
          ))}
        </div>
      )}
    </section>
  )
}

export function PanelPozos() {
  const datos = usePozos()
  if (!datos.cuentaId || (datos.rol !== 'calderas' && datos.rol !== 'admin')
    || datos.estadoCarga === 'sin-cuenta') return null
  // Cambiar de cuenta o rol desmonta cualquier borrador/selección anterior.
  return <ContenidoPozos key={`${datos.cuentaId}:${datos.rol}`} datos={datos} />
}
