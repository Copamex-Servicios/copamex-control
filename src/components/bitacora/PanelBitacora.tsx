import { RefreshCw } from 'lucide-react'
import './bitacoraVisual.css'
import { Icono } from '../diseno/Icono'
import { useState } from 'react'
import { useBitacora } from '../../hooks/useBitacora'
import type { AreaOperativa } from '../../lib/tiposTurno'
import type { CamposBitacora } from '../../lib/tiposBitacora'
import { FormularioBitacora } from './FormularioBitacora'
import { LecturaBitacoraGuardada } from './LecturaBitacoraGuardada'

function ContenidoBitacora({ datos, area, referencia }: { datos: ReturnType<typeof useBitacora>; area: AreaOperativa; referencia: boolean }) {
  const [numeroCaptura, setNumeroCaptura] = useState(0)
  const { rol, cuentaId, turno, historial, lecturaActual, estadoCarga, mensaje, mensajeAccion,
    solicitudPendiente, guardando, puedeCrear, guardarBitacora,
    actualizarBitacora, reintentarGuardadoBitacora } = datos
  const listo = estadoCarga === 'listo', ocupado = guardando || !!solicitudPendiente
  const propio = rol === area && turno?.iniciado_por === cuentaId
  const registros = lecturaActual && !historial.some(r => r.lectura.id === lecturaActual.lectura.id)
    ? [lecturaActual, ...historial].slice(0, 20) : historial
  const confirmado = mensajeAccion === 'Nota de Bitácora guardada.' || mensajeAccion === 'Corrección de Bitácora confirmada.'
  async function guardar(campos: CamposBitacora) {
    const resultado = await guardarBitacora(campos)
    if (resultado) setNumeroCaptura(n => n + 1)
    return resultado
  }
  async function reintentar() {
    if (guardando || !solicitudPendiente) return
    const esNueva = solicitudPendiente.solicitud.original === null
    if (await reintentarGuardadoBitacora()) {
      if (esNueva) setNumeroCaptura(n => n + 1)
    }
  }
  return <section className={`panel-informacion panel-bitacora${referencia ? ' bitacora-modulo' : ''}`} aria-label={`Bitácora de ${area === 'calderas' ? 'Calderas' : 'PTAR'}`}>
    <div className="cabecera-turno"><h2>{referencia && <Icono nombre="bitacora" />}Bitácora</h2><button className="boton-secundario" type="button"
      disabled={guardando || estadoCarga === 'cargando'} onClick={() => { void actualizarBitacora() }}>{referencia && <RefreshCw className="bitacora-actualizar-icono" aria-hidden="true" />}Actualizar Bitácora</button></div>
    
    
    {mensajeAccion && <p className={confirmado ? 'mensaje-exito' : 'mensaje-error'} role={confirmado ? 'status' : 'alert'}>{mensajeAccion}</p>}
    {solicitudPendiente && <div className="operacion-pendiente" aria-busy={guardando}>
      <h3>{guardando ? 'Guardando nota…' : 'Nota sin confirmar'}</h3>
      <p>El reintento conserva el mismo texto y turno.</p>
      <p className="texto-bitacora">{solicitudPendiente.solicitud.valores.texto}</p>
      {!guardando && <button type="button" className="boton-primario" onClick={() => { void reintentar() }}>Reintentar el mismo guardado</button>}
    </div>}
    {estadoCarga === 'cargando' && <p role="status">Consultando Bitácora…</p>}
    {estadoCarga === 'error' && <p className="mensaje-error" role="alert">{mensaje || 'No se pudo consultar Bitácora. Usa Actualizar Bitácora para reintentar.'}</p>}
    {propio && turno && <div className="bitacora-captura" hidden={!listo}>
      <h3>Nueva nota del turno</h3>
      <FormularioBitacora key={`${turno.id}:${numeroCaptura}`} alGuardar={guardar} deshabilitado={!puedeCrear || ocupado} />
    </div>}
    {listo && rol === area && !propio && <p>{referencia ? 'Abre un turno para registrar nuevas notas.' : 'Para guardar notas nuevas necesitas tu turno del área abierto. Puedes consultar las notas anteriores.'}</p>}
    {listo && <div className="historial-bitacora"><h3>Historial de Bitácora</h3>
      
      {registros.length === 0 ? <p className="bitacora-vacio">No hay notas guardadas para consultar.</p> : registros.map(r =>
        <LecturaBitacoraGuardada key={r.lectura.id} registro={r} referencia={referencia} deshabilitado={ocupado} />)}
    </div>}
  </section>
}
export function PanelBitacora({ area, referencia = false }: { area: AreaOperativa; referencia?: boolean }) {
  const datos = useBitacora(area)
  if (!datos.cuentaId || (datos.rol !== area && datos.rol !== 'admin') || datos.estadoCarga === 'sin-cuenta') return null
  return <ContenidoBitacora key={`${datos.cuentaId}:${datos.rol}:${area}`} datos={datos} area={area} referencia={referencia} />
}
