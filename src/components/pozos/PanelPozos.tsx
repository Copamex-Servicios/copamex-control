import { RefreshCw } from 'lucide-react'
import { ResumenHistorial } from '../diseno/ResumenHistorial'
import '../operativo/medicionesVisual.css'
import { useId, useState } from 'react'
import '../diseno/acordeonHistorial.css'
import { usePozos } from '../../hooks/usePozos'
import { formatearVolumenPozos } from '../../lib/formatoPozos'
import { LecturaPozosGuardada } from './LecturaPozosGuardada'
import { LecturaPozosHistorial } from './LecturaPozosHistorial'
import { MonitorConcesionPozos } from './MonitorConcesionPozos'
import { useHistorialPaginado } from '../../hooks/useHistorialPaginado'
import { consultarPaginaHistorialPozos } from '../../lib/pozos'
import { PaginacionHistorial } from '../diseno/PaginacionHistorial'

interface PropsContenidoPozos {
  datos: ReturnType<typeof usePozos>
}

function ContenidoPozos({ datos }: PropsContenidoPozos) {
  const grupoHistorial = useId()
  const [revisionConcesion, setRevisionConcesion] = useState(0)
  const {
    cuentaId, rol, turno, lecturaActual, historial, baseHistorica, estadoCarga, mensaje,
    guardando, solicitudPendiente, mensajeAccion,
    reintentarGuardadoPozos, actualizarPozos,
  } = datos
  const listo = estadoCarga === 'listo'
  const ocupado = guardando || solicitudPendiente !== null
  const actual = lecturaActual ?? historial.find((registro) => registro.lectura.turno_id === turno?.id) ?? null
  const todasLasAnteriores = actual ? historial.filter((registro) => registro.lectura.id !== actual.lectura.id) : historial
  const baseAplica = Boolean(turno && baseHistorica
    && turno.fecha_operativa.slice(0, 4) === String(baseHistorica.anio)
    && turno.fecha_operativa >= baseHistorica.fechaCorte)
  const anteriores = baseAplica && baseHistorica
    ? todasLasAnteriores.filter((registro) => registro.turno.fecha_operativa >= baseHistorica.fechaCorte)
    : todasLasAnteriores
  const paginaHistorial = useHistorialPaginado(anteriores, `${cuentaId}:${actual?.lectura.id ?? ''}`, rol === 'calderas' && historial.length >= 14,
    actual?.lectura.turno_id ?? null, consultarPaginaHistorialPozos, 7)
  const filasHistorial = rol === 'calderas' ? paginaHistorial.visibles : anteriores
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
          onClick={() => { setRevisionConcesion(n => n + 1); void actualizarPozos() }} data-actualizar="true" aria-label="Actualizar Pozos" title="Actualizar Pozos"><RefreshCw size={18} style={{ width: 18, height: 18, flexShrink: 0 }} aria-hidden="true" /></button>
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

      {listo && actual && (
        <LecturaPozosGuardada registro={actual} deshabilitado={ocupado} />
      )}
      {listo && (
        <div className="historial-pozos">
          <h3>Historial de Pozos</h3>
          
          {anteriores.length === 0 ? (
            <p>{actual ? 'No hay otras lecturas guardadas para consultar.' : 'No hay lecturas guardadas para consultar.'}</p>
          ) : filasHistorial.map((registro) => (
            <details className="item-historial-pozos co-acordeon-historial" name={grupoHistorial} key={registro.lectura.id}>
              <ResumenHistorial fecha={registro.turno.fecha_operativa} titulo="Lectura de pozos" operador={registro.operadorNombre} turno={registro.turno.turno} />
              <LecturaPozosHistorial registro={registro} />
            </details>
          ))}
          {rol === 'calderas' && (paginaHistorial.hayAnterior || paginaHistorial.haySiguiente) && <>
            <PaginacionHistorial etiqueta="historial de Pozos" pagina={paginaHistorial.pagina} anterior={paginaHistorial.anterior}
              siguiente={() => { void paginaHistorial.siguiente() }} hayAnterior={paginaHistorial.hayAnterior}
              haySiguiente={paginaHistorial.haySiguiente} cargando={paginaHistorial.cargando} />
            {paginaHistorial.error && <p className="mensaje-error" role="alert">{paginaHistorial.error}</p>}
          </>}
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
