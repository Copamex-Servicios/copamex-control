import { RefreshCw } from 'lucide-react'
import { ConsultaMuestrasCalidad } from './ConsultaMuestrasCalidad'
import type { useInformacionDia } from '../../hooks/useInformacionDia'
import './calidadReferencia.css'
import { useState } from 'react'
import '../diseno/acordeonHistorial.css'
import { useCalidad } from '../../hooks/useCalidad'
import type { AreaOperativa } from '../../lib/tiposTurno'
import type { CamposCalidad } from '../../lib/tiposCalidad'
import { FormularioCalidad } from './FormularioCalidad'
import { SeguimientoColorM4 } from './SeguimientoColorM4'

interface ContextoVisualCalidad { informacion?: ReturnType<typeof useInformacionDia>; horaServidor?: string | null }

function ContenidoCalidad({ datos, area, informacion, horaServidor }: { datos: ReturnType<typeof useCalidad>; area: AreaOperativa } & ContextoVisualCalidad) {
  const [numeroCaptura, setNumeroCaptura] = useState(0)
  const [revisionAdicional, setRevisionAdicional] = useState(0)
  const [accionesCabecera, setAccionesCabecera] = useState<HTMLDivElement | null>(null)
  const { rol, cuentaId, turno, catalogos, lecturaActual, estadoCarga, mensaje, mensajeAccion,
    solicitudPendiente, guardando, puedeCrear, guardarCalidad,
    actualizarCalidad, reintentarGuardadoCalidad } = datos
  const listo = estadoCarga === 'listo', ocupado = guardando || !!solicitudPendiente
  const propio = rol === area && turno?.iniciado_por === cuentaId
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
    <header className="calidad-encabezado"><div className="calidad-encabezado-titulo"><div><h2>Calidad</h2><p>Análisis de calidades de agua</p></div></div>
      <div className="calidad-acciones-cabecera"><div ref={setAccionesCabecera} />
        <button className="boton-secundario" type="button"
          disabled={guardando || estadoCarga === 'cargando'} onClick={() => { void actualizarCalidad() }} data-actualizar="true" aria-label="Actualizar Calidad" title="Actualizar Calidad"><RefreshCw size={18} style={{ width: 18, height: 18, flexShrink: 0 }} aria-hidden="true" /></button>
      </div></header>
    {propio && cuentaId && area === 'calderas' && <SeguimientoColorM4 cuenta={cuentaId} turno={turno} contenedorAcciones={accionesCabecera}
      habilitado={puedeCrear && !ocupado} muestraHabitual={!!lecturaActual}
      alGuardar={() => { setRevisionAdicional(n => n + 1); void actualizarCalidad() }} />}
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
    {listo && <ConsultaMuestrasCalidad titulo="Historial de Calidad" areaFija={area} actualizacion={`${lecturaActual?.lectura.id ?? ''}:${revisionAdicional}`} />}
  </section>
}

export function PanelCalidad({ area, informacion, horaServidor }: { area: AreaOperativa } & ContextoVisualCalidad) {
  const datos = useCalidad(area)
  if (!datos.cuentaId || (datos.rol !== area && datos.rol !== 'admin') || datos.estadoCarga === 'sin-cuenta') return null
  return <ContenidoCalidad key={`${datos.cuentaId}:${datos.rol}:${area}`} datos={datos} area={area} informacion={informacion} horaServidor={horaServidor} />
}
