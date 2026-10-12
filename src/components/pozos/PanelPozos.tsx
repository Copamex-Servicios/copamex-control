import { Icono } from '../diseno/Icono'
import { useState } from 'react'
import { usePozos } from '../../hooks/usePozos'
import { extraerValoresPozos } from '../../lib/pozos'
import type { RegistroPozos } from '../../lib/pozos'
import type { CamposPozos } from '../../lib/tiposPozos'
import type { TipoTurno } from '../../lib/tiposTurno'
import { FormularioPozos } from './FormularioPozos'
import { formatearVolumenPozos } from '../../lib/formatoPozos'
import { LecturaPozosGuardada } from './LecturaPozosGuardada'

const nombresTurno: Record<TipoTurno, string> = {
  dia: 'Día', tarde: 'Tarde', noche: 'Noche',
}

function fechaOperativa(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-')
  return `${dia}/${mes}/${anio}`
}

interface PropsContenidoPozos {
  datos: ReturnType<typeof usePozos>
}

function ContenidoPozos({ datos }: PropsContenidoPozos) {
  const [edicion, setEdicion] = useState<RegistroPozos | null>(null)
  const {
    cuentaId, rol, turno, lecturaActual, historial, estadoCarga, mensaje,
    guardando, solicitudPendiente, mensajeAccion, puedeCrear, puedeCorregir,
    guardarPozos, corregirPozos, reintentarGuardadoPozos, actualizarPozos,
  } = datos
  const listo = estadoCarga === 'listo'
  const ocupado = guardando || solicitudPendiente !== null
  const actual = lecturaActual ?? historial.find((registro) => registro.lectura.turno_id === turno?.id) ?? null
  const turnoPropio = rol === 'calderas' && turno !== null && turno.iniciado_por === cuentaId
  const anteriores = actual ? historial.filter((registro) => registro.lectura.id !== actual.lectura.id) : historial
  const puedeGuardarEdicion = edicion !== null && puedeCorregir(edicion.lectura)
  const confirmado = mensajeAccion === 'Lectura de Pozos guardada.'
    || mensajeAccion === 'Corrección de Pozos confirmada.'

  function abrirCorreccion(registro: RegistroPozos): void {
    if (edicion === null && !ocupado && puedeCorregir(registro.lectura)) {
      // Copiar el original consultado; una actualización no debe sustituir el snapshot.
      setEdicion({ ...registro, lectura: { ...registro.lectura }, turno: { ...registro.turno } })
    }
  }

  async function guardarCorreccion(campos: CamposPozos): Promise<boolean> {
    if (!edicion || !puedeGuardarEdicion || ocupado) return false
    const guardado = await corregirPozos(campos, edicion.lectura)
    if (guardado) setEdicion(null)
    return guardado
  }

  async function reintentar(): Promise<void> {
    if (guardando || !solicitudPendiente) return
    if (await reintentarGuardadoPozos()) setEdicion(null)
  }

  return (
    <section className="panel-informacion panel-pozos" aria-label="Pozos de Calderas">
      <div className="cabecera-turno">
        <h2><Icono nombre="pozos" />Pozos</h2>
        <button className="boton-secundario" type="button" disabled={guardando || estadoCarga === 'cargando'}
          onClick={() => { void actualizarPozos() }}>
          Actualizar Pozos
        </button>
      </div>
      
      

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
        <div className="captura-pozos" hidden={!listo || actual !== null || edicion !== null}>
          <h3>Nueva lectura del turno de {nombresTurno[turno.turno]}</h3>
          {!puedeCrear && !ocupado && listo && actual === null && (
            <p className="ayuda-turno">Confirma la operación del turno antes de guardar una lectura nueva.</p>
          )}
          <FormularioPozos key={`${cuentaId}:${turno.id}:captura`} alGuardar={guardarPozos}
            deshabilitado={!listo || !puedeCrear || ocupado || actual !== null || edicion !== null} />
        </div>
      )}
      {listo && rol === 'calderas' && !turnoPropio && (
        <p className="texto-secundario">Para una lectura nueva se necesita tu turno de Calderas abierto. Puedes consultar las lecturas anteriores.</p>
      )}

      {edicion && rol === 'calderas' && (
        <div className="gestion-turno edicion-pozos">
          <h3>Corrección de la lectura seleccionada</h3>
          <p className="texto-secundario">Turno de {nombresTurno[edicion.turno.turno]} · {fechaOperativa(edicion.turno.fecha_operativa)} · {edicion.operadorNombre}</p>
          {listo && !ocupado && !puedeGuardarEdicion && (
            <p className="mensaje-error" role="alert">La lectura cambió o ya no está disponible. Cancela esta corrección y vuelve a seleccionar la lectura actualizada.</p>
          )}
          <FormularioPozos key={`${cuentaId}:${edicion.lectura.id}:correccion`} modo="corregir"
            valoresIniciales={extraerValoresPozos(edicion.lectura)} alGuardar={guardarCorreccion}
            deshabilitado={!puedeGuardarEdicion || ocupado} />
          <div className="acciones-turno">
            <button className="boton-secundario" type="button" disabled={ocupado}
              onClick={() => { if (!ocupado) setEdicion(null) }}>
              Cancelar corrección
            </button>
          </div>
        </div>
      )}

      {listo && actual && (
        <LecturaPozosGuardada registro={actual} deshabilitado={ocupado || edicion !== null}
          alCorregir={rol === 'calderas' && puedeCorregir(actual.lectura) ? () => abrirCorreccion(actual) : undefined} />
      )}
      {listo && (
        <div className="historial-pozos">
          <h3>Historial de Pozos</h3>
          
          {anteriores.length === 0 ? (
            <p>{actual ? 'No hay otras lecturas guardadas para consultar.' : 'No hay lecturas guardadas para consultar.'}</p>
          ) : anteriores.map((registro) => (
            <details className="item-historial-pozos" key={registro.lectura.id}>
              <summary>{fechaOperativa(registro.turno.fecha_operativa)} · {nombresTurno[registro.turno.turno]} · {registro.operadorNombre}</summary>
              <LecturaPozosGuardada registro={registro} deshabilitado={ocupado || edicion !== null}
                alCorregir={rol === 'calderas' && puedeCorregir(registro.lectura) ? () => abrirCorreccion(registro) : undefined} />
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
