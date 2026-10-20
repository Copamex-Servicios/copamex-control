import { ResumenHistorial } from '../diseno/ResumenHistorial'
import { RefreshCw } from 'lucide-react'
import { useId } from 'react'
import '../diseno/acordeonHistorial.css'
import '../operativo/medicionesVisual.css'
import { useUF } from '../../hooks/useUF'
import type { TipoTurno } from '../../lib/tiposTurno'
import { FormularioUF } from './FormularioUF'
import { formatearVolumenUF } from '../../lib/formatoUF'
import { LecturaUFGuardada } from './LecturaUFGuardada'
import { LecturaUFHistorial } from './LecturaUFHistorial'

const nombresTurno: Record<TipoTurno, string> = {
  dia: 'Día', tarde: 'Tarde', noche: 'Noche',
}


interface PropsContenidoUF {
  datos: ReturnType<typeof useUF>
}

function ContenidoUF({ datos }: PropsContenidoUF) {
  const grupoHistorial = useId()
  const {
    cuentaId, rol, turno, lecturaActual, historial, estadoCarga, mensaje,
    guardando, solicitudPendiente, mensajeAccion, puedeCrear,
    guardarUF, reintentarGuardadoUF, actualizarUF,
  } = datos
  const listo = estadoCarga === 'listo'
  const ocupado = guardando || solicitudPendiente !== null
  const actual = lecturaActual ?? historial.find((registro) => registro.lectura.turno_id === turno?.id) ?? null
  const turnoPropio = rol === 'calderas' && turno !== null && turno.iniciado_por === cuentaId
  const anteriores = actual ? historial.filter((registro) => registro.lectura.id !== actual.lectura.id) : historial
  const confirmado = mensajeAccion === 'Lectura de UF guardada.'
    || mensajeAccion === 'Corrección de UF confirmada.'

  async function reintentar(): Promise<void> {
    if (guardando || !solicitudPendiente) return
    await reintentarGuardadoUF()
  }

  return (
    <section className="panel-informacion panel-uf panel-mediciones" aria-label="UF de Calderas">
      <div className="cabecera-turno">
        <h2>Ultrafiltración</h2>
        <button className="boton-secundario" type="button" disabled={guardando || estadoCarga === 'cargando'}
          onClick={() => { void actualizarUF() }}>
          <RefreshCw className="mediciones-actualizar" aria-hidden="true" />Actualizar UF
        </button>
      </div>
      
      

      {mensajeAccion && (
        <p className={confirmado ? 'mensaje-exito' : 'mensaje-error'} role={confirmado ? 'status' : 'alert'}>
          {mensajeAccion}
        </p>
      )}
      {solicitudPendiente && (
        <div className="operacion-pendiente" aria-busy={guardando}>
          <h3>{guardando ? 'Guardando UF…' : solicitudPendiente.solicitud.original ? 'Corrección sin confirmar' : 'Lectura sin confirmar'}</h3>
          <p>Estos son los datos enviados para el turno seleccionado. El reintento conservará esos mismos datos, aunque haya cambiado el turno.</p>
          <dl className="datos-turno">
            <div><dt>Alimentación — Inicial</dt><dd>{formatearVolumenUF(solicitudPendiente.solicitud.valores.alim_ini)}</dd></div>
            <div><dt>Alimentación — Final</dt><dd>{formatearVolumenUF(solicitudPendiente.solicitud.valores.alim_fin)}</dd></div>
            <div><dt>Aceptación — Inicial</dt><dd>{formatearVolumenUF(solicitudPendiente.solicitud.valores.acep_ini)}</dd></div>
            <div><dt>Aceptación — Final</dt><dd>{formatearVolumenUF(solicitudPendiente.solicitud.valores.acep_fin)}</dd></div>
          </dl>
          <p className="notas-turno">Notas: {solicitudPendiente.solicitud.valores.notas || 'Sin notas.'}</p>
          {!guardando && (
            <button className="boton-primario" type="button" onClick={() => { void reintentar() }}>
              Reintentar el mismo guardado
            </button>
          )}
        </div>
      )}

      {estadoCarga === 'cargando' && <p role="status">Consultando las lecturas de UF…</p>}
      {estadoCarga === 'error' && (
        <div>
          <p className="mensaje-error" role="alert">{mensaje || 'No se pudieron consultar las lecturas de UF.'}</p>
          <button className="boton-secundario" type="button" disabled={guardando}
            onClick={() => { void actualizarUF() }}>
            Reintentar consulta de UF
          </button>
        </div>
      )}

      {/* Conservar esta instancia al recargar UF del mismo turno para mantener el borrador. */}
      {turnoPropio && turno && (
        <div className="captura-uf" hidden={!listo || actual !== null}>
          <h3>Nueva lectura del turno de {nombresTurno[turno.turno]}</h3>
          {!puedeCrear && !ocupado && listo && actual === null && (
            <p className="ayuda-turno">Confirma la operación del turno antes de guardar una lectura nueva.</p>
          )}
          <FormularioUF key={`${cuentaId}:${turno.id}:captura`} alGuardar={guardarUF}
            deshabilitado={!listo || !puedeCrear || ocupado || actual !== null} />
        </div>
      )}

      {listo && actual && (
        <LecturaUFGuardada registro={actual} deshabilitado={ocupado} />
      )}
      {listo && (
        <div className="historial-uf">
          <div className="uf-historial-cabecera"><h3>Historial de UF</h3><span>{anteriores.length} {anteriores.length === 1 ? 'registro' : 'registros'}</span></div>
          
          {anteriores.length === 0 ? (
            <p>{actual ? 'No hay otras lecturas guardadas para consultar.' : 'No hay lecturas guardadas para consultar.'}</p>
          ) : anteriores.map((registro) => (
            <details className="item-historial-uf co-acordeon-historial" name={grupoHistorial} key={registro.lectura.id}>
              <ResumenHistorial fecha={registro.turno.fecha_operativa} titulo="Lectura de Ultrafiltración" operador={registro.operadorNombre} turno={registro.turno.turno} />
              <LecturaUFHistorial registro={registro} />
            </details>
          ))}
        </div>
      )}
    </section>
  )
}

export function PanelUF() {
  const datos = useUF()
  if (!datos.cuentaId || (datos.rol !== 'calderas' && datos.rol !== 'admin')
    || datos.estadoCarga === 'sin-cuenta') return null
  // Cambiar de cuenta o rol desmonta cualquier borrador/selección anterior.
  return <ContenidoUF key={`${datos.cuentaId}:${datos.rol}`} datos={datos} />
}
