import { RefreshCw } from 'lucide-react'
import type { useInformacionDia } from '../../hooks/useInformacionDia'
import './calidadReferencia.css'
import { useState } from 'react'
import { useCalidad } from '../../hooks/useCalidad'
import { fechaHoraCalidad } from '../../lib/formatoCalidad'
import type { AreaOperativa } from '../../lib/tiposTurno'
import type { CamposCalidad } from '../../lib/tiposCalidad'
import { FormularioCalidad } from './FormularioCalidad'
import { LecturaCalidadGuardada } from './LecturaCalidadGuardada'

interface ContextoVisualCalidad { informacion?: ReturnType<typeof useInformacionDia>; horaServidor?: string | null }

function ContenidoCalidad({ datos, area, informacion, horaServidor }: { datos: ReturnType<typeof useCalidad>; area: AreaOperativa } & ContextoVisualCalidad) {
  const [numeroCaptura, setNumeroCaptura] = useState(0)
  const { rol, cuentaId, turno, catalogos, historial, lecturaActual, estadoCarga, mensaje, mensajeAccion,
    solicitudPendiente, guardando, puedeCrear, guardarCalidad,
    actualizarCalidad, reintentarGuardadoCalidad } = datos
  const listo = estadoCarga === 'listo', ocupado = guardando || !!solicitudPendiente
  const propio = rol === area && turno?.iniciado_por === cuentaId
  const registros = lecturaActual && !historial.some(r => r.lectura.id === lecturaActual.lectura.id)
    ? [lecturaActual, ...historial].slice(0, 20) : historial
  const confirmado = mensajeAccion === 'Lectura de Calidad guardada.' || mensajeAccion === 'Corrección de Calidad confirmada.'
  async function guardar(campos: CamposCalidad) {
    const resultado = await guardarCalidad(campos)
    if (resultado) setNumeroCaptura(n => n + 1)
    return resultado
  }
  async function reintentar() {
    if (guardando || !solicitudPendiente) return
    const esNueva = solicitudPendiente.solicitud.original === null
    if (await reintentarGuardadoCalidad()) {
      if (esNueva) setNumeroCaptura(n => n + 1)
    }
  }
  return <section className="calidad-referencia" aria-label={`Calidad de ${area === 'calderas' ? 'Calderas' : 'PTAR'}`}>
    <header className="calidad-encabezado"><div className="calidad-encabezado-titulo"><div><h2>Calidad</h2></div></div><button className="boton-secundario" type="button"
      disabled={guardando || estadoCarga === 'cargando'} onClick={() => { void actualizarCalidad() }}><RefreshCw aria-hidden="true" />Actualizar Calidad</button></header>
    {informacion && rol === area && <aside className="calidad-produccion" aria-label="Objetivos de producción actual"><div><h3>Objetivos de producción actual</h3>
      {informacion.datos?.produccion.error ? <p role="alert">No se pudo consultar la producción.</p>
        : !informacion.datos ? <p role="status">Consultando producción…</p>
        : informacion.datos.produccion.elementos.length === 0 ? <p>Sin producción programada.</p>
        : informacion.datos.produccion.elementos.map(p => <p key={p.id}><strong>Máquina:</strong> {p.maquina} <span>·</span> <strong>Papel:</strong> {p.papel} <span>·</span> <strong>Color objetivo:</strong> {p.color ?? 'Sin definir'} <span>·</span> <strong>Consumo objetivo:</strong> {p.consumo ?? 'Sin definir'}</p>)}
      {informacion.cargando && informacion.datos && <small role="status">Actualizando producción…</small>}
    </div></aside>}
    {mensajeAccion && <p className={confirmado ? 'mensaje-exito' : 'mensaje-error'} role={confirmado ? 'status' : 'alert'}>{mensajeAccion}</p>}
    {solicitudPendiente && <div className="operacion-pendiente" aria-busy={guardando}>
      <h3>{guardando ? 'Guardando muestra…' : 'Muestra sin confirmar'}</h3>
      <p>Se enviaron {solicitudPendiente.solicitud.valores.resultados.length} resultados. El reintento conserva la misma muestra, valores y turno.</p>
      <p className="notas-turno">Notas: {solicitudPendiente.solicitud.valores.notas || 'Sin notas.'}</p>
      {!guardando && <button type="button" className="boton-primario" onClick={() => { void reintentar() }}>Reintentar el mismo guardado</button>}
    </div>}
    {estadoCarga === 'cargando' && <p role="status">Consultando Calidad…</p>}
    {estadoCarga === 'error' && <p className="mensaje-error" role="alert">{mensaje || 'No se pudo consultar Calidad. Usa Actualizar Calidad para reintentar.'}</p>}
    {propio && turno && <div hidden={!listo}>
      <FormularioCalidad key={`${turno.id}:${numeroCaptura}`} area={area} catalogos={catalogos} horaServidor={horaServidor} alGuardar={guardar}
        deshabilitado={!puedeCrear || ocupado} />
    </div>}
    {listo && rol === area && !propio && <p>Para guardar una muestra nueva necesitas tu turno del área abierto. Puedes consultar las muestras anteriores.</p>}
    {listo && <div className="historial-calidad"><h3>Historial de Calidad</h3>
      
      {registros.length === 0 ? <p>No hay muestras guardadas para consultar.</p> : registros.map(r => <details className="item-historial-calidad" key={r.lectura.id}>
        <summary>{fechaHoraCalidad(r.lectura.capturado_en)} · {r.operadorNombre} · {r.lectura.resultados.length} resultados</summary>
        <LecturaCalidadGuardada registro={r} deshabilitado={ocupado} />
      </details>)}
    </div>}
  </section>
}

export function PanelCalidad({ area, informacion, horaServidor }: { area: AreaOperativa } & ContextoVisualCalidad) {
  const datos = useCalidad(area)
  if (!datos.cuentaId || (datos.rol !== area && datos.rol !== 'admin') || datos.estadoCarga === 'sin-cuenta') return null
  return <ContenidoCalidad key={`${datos.cuentaId}:${datos.rol}:${area}`} datos={datos} area={area} informacion={informacion} horaServidor={horaServidor} />
}
