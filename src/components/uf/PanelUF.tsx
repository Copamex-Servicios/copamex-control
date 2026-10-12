import { Icono } from '../diseno/Icono'
import { useState } from 'react'
import { useUF } from '../../hooks/useUF'
import { extraerValoresUF } from '../../lib/uf'
import type { RegistroUF } from '../../lib/uf'
import type { CamposUF } from '../../lib/tiposUF'
import type { TipoTurno } from '../../lib/tiposTurno'
import { FormularioUF } from './FormularioUF'
import { formatearVolumenUF } from '../../lib/formatoUF'
import { LecturaUFGuardada } from './LecturaUFGuardada'

const nombresTurno: Record<TipoTurno, string> = {
  dia: 'Día', tarde: 'Tarde', noche: 'Noche',
}

function fechaOperativa(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-')
  return `${dia}/${mes}/${anio}`
}

interface PropsContenidoUF {
  datos: ReturnType<typeof useUF>
}

function ContenidoUF({ datos }: PropsContenidoUF) {
  const [edicion, setEdicion] = useState<RegistroUF | null>(null)
  const {
    cuentaId, rol, turno, lecturaActual, historial, estadoCarga, mensaje,
    guardando, solicitudPendiente, mensajeAccion, puedeCrear, puedeCorregir,
    guardarUF, corregirUF, reintentarGuardadoUF, actualizarUF,
  } = datos
  const listo = estadoCarga === 'listo'
  const ocupado = guardando || solicitudPendiente !== null
  const actual = lecturaActual ?? historial.find((registro) => registro.lectura.turno_id === turno?.id) ?? null
  const turnoPropio = rol === 'calderas' && turno !== null && turno.iniciado_por === cuentaId
  const anteriores = actual ? historial.filter((registro) => registro.lectura.id !== actual.lectura.id) : historial
  const puedeGuardarEdicion = edicion !== null && puedeCorregir(edicion.lectura)
  const confirmado = mensajeAccion === 'Lectura de UF guardada.'
    || mensajeAccion === 'Corrección de UF confirmada.'

  function abrirCorreccion(registro: RegistroUF): void {
    if (edicion === null && !ocupado && puedeCorregir(registro.lectura)) {
      // Copiar el original consultado; una actualización no debe sustituir el snapshot.
      setEdicion({ ...registro, lectura: { ...registro.lectura }, turno: { ...registro.turno } })
    }
  }

  async function guardarCorreccion(campos: CamposUF): Promise<boolean> {
    if (!edicion || !puedeGuardarEdicion || ocupado) return false
    const guardado = await corregirUF(campos, edicion.lectura)
    if (guardado) setEdicion(null)
    return guardado
  }

  async function reintentar(): Promise<void> {
    if (guardando || !solicitudPendiente) return
    if (await reintentarGuardadoUF()) setEdicion(null)
  }

  return (
    <section className="panel-informacion panel-uf" aria-label="UF de Calderas">
      <div className="cabecera-turno">
        <h2><Icono nombre="uf" />Ultrafiltración</h2>
        <button className="boton-secundario" type="button" disabled={guardando || estadoCarga === 'cargando'}
          onClick={() => { void actualizarUF() }}>
          Actualizar UF
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
        <div className="captura-uf" hidden={!listo || actual !== null || edicion !== null}>
          <h3>Nueva lectura del turno de {nombresTurno[turno.turno]}</h3>
          {!puedeCrear && !ocupado && listo && actual === null && (
            <p className="ayuda-turno">Confirma la operación del turno antes de guardar una lectura nueva.</p>
          )}
          <FormularioUF key={`${cuentaId}:${turno.id}:captura`} alGuardar={guardarUF}
            deshabilitado={!listo || !puedeCrear || ocupado || actual !== null || edicion !== null} />
        </div>
      )}
      {listo && rol === 'calderas' && !turnoPropio && (
        <p className="texto-secundario">Para una lectura nueva se necesita tu turno de Calderas abierto. Puedes consultar las lecturas anteriores.</p>
      )}

      {edicion && rol === 'calderas' && (
        <div className="gestion-turno edicion-uf">
          <h3>Corrección de la lectura seleccionada</h3>
          <p className="texto-secundario">Turno de {nombresTurno[edicion.turno.turno]} · {fechaOperativa(edicion.turno.fecha_operativa)} · {edicion.operadorNombre}</p>
          {listo && !ocupado && !puedeGuardarEdicion && (
            <p className="mensaje-error" role="alert">La lectura cambió o ya no está disponible. Cancela esta corrección y vuelve a seleccionar la lectura actualizada.</p>
          )}
          <FormularioUF key={`${cuentaId}:${edicion.lectura.id}:correccion`} modo="corregir"
            valoresIniciales={extraerValoresUF(edicion.lectura)} alGuardar={guardarCorreccion}
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
        <LecturaUFGuardada registro={actual} deshabilitado={ocupado || edicion !== null}
          alCorregir={rol === 'calderas' && puedeCorregir(actual.lectura) ? () => abrirCorreccion(actual) : undefined} />
      )}
      {listo && (
        <div className="historial-uf">
          <h3>Historial de UF</h3>
          
          {anteriores.length === 0 ? (
            <p>{actual ? 'No hay otras lecturas guardadas para consultar.' : 'No hay lecturas guardadas para consultar.'}</p>
          ) : anteriores.map((registro) => (
            <details className="item-historial-uf" key={registro.lectura.id}>
              <summary>{fechaOperativa(registro.turno.fecha_operativa)} · {nombresTurno[registro.turno.turno]} · {registro.operadorNombre}</summary>
              <LecturaUFGuardada registro={registro} deshabilitado={ocupado || edicion !== null}
                alCorregir={rol === 'calderas' && puedeCorregir(registro.lectura) ? () => abrirCorreccion(registro) : undefined} />
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
