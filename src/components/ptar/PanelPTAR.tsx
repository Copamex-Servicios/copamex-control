import { ClipboardList, History, RefreshCw, Waves } from 'lucide-react'
import './ptarReferencia.css'
import { useState } from 'react'
import { medicionesPTAR } from '../../lib/tiposPTAR'
import { usePTAR } from '../../hooks/usePTAR'
import type { CamposPTAR, RegistroPTAR } from '../../lib/tiposPTAR'
import { FormularioPTAR } from './FormularioPTAR'
import { TablaHistorialPTAR } from './TablaHistorialPTAR'

function ContenidoPTAR({ datos }: { datos: ReturnType<typeof usePTAR> }) {
  const area = 'ptar' as const
  const [edicion, setEdicion] = useState<RegistroPTAR | null>(null)
  const [numeroCaptura, setNumeroCaptura] = useState(0)
  const { rol, cuentaId, turno, historial, lecturaActual, estadoCarga, mensaje, mensajeAccion,
    solicitudPendiente, guardando, puedeCrear, puedeCorregir, guardarPTAR, corregirPTAR,
    actualizarPTAR, reintentarGuardadoPTAR } = datos
  const actualizando = guardando || estadoCarga === 'cargando'
  const listo = estadoCarga === 'listo', ocupado = guardando || !!solicitudPendiente
  const propio = rol === area && turno?.iniciado_por === cuentaId
  const registros = lecturaActual && !historial.some(r => r.lectura.id === lecturaActual.lectura.id)
    ? [lecturaActual, ...historial].slice(0, 20) : historial
  const confirmado = mensajeAccion === 'Lectura de PTAR guardada.' || mensajeAccion === 'Corrección de PTAR confirmada.'
  async function guardar(campos: CamposPTAR) {
    const resultado = await guardarPTAR(campos)
    if (resultado) setNumeroCaptura(n => n + 1)
    return resultado
  }
  async function corregir(campos: CamposPTAR) {
    if (!edicion || !puedeCorregir(edicion.lectura) || ocupado) return false
    const resultado = await corregirPTAR(campos, edicion.lectura)
    if (resultado) setEdicion(null)
    return resultado
  }
  async function reintentar() {
    if (guardando || !solicitudPendiente) return
    const esNueva = solicitudPendiente.solicitud.original === null
    if (await reintentarGuardadoPTAR()) {
      setEdicion(null)
      if (esNueva) setNumeroCaptura(n => n + 1)
    }
  }
  return <section className="ptar-referencia" aria-label="Lecturas PTAR">
    <header className="ptar-cabecera">
      <div className="ptar-cabecera-titulo"><span className="ptar-icono-modulo"><Waves aria-hidden="true" /></span><div><h2>Lecturas PTAR</h2><p>Registro de mediciones operativas del turno</p></div></div>
      <button className="boton-secundario" type="button" disabled={actualizando} onClick={() => { void actualizarPTAR() }}><RefreshCw aria-hidden="true" />Actualizar lecturas PTAR</button>
    </header>
    {mensajeAccion && <p className={confirmado ? 'mensaje-exito' : 'mensaje-error'} role={confirmado ? 'status' : 'alert'}>{mensajeAccion}</p>}
    {solicitudPendiente && <div className="operacion-pendiente" aria-busy={guardando}>
      <h3>{guardando ? 'Guardando lectura…' : 'Lectura sin confirmar'}</h3>
      <p>El reintento conserva las mismas mediciones, notas y turno.</p>
      <p>Mediciones enviadas: {medicionesPTAR.filter(({campo}) => solicitudPendiente.solicitud.valores[campo] !== null).length}</p>
      <p className="notas-turno">Notas: {solicitudPendiente.solicitud.valores.notas || 'Sin notas.'}</p>
      {!guardando && <button type="button" className="boton-primario" onClick={() => { void reintentar() }}>Reintentar el mismo guardado</button>}
    </div>}
    {estadoCarga === 'cargando' && <p role="status">Consultando Lecturas PTAR…</p>}
    {estadoCarga === 'error' && <p className="mensaje-error" role="alert">{mensaje || 'No se pudo consultar Lecturas PTAR. Usa Actualizar Lecturas PTAR para reintentar.'}</p>}
    {propio && turno && <div className="ptar-tarjeta ptar-captura" hidden={!listo || edicion !== null}>
      <div className="ptar-seccion-titulo"><ClipboardList aria-hidden="true" /><div><h3>Nueva lectura del turno</h3><p>Registra las mediciones de DQO y SST del turno actual.</p></div></div>
      <FormularioPTAR key={`${turno.id}:${numeroCaptura}`} alGuardar={guardar} deshabilitado={!puedeCrear || ocupado || edicion !== null} />
    </div>}
    {listo && rol === area && !propio && <p>Para guardar lecturas nuevas necesitas tu turno del área abierto. Puedes consultar las lecturas anteriores.</p>}
    {edicion && rol === area && <div className="ptar-tarjeta ptar-correccion">
      <h3>Corregir lectura de {edicion.operadorNombre}</h3>
      {listo && !ocupado && !puedeCorregir(edicion.lectura) && <p className="mensaje-error" role="alert">La lectura cambió. Cancela y vuelve a seleccionar la lectura actualizada.</p>}
      <FormularioPTAR key={edicion.lectura.id} original={edicion.lectura} alGuardar={corregir} deshabilitado={ocupado || !puedeCorregir(edicion.lectura)} />
      <div className="acciones-turno"><button type="button" className="boton-secundario" disabled={ocupado}
        onClick={() => { if (!ocupado) setEdicion(null) }}>Cancelar corrección</button></div>
    </div>}
    {listo && <div className="ptar-tarjeta ptar-historial">
      <div className="ptar-historial-cabecera"><div className="ptar-seccion-titulo"><History aria-hidden="true" /><div><h3>Historial de lecturas PTAR</h3><p>Últimos registros de mediciones operativas.</p></div></div>
        <button className="boton-secundario" type="button" disabled={actualizando} onClick={() => { void actualizarPTAR() }}><RefreshCw aria-hidden="true" />Actualizar</button>
      </div>
      {registros.length === 0 ? <p>No hay lecturas guardadas para consultar.</p> : <TablaHistorialPTAR registros={registros} deshabilitado={ocupado || edicion !== null}
        puedeCorregir={r => rol === area && edicion === null && puedeCorregir(r.lectura)}
        alCorregir={r => { if (!ocupado && puedeCorregir(r.lectura)) setEdicion(structuredClone(r)) }} />}
    </div>}
  </section>
}
export function PanelPTAR() {
  const area = 'ptar' as const
  const datos = usePTAR()
  if (!datos.cuentaId || (datos.rol !== area && datos.rol !== 'admin') || datos.estadoCarga === 'sin-cuenta') return null
  return <ContenidoPTAR key={`${datos.cuentaId}:${datos.rol}:${area}`} datos={datos} />
}
