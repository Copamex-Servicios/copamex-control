import { RefreshCw } from 'lucide-react'
import './limitesReferencia.css'
import { useRef, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useLimitesCalidad } from '../../hooks/useLimitesCalidad'
import { cargarDisenoLimites, exigirSesionLimite, guardarCambioLimite, pendienteDisenoLimite, pendienteLimite, prepararCambioLimite, numeroLimite } from '../../lib/limitesCalidad'
import type { CambioLimite } from '../../lib/limitesCalidad'
import type { DatosAdmin } from '../../lib/administracion'
interface Celda { punto: string; parametro: string; original: string | null; minimo: string; maximo: string; inicialMin: string; inicialMax: string }
interface Edicion { cuenta: string; celdas: Record<string, Celda> }
export function PanelLimitesCalidad({ datos, cargandoCatalogos = false }: { datos: DatosAdmin | null; cargandoCatalogos?: boolean }) {
 const { perfil } = useAuth()
 const { cuenta, limites, cargando, error, actualizar } = useLimitesCalidad(true)
 const [edicion, setEdicion] = useState<Edicion | null>(null)
 const [operacion, setOperacion] = useState<{ cuenta: string; error: string | null; mensaje: string | null; guardando: boolean } | null>(null)
 const ocupado = useRef(false)
 const editor = edicion?.cuenta === cuenta ? edicion : null
 const estado = operacion?.cuenta === cuenta ? operacion : null
 const pendiente = cuenta ? pendienteLimite(cuenta) : null
 const disenoPendiente = cuenta ? pendienteDisenoLimite(cuenta) : false
 const bloqueado = !!pendiente || disenoPendiente || !!estado?.guardando
 const disponible = !cargandoCatalogos && !!datos && !datos.puntos_muestreo.error && !datos.parametros_calidad.error && !datos.puntos_muestreo.limitada && !datos.parametros_calidad.limitada
 const puntos = (datos?.puntos_muestreo.filas ?? []).filter(p => p.activo)
 const parametros = (datos?.parametros_calidad.filas ?? []).filter(p => p.activo)
 function celda(punto: string, parametro: string): Celda {
  const l = limites.find(l => l.punto_id === punto && l.parametro_id === parametro && l.vigente_hasta === null)
  const minimo = l?.limite_min == null ? '' : String(l.limite_min), maximo = l?.limite_max == null ? '' : String(l.limite_max)
  return { punto, parametro, original: l?.id ?? null, minimo, maximo, inicialMin: minimo, inicialMax: maximo }
 }
 function abrir() {
  if (!cuenta || bloqueado || cargando || error || !disponible) return
  setEdicion({ cuenta, celdas: Object.fromEntries(puntos.flatMap(p => parametros.map(q => [p.id + ':' + q.id, celda(p.id, q.id)]))) })
  setOperacion(null)
 }
 function cambiar(clave: string, campo: 'minimo' | 'maximo', valor: string) {
  setEdicion(prev => prev && prev.cuenta === cuenta ? { ...prev, celdas: { ...prev.celdas, [clave]: { ...prev.celdas[clave], [campo]: valor } } } : prev)
 }
 function confirmado(s: CambioLimite, id: string) {
  const minimo = s.minimo === null ? '' : String(s.minimo), maximo = s.maximo === null ? '' : String(s.maximo)
  setEdicion(prev => {
   const clave = s.punto + ':' + s.parametro
   if (!prev || prev.cuenta !== s.cuenta || !prev.celdas[clave]) return prev
   return { ...prev, celdas: { ...prev.celdas, [clave]: { ...prev.celdas[clave], original: id, minimo, maximo, inicialMin: minimo, inicialMax: maximo } } }
  })
 }
 async function guardar() {
  if (!cuenta || !editor || bloqueado || ocupado.current || cargando || error || !disponible) return
  ocupado.current = true
  setOperacion({ cuenta, error: null, mensaje: null, guardando: true })
  let completados = 0
  try {
   // Validar todas las celdas antes de enviar. Cada cambio conserva la RPC versionada.
   const solicitudes = Object.values(editor.celdas).filter(c => numeroLimite(c.minimo) !== numeroLimite(c.inicialMin) || numeroLimite(c.maximo) !== numeroLimite(c.inicialMax))
    .map(c => prepararCambioLimite(cuenta, c.punto, c.parametro, c.original, c.minimo, c.maximo))
   if (!solicitudes.length) { setOperacion({ cuenta, error: null, mensaje: 'No hay cambios por guardar.', guardando: false }); return }
   for (const s of solicitudes) {
    const id = await guardarCambioLimite(s)
    exigirSesionLimite(cuenta, true)
    confirmado(s, id); completados++
   }
   setEdicion(null)
   setOperacion({ cuenta, error: null, mensaje: 'Cambios guardados y confirmados.', guardando: false })
  } catch (e) {
   setOperacion({ cuenta, error: (completados ? completados + ' cambios ya guardados. ' : '') + (e instanceof Error ? e.message : 'No se confirmó el guardado.'), mensaje: null, guardando: false })
  } finally { ocupado.current = false; actualizar() }
 }
 async function reintentar() {
  if (!cuenta || ocupado.current) return
  ocupado.current = true; setOperacion({ cuenta, error: null, mensaje: null, guardando: true })
  try {
   if (pendiente) { const id = await guardarCambioLimite(pendiente); exigirSesionLimite(cuenta, true); confirmado(pendiente, id) }
   else if (disenoPendiente) { await cargarDisenoLimites(cuenta); exigirSesionLimite(cuenta, true) }
   setOperacion({ cuenta, error: null, mensaje: 'Operación confirmada. Puedes guardar los cambios restantes.', guardando: false })
  } catch(e) { setOperacion({ cuenta, error: e instanceof Error ? e.message : 'No se confirmó la operación.', mensaje: null, guardando: false }) }
  finally { ocupado.current = false; actualizar() }
 }
 if (!cuenta || perfil?.rol !== 'admin') return null
 return <section className="panel-informacion admin-contenido co-limites-referencia">
  <header className="co-limites-encabezado"><div><h2>Límites de Calidad</h2></div>
   <div className="co-limites-acciones"><button type="button" className="boton-secundario" disabled={cargando || bloqueado} onClick={actualizar} data-actualizar="true" aria-label="Actualizar límites" title="Actualizar límites"><RefreshCw size={18} style={{ width: 18, height: 18, flexShrink: 0 }} aria-hidden="true" /></button>
   <button type="button" className="boton-principal" disabled={!!editor || bloqueado || cargando || !!error || !disponible} onClick={abrir}><span aria-hidden="true">✎</span>Editar límites</button></div>
  </header>
  {!datos && cargandoCatalogos && <p role="status">Cargando límites…</p>}
  {editor && <div className="co-limites-modo"><span>Modo edición activado</span></div>}
  {!disponible && !cargandoCatalogos && <p className="mensaje-error" role="alert">Actualiza los catálogos de Administración antes de editar límites.</p>}
  {error && <p className="mensaje-error" role="alert">{error}</p>}
  {estado?.error && <p className="mensaje-error" role="alert">{estado.error}</p>}
  {estado?.mensaje && <p className="mensaje-exito" role="status">{estado.mensaje}</p>}
  {(pendiente || disenoPendiente) && <div className="admin-pendiente"><strong>Operación pendiente de confirmación</strong><button type="button" className="boton-principal" disabled={!!estado?.guardando} onClick={() => { void reintentar() }}>Comprobar / reintentar</button></div>}
  <form onSubmit={e => { e.preventDefault(); void guardar() }}>
   <div className="planta-tabla-scroll"><table className="planta-tabla co-limites-tabla"><caption>Límites vigentes por punto y parámetro</caption>
    <thead><tr><th scope="col">Punto</th>{parametros.map(q => <th scope="col" key={q.id}>Límite de {String(q.nombre)}</th>)}</tr></thead>
    <tbody>{puntos.map(p => <tr key={p.id}><th scope="row">{String(p.nombre)}</th>{parametros.map(q => {
     const clave = p.id + ':' + q.id, c = editor?.celdas[clave] ?? celda(p.id, q.id)
     return <td key={q.id}><div className={'co-limite-input' + (!editor && !c.original ? ' co-limite-sin-configurar' : '')}><span aria-hidden="true">≤</span>
      <input aria-label={'Límite máximo de ' + String(q.nombre) + ' en ' + String(p.nombre)} inputMode="decimal" value={c.maximo} placeholder={c.minimo ? 'Sin máximo' : 'Sin límite definido'} readOnly={!editor} disabled={bloqueado || !!error || cargando || !disponible} onChange={e => cambiar(clave, 'maximo', e.target.value)} />
     </div></td>
    })}</tr>)}</tbody>
   </table></div>
   {editor && <footer className="co-limites-pie"><button type="button" className="boton-secundario" disabled={bloqueado} onClick={() => { setEdicion(null); setOperacion(null) }}>Cancelar</button><button type="submit" className="boton-principal" disabled={bloqueado || cargando || !!error || !disponible}>{estado?.guardando ? 'Guardando…' : 'Guardar cambios'}</button></footer>}
  </form>
 </section>
}
