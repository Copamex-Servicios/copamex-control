import { useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { CambioReporte, ConsultaReporte } from '../../lib/reportes'
import { capturasPlanta, nombresModulo, nombresTurno } from '../../lib/planta'
import { fechaMexicoAdmin } from '../../lib/administracion'
import { medicionesPTAR } from '../../lib/tiposPTAR'
import { useAuthStore } from '../../stores/authStore'
import './trazabilidadReporte.css'

const acciones: Record<string, string> = { INSERT: 'Creación', UPDATE: 'Modificación', DELETE: 'Eliminación' }
const modulos: Record<string, string> = {
  turnos_operativos: 'Turnos', bitacora: 'Bitácora', lecturas_pozos: 'Pozos', lecturas_uf: 'Ultrafiltración',
  muestras_calidad: 'Calidad', resultados_calidad: 'Calidad', lecturas_ptar: 'PTAR',
}
const etiquetas: Record<string, string> = {
  ...Object.fromEntries(medicionesPTAR.map(m => [m.campo, `${m.parametro} · ${m.punto} (mg/L)`])),
  capturado_en: 'Fecha de captura', recibido_en: 'Fecha de recepción', creado_en: 'Fecha de creación',
  iniciado_en: 'Inicio del turno', finalizado_en: 'Cierre del turno', eliminado_en: 'Fecha de anulación',
  fecha_operativa: 'Fecha operativa', notas_cierre: 'Notas de cierre', texto: 'Texto', notas: 'Observaciones',
  pozo1_ini: 'Pozo 1: lectura inicial', pozo1_fin: 'Pozo 1: lectura final', consumo_pozo1: 'Consumo Pozo 1 (m³)',
  pozo2_ini: 'Pozo 2: lectura inicial', pozo2_fin: 'Pozo 2: lectura final', consumo_pozo2: 'Consumo Pozo 2 (m³)',
  alim_ini: 'Alimentado: lectura inicial', alim_fin: 'Alimentado: lectura final', alimentado: 'Alimentado (m³)',
  acep_ini: 'Aceptado: lectura inicial', acep_fin: 'Aceptado: lectura final', aceptado: 'Aceptado (m³)',
  rechazo: 'Rechazo (m³)', rendimiento: 'Rendimiento (%)', fuera_norma: 'Fuera de límite',
  limite_min_aplicado: 'Límite mínimo aplicado', limite_max_aplicado: 'Límite máximo aplicado',
  revision_admin: 'Revisión administrativa', hora_muestra: 'Hora de muestra',
}
const abreviar = (id: string) => id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
const campoTecnico = (campo: string) => campo === 'id' || campo.endsWith('_id') || campo.endsWith('_por')
const nombreCampo = (campo: string) => etiquetas[campo] ?? campo.replaceAll('_', ' ').replace(/^./, c => c.toLocaleUpperCase('es'))
const objeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

// Compara valores JSON por contenido, sin depender del orden de sus propiedades.
function iguales(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => iguales(v, b[i]))
  if (!objeto(a) || !objeto(b)) return false
  const claves = Object.keys(a)
  return claves.length === Object.keys(b).length && claves.every(k => Object.hasOwn(b, k) && iguales(a[k], b[k]))
}
function camposComparados(antes: Record<string, unknown>, despues: Record<string, unknown>, prefijo = ''): { campo: string; antes: unknown; despues: unknown }[] {
  return [...new Set([...Object.keys(antes), ...Object.keys(despues)])].flatMap(k => {
    if (campoTecnico(k) || iguales(antes[k], despues[k])) return []
    const campo = prefijo + nombreCampo(k)
    return objeto(antes[k]) && objeto(despues[k]) ? camposComparados(antes[k], despues[k], `${campo} / `) : [{ campo, antes: antes[k], despues: despues[k] }]
  })
}
function Valor({ valor }: { valor: unknown }): ReactNode {
  if (valor === undefined) return <span className="rep-traza-vacio">No disponible</span>
  if (valor === null || valor === '') return <span className="rep-traza-vacio">Sin valor</span>
  if (typeof valor === 'boolean') return valor ? 'Sí' : 'No'
  if (Array.isArray(valor)) return valor.length ? <ol className="rep-traza-lista">{valor.map((v, i) => <li key={i}><Valor valor={v} /></li>)}</ol> : 'Sin elementos'
  if (objeto(valor)) return <dl className="rep-traza-valores">{Object.entries(valor).filter(([k]) => !campoTecnico(k)).map(([k, v]) => <div key={k}><dt>{nombreCampo(k)}</dt><dd><Valor valor={v} /></dd></div>)}</dl>
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(valor) && Number.isFinite(Date.parse(valor))) return fechaMexicoAdmin(valor).replace('T', ' ')
  return String(valor)
}

export function TrazabilidadReporte({ reporte: r }: { reporte: ConsultaReporte }) {
  const perfil = useAuthStore(s => s.perfil)
  const [pagina, setPagina] = useState(1), [seleccionado, setSeleccionado] = useState<CambioReporte | null>(null)
  const dialogo = useRef<HTMLDialogElement>(null), tituloId = useId()
  const capturas = capturasPlanta(r.actual)
  const filas = r.cambios.slice().reverse(), paginas = Math.max(1, Math.ceil(filas.length / 15)), actual = Math.min(pagina, paginas)
  function contexto(c: CambioReporte) {
    const tabla = c.tabla.replace(/^public\./, ''), datos = c.despues ?? c.antes
    const captura = capturas.find(e => {
      if (tabla === 'resultados_calidad') {
        const muestraId = datos?.muestra_id ?? c.antes?.muestra_id
        return e.modulo === 'calidad' && (typeof muestraId === 'string' ? e.registro.lectura.id === muestraId : e.registro.lectura.resultados.some(v => v.id === c.registro_id))
      }
      return nombresModulo[e.modulo] === modulos[tabla] && e.registro.lectura.id === c.registro_id
    })
    const turnoId = tabla === 'turnos_operativos' ? c.registro_id : datos?.turno_id ?? c.antes?.turno_id ?? captura?.registro.turno.id
    const t = r.actual.turnos.elementos.find(e => e.turno.id === turnoId)?.turno
      ?? (captura?.registro.turno.id === turnoId ? captura?.registro.turno : undefined)
    const area = (tabla === 'turnos_operativos' ? datos?.area : null) ?? t?.area
    const turno = (tabla === 'turnos_operativos' ? datos?.turno : null) ?? t?.turno
    return {
      modulo: modulos[tabla] ?? nombreCampo(tabla),
      area: area === 'calderas' ? 'Calderas' : area === 'ptar' ? 'PTAR' : 'No disponible',
      turno: turno === 'dia' || turno === 'tarde' || turno === 'noche' ? nombresTurno[turno] : 'No disponible',
      responsable: c.usuario && perfil?.id === c.usuario && perfil.nombre ? perfil.nombre : c.usuario ? abreviar(c.usuario) : 'No disponible',
    }
  }
  const detalle = seleccionado ? contexto(seleccionado) : null
  const diferencias = seleccionado?.antes && seleccionado.despues ? camposComparados(seleccionado.antes, seleccionado.despues) : []
  if (r.auditoria === 'no-solicitada') return <section className="panel-informacion"><h2>Trazabilidad de cambios</h2><p>Historial no solicitado. Inclúyelo al generar el reporte.</p></section>
  return <section className="panel-informacion rep-traza">
    <h2>Trazabilidad de cambios</h2>
    <p className="ayuda-turno">Historial de los registros seleccionados. Horarios de México.</p>
    {r.auditoria !== 'completa' && <p className="mensaje-error" role="alert">Historial incompleto: los totales incluyen únicamente las operaciones disponibles. Genera nuevamente.</p>}
    <div className="rep-traza-metricas">{[
      ['Total de operaciones', filas.length], ['Registros creados (INSERT)', filas.filter(c => c.accion === 'INSERT').length],
      ['Registros modificados (UPDATE)', filas.filter(c => c.accion === 'UPDATE').length],
    ].map(([nombre, valor]) => <div key={nombre}><span>{nombre}</span><strong>{valor}</strong></div>)}</div>
    <div className="planta-tabla-scroll" tabIndex={0} role="region" aria-label="Operaciones de auditoría">
      <table className="planta-tabla"><thead><tr>{['Fecha y hora', 'Acción', 'Módulo', 'Área', 'Turno', 'Responsable', 'Detalle'].map(c => <th scope="col" key={c}>{c}</th>)}</tr></thead>
        <tbody>{filas.slice((actual - 1) * 15, actual * 15).map(c => { const v = contexto(c); return <tr key={c.id}>
          <td>{fechaMexicoAdmin(c.creado_en).replace('T', ' ')}</td><td><span className={`rep-traza-accion rep-traza-${c.accion.toLowerCase()}`}>{acciones[c.accion] ?? c.accion}</span></td>
          <td>{v.modulo}</td><td>{v.area}</td><td>{v.turno}</td><td>{v.responsable}</td>
          <td><button type="button" className="boton-secundario" onClick={() => { setSeleccionado(c); dialogo.current?.showModal() }}>Ver</button></td>
        </tr> })}</tbody>
      </table>{!filas.length && <p className="rep-traza-sin-datos">Sin operaciones de auditoría disponibles.</p>}
    </div>
    <div className="planta-paginacion"><span>{filas.length ? `${(actual - 1) * 15 + 1}–${Math.min(actual * 15, filas.length)} de ${filas.length}` : '0 operaciones'}</span>
      <button type="button" className="boton-secundario" disabled={actual <= 1} onClick={() => setPagina(actual - 1)}>Anterior</button><span>Página {actual} de {paginas}</span><button type="button" className="boton-secundario" disabled={actual >= paginas} onClick={() => setPagina(actual + 1)}>Siguiente</button>
    </div>
    <dialog ref={dialogo} className="rep-traza-dialog" aria-labelledby={tituloId} onClose={() => setSeleccionado(null)} onClick={e => { if (e.target === e.currentTarget) { const b = e.currentTarget.getBoundingClientRect(); if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) dialogo.current?.close() } }}>
      <div className="rep-traza-cabecera"><h2 id={tituloId}>Detalle de la operación</h2><button type="button" className="boton-secundario" onClick={() => dialogo.current?.close()} autoFocus>Cerrar</button></div>
      {seleccionado && detalle && <>
        <dl className="rep-traza-datos">{[
          ['Fecha y hora', fechaMexicoAdmin(seleccionado.creado_en).replace('T', ' ')], ['Acción', acciones[seleccionado.accion] ?? seleccionado.accion],
          ['Módulo', detalle.modulo], ['Área', detalle.area], ['Turno', detalle.turno], ['Responsable', detalle.responsable],
        ].map(([nombre, valor]) => <div key={nombre}><dt>{nombre}</dt><dd>{valor}</dd></div>)}</dl>
        {seleccionado.accion === 'UPDATE' ? <><h3>Campos modificados</h3>{!seleccionado.antes || !seleccionado.despues ? <p>No hay valores suficientes para comparar. Consulta los detalles técnicos.</p> : diferencias.length ? <div className="rep-traza-comparacion"><table><thead><tr><th scope="col">Campo</th><th scope="col">Antes</th><th scope="col">Después</th></tr></thead><tbody>{diferencias.map(d => <tr key={d.campo}><th scope="row">{d.campo}</th><td><Valor valor={d.antes} /></td><td><Valor valor={d.despues} /></td></tr>)}</tbody></table></div> : <p>Sin cambios en los campos de presentación. Consulta los detalles técnicos.</p>}</>
          : <><h3>{seleccionado.accion === 'DELETE' ? 'Datos del registro eliminado' : 'Datos del registro creado'}</h3><Valor valor={seleccionado.accion === 'DELETE' ? seleccionado.antes : seleccionado.despues} /></>}
        <details className="rep-traza-tecnicos"><summary>Detalles técnicos</summary><pre>{JSON.stringify(seleccionado, null, 2)}</pre></details>
      </>}
    </dialog>
  </section>
}
