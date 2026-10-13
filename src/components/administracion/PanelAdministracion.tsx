import './operadoresEstado.css'
import './administracionReferencia.css'
import { Icono } from '../diseno/Icono'
import './gestionCompacta.css'
import { finalizarAviso } from '../../lib/finalizarAviso'
import './finalizarAviso.css'
import { PanelRevisionCapturas } from './PanelRevisionCapturas'
import { useId, useRef, useState } from 'react'
import { useAdministracion } from '../../hooks/useAdministracion'
import { configuracionAdmin, fechaMexicoAdmin, seccionesAdmin } from '../../lib/administracion'
import type { ConfigAdmin, DatosAdmin, FilaAdmin, TablaAdmin } from '../../lib/administracion'
import { PanelLimitesCalidad } from './PanelLimitesCalidad'
import { FormularioAdmin } from './FormularioAdmin'

function etiqueta(c: ConfigAdmin, fila: FilaAdmin, campo: string, datos: DatosAdmin): string {
  const f = c.campos.find(e => e.clave === campo)!, valor = fila[campo]
  if (valor === null) return f.clave === 'area' ? 'Sin asignar (ambas áreas)' : '—'
  if (typeof valor === 'boolean') return valor ? 'Sí' : 'No'
  if (f.tipo === 'instante' && typeof valor === 'string') return fechaMexicoAdmin(valor).replace('T', ' ')
  if (f.tipo === 'referencia' && f.referencia) {
    const r = datos[f.referencia].filas.find(e => e.id === valor)
    return r ? `${r.codigo ? `${r.codigo} · ` : ''}${r.nombre}` : 'Referencia no disponible'
  }
  if (f.tipo === 'opcion') return f.opciones?.find(([v]) => v === valor)?.[1] ?? String(valor)
  return String(valor)
}
export function PanelAdministracion({ soloGestion = false }: { soloGestion?: boolean }) {
  const { cuenta, datos, cargando, guardando, pendiente, error, mensaje, guardar, reintentar, actualizar } = useAdministracion()
  const [finalizando, setFinalizando] = useState<string | null>(null)
  const [horaConsulta, setHoraConsulta] = useState(() => Date.now())
  const [resultadoCierre, setResultadoCierre] = useState<{ error: boolean; texto: string } | null>(null)
  const cierreActivo = useRef(false)
  async function finalizar(fila: FilaAdmin) {
    if (!cuenta || cierreActivo.current || guardando || pendiente || editor) return
    cierreActivo.current = true; setFinalizando(fila.id); setResultadoCierre(null)
    try { const cerrado = await finalizarAviso(cuenta, fila); setHoraConsulta(typeof cerrado.fin === 'string' ? Date.parse(cerrado.fin) : Date.now()); setResultadoCierre({ error: false, texto: 'Aviso finalizado.' }); actualizar(); window.dispatchEvent(new Event('copamex:avisos-actualizados')) }
    catch (e) { setResultadoCierre({ error: true, texto: e instanceof Error ? e.message : 'No se confirmó el cierre. Actualiza y reintenta.' }) }
    finally { cierreActivo.current = false; setFinalizando(null) }
  }
  const [vistaLimites, setVistaLimites] = useState(false)
  const [vistaCapturas, setVistaCapturas] = useState(false)
  const [tabla, setTabla] = useState<TablaAdmin>(soloGestion ? 'avisos' : 'operadores')
  const [estadoOperadores, setEstadoOperadores] = useState('activos')
  const [cambiandoOperador, setCambiandoOperador] = useState(false)
  const cambioOperadorActivo = useRef(false)
  async function cambiarEstadoOperador(fila: FilaAdmin) {
    if (cambioOperadorActivo.current || guardando || pendiente || finalizando || editor) return
    cambioOperadorActivo.current = true; setCambiandoOperador(true)
    try {
      await guardar('operadores', { nombre: fila.nombre, numero_empleado: fila.numero_empleado, activo: fila.activo !== true }, fila)
    } finally { cambioOperadorActivo.current = false; setCambiandoOperador(false) }
  }
  const [busqueda, setBusqueda] = useState('')
  const [pagina, setPagina] = useState(1)
  const [editor, setEditor] = useState<{ tabla: TablaAdmin; original: FilaAdmin | null; clave: string } | null>(null)
  const c = configuracionAdmin(tabla), fuente = datos?.[tabla]
  const texto = busqueda.trim().toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const filas = datos && fuente ? fuente.filas.filter(r => (tabla !== 'operadores' || estadoOperadores === 'todos' || r.activo === (estadoOperadores === 'activos')) && c.campos.some(f => etiqueta(c, r, f.clave, datos).toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(texto))) : []
  const paginas = Math.max(1, Math.ceil(filas.length / 20)), actual = Math.min(pagina, paginas)
  const bloqueado = cambiandoOperador || guardando || !!pendiente || finalizando !== null
  function abrir(original: FilaAdmin | null) { setEditor({ tabla, original, clave: crypto.randomUUID() }) }
  if (!cuenta) return null
  return <div className={soloGestion ? 'admin-panel co-gestion-compacta' : 'admin-panel co-admin-referencia'}>
    {!soloGestion && <nav className="acciones-turno co-admin-tabs" aria-label="Tipo de administración"><button type="button" className={vistaLimites || vistaCapturas ? "boton-secundario" : "boton-principal"} aria-pressed={!vistaLimites && !vistaCapturas} onClick={() => { setVistaLimites(false); setVistaCapturas(false) }}><Icono nombre="bitacora" />Catálogos y avisos</button><button type="button" className={vistaLimites ? "boton-principal" : "boton-secundario"} aria-pressed={vistaLimites} onClick={() => { setVistaLimites(true); setVistaCapturas(false) }}><Icono nombre="reportes" />Límites de Calidad</button><button type="button" className={vistaCapturas ? "boton-principal" : "boton-secundario"} aria-pressed={vistaCapturas} onClick={() => { setVistaCapturas(true); setVistaLimites(false) }}><Icono nombre="modulos" />Capturas</button></nav>}
    {vistaCapturas && <PanelRevisionCapturas key={cuenta} />}
    {!soloGestion && <div hidden={!vistaLimites}><PanelLimitesCalidad key={cuenta} datos={datos} /></div>}
    <div hidden={vistaLimites || vistaCapturas}>

    {error && <p className="mensaje-error" role="alert">{error}</p>}
    {resultadoCierre && <p className={resultadoCierre.error ? "mensaje-error" : "mensaje-exito"} role={resultadoCierre.error ? "alert" : "status"}>{resultadoCierre.texto}</p>}
    {mensaje && <p className="mensaje-exito" role="status">{mensaje}</p>}
    {pendiente && <div className="admin-pendiente" role="status"><strong>{guardando ? 'Confirmando guardado…' : 'Guardado pendiente de confirmación'}</strong><p>{configuracionAdmin(pendiente.tabla).nombre}: se conserva la misma solicitud para evitar duplicados. Comprueba el resultado antes de guardar otro registro.</p><button type="button" className="boton-principal" disabled={guardando} onClick={() => { void reintentar().then(fila => { if (fila) setEditor(null) }) }}>Comprobar / reintentar</button></div>}
    <div className="admin-distribucion"><nav className="admin-menu" aria-label="Secciones de administración">{seccionesAdmin.filter(s => s.tabla !== 'catalogo_papeles' && (soloGestion ? ['avisos','programa_produccion','eventos_calendario'].includes(s.tabla) : !['programa_produccion','eventos_calendario','maquinas','parametros_calidad'].includes(s.tabla))).map(s => <button type="button" key={s.tabla} aria-current={s.tabla === tabla ? 'page' : undefined} onClick={() => { setTabla(s.tabla); setBusqueda(''); setPagina(1) }}>{!soloGestion && <Icono
  nombre={
    s.tabla === 'operadores'
      ? 'cuentaadm'
      : s.tabla === 'avisos'
        ? 'bitacora'
        : 'pozos'
  }
/>}<span>{s.nombre}</span><span>{datos && !datos[s.tabla].error ? datos[s.tabla].filas.length : '—'}</span></button>)}{<button type="button" className="co-gestion-actualizar" disabled={cargando || guardando} onClick={() => { setHoraConsulta(Date.now()); actualizar() }}>{cargando ? 'Actualizando…' : 'Actualizar'}</button>}</nav>
      <section className="panel-informacion admin-contenido" aria-labelledby="titulo-catalogo"><div className={soloGestion ? 'co-gestion-barra' : 'planta-encabezado'}><div><h2 id="titulo-catalogo">{c.nombre}</h2>{!soloGestion && <p className="co-admin-contador" aria-live="polite">{filas.length}{fuente?.limitada ? '+' : ''} {tabla === 'operadores' ? 'operadores' : tabla === 'avisos' ? 'avisos' : tabla === 'puntos_muestreo' ? 'puntos' : 'registros'}</p>}</div>
        {soloGestion && <label className="co-gestion-buscador"><span className="co-sr-only">Buscar en {c.nombre}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg><input type="search" value={busqueda} placeholder="Buscar por nombre, código, mensaje o fecha" onChange={e => { setBusqueda(e.target.value); setPagina(1) }} /></label>}
        <button type="button" className="boton-principal" onClick={() => abrir(null)} disabled={bloqueado || !!editor || !datos || fuente?.error}><span className="co-gestion-mas" aria-hidden="true">+</span>Nuevo {c.singular}</button></div>
        {fuente?.error && <p className="mensaje-error" role="alert">No se pudo consultar esta sección. Pulsa Actualizar para reintentar.</p>}
        {fuente?.limitada && <p className="planta-aviso">Se muestran hasta 1,000 registros de esta sección. La búsqueda se aplica a los registros consultados.</p>}
        {editor && editor.tabla !== tabla && <p className="planta-aviso">Tienes un formulario abierto en {configuracionAdmin(editor.tabla).nombre}. Vuelve a esa sección para continuar o cancelarlo.</p>}
        {datos && editor && <div hidden={editor.tabla !== tabla}><FormularioAdmin key={editor.clave} config={configuracionAdmin(editor.tabla)} datos={datos} original={editor.original} bloqueado={bloqueado} cancelar={() => setEditor(null)} guardar={async valores => { const fila = await guardar(editor.tabla, valores, editor.original); if (fila) setEditor(null); return !!fila }} /></div>}
        {!soloGestion && <label className="admin-busqueda"><span className="co-admin-sr">Buscar en {c.nombre}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg><input type="search" value={busqueda} placeholder={tabla === 'operadores' ? 'Buscar operador por nombre o número de empleado' : tabla === 'avisos' ? 'Buscar aviso por mensaje o fecha' : tabla === 'puntos_muestreo' ? 'Buscar punto por nombre o área' : 'Buscar por nombre, código o fecha'} onChange={e => { setBusqueda(e.target.value); setPagina(1) }} /></label>}
        {!soloGestion && tabla === 'operadores' && <label className="co-operadores-filtro">Estado <select value={estadoOperadores} onChange={e => { setEstadoOperadores(e.target.value); setPagina(1) }}><option value="activos">Activos</option><option value="inactivos">Inactivos</option><option value="todos">Todos</option></select></label>}
        <p className="ayuda-turno" aria-live="polite">{filas.length} {soloGestion ? 'registros encontrados' : 'registros coinciden con la búsqueda.'}</p>
        {tabla === 'avisos' ? <TablaAvisosGestion filas={datos ? filas.slice((actual - 1) * 20, actual * 20) : []} hora={horaConsulta} bloqueado={bloqueado || !!editor} finalizando={finalizando} editar={abrir} finalizar={fila => { void finalizar(fila) }} /> : <div className="planta-tabla-scroll" tabIndex={0} role="region" aria-label="Catálogo administrativo, tabla desplazable"><table className="planta-tabla admin-tabla"><caption>{c.nombre}. Las horas de avisos se muestran en México.</caption><thead><tr>{c.campos.map(f => <th scope="col" key={f.clave}>{!soloGestion && f.clave === 'activo' ? 'Estado' : f.nombre}</th>)}<th scope="col">{soloGestion ? 'Acción' : 'Acciones'}</th></tr></thead><tbody>{datos && filas.slice((actual - 1) * 20, actual * 20).map(r => <tr key={r.id}>{c.campos.map(f => <td key={f.clave}>{!soloGestion && f.clave === 'activo' ? <span className={`co-admin-estado ${r.activo === true ? 'co-admin-activo' : 'co-admin-inactivo'}`}><span aria-hidden="true" />{r.activo === true ? 'Activo' : 'Inactivo'}</span> : <span className={f.tipo === 'largo' ? 'planta-resumen-captura' : ''}>{etiqueta(c, r, f.clave, datos)}</span>}</td>)}<td><div className="admin-acciones-aviso"><button type="button" className="boton-secundario" onClick={() => abrir(r)} disabled={bloqueado || !!editor}>{!soloGestion && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m15 4 5 5M4 20l4-1L20 7a2 2 0 0 0-4-4L4 15Zm0 0h16" /></svg>}Editar</button>{tabla === 'operadores' && <button type="button" className="boton-secundario" disabled={bloqueado || !!editor} onClick={() => { void cambiarEstadoOperador(r) }}>{r.activo === true ? 'Desactivar' : 'Reactivar'}</button>}</div></td></tr>)}</tbody></table></div>}
        {!filas.length && <p className="planta-vacio">{cargando && !datos ? 'Consultando…' : fuente?.error ? 'La consulta no está disponible.' : 'No hay registros que coincidan. Puedes agregar uno con el botón Nuevo.'}</p>}
        <div className="planta-paginacion"><button type="button" className="boton-secundario" disabled={actual <= 1} onClick={() => setPagina(actual - 1)}>Anterior</button><span>Página {actual} de {paginas}</span><button type="button" className="boton-secundario" disabled={actual >= paginas} onClick={() => setPagina(actual + 1)}>Siguiente</button></div>
      </section></div>
    </div>
  </div>
}

function estadoAvisoGestion(fila: FilaAdmin, hora: number): 'Activo' | 'Programado' | 'Finalizado' {
  if (fila.permanente === true) return 'Activo'
  if (typeof fila.fin === 'string' && Date.parse(fila.fin) <= hora) return 'Finalizado'
  if (typeof fila.inicio === 'string' && Date.parse(fila.inicio) > hora) return 'Programado'
  return 'Activo'
}
function fechaAvisoGestion(valor: unknown, soloFecha = false) {
  if (typeof valor !== 'string') return '—'
  const fecha = fechaMexicoAdmin(valor)
  return soloFecha ? fecha.split('T')[0].split('-').reverse().join('/') : fecha.replace('T', ' ')
}
function TablaAvisosGestion({ filas, hora, bloqueado, finalizando, editar, finalizar }: { filas: FilaAdmin[]; hora: number; bloqueado: boolean; finalizando: string | null; editar: (fila: FilaAdmin) => void; finalizar: (fila: FilaAdmin) => void }) {
  return <div className="planta-tabla-scroll" tabIndex={0} role="region" aria-label="Catálogo administrativo, tabla desplazable"><table className="planta-tabla admin-tabla co-tabla-avisos"><caption>Avisos. Fechas y horas de México.</caption><thead><tr>{['Mensaje','Tipo','Vigencia','Mostrar desde (México)','Mostrar hasta (México)','Estado','Acciones'].map(titulo => <th scope="col" key={titulo}>{titulo}</th>)}</tr></thead><tbody>
    {filas.map(fila => {
      const estado = estadoAvisoGestion(fila, hora), permanente = fila.permanente === true
      return <tr key={fila.id}>
        <td><span className="co-aviso-texto-tabla" title={String(fila.mensaje ?? '')}>{String(fila.mensaje ?? '')}</span></td>
        <td><span className={`co-chip-gestion ${permanente ? 'co-chip-permanente' : 'co-chip-temporal'}`}>{permanente ? 'Permanente' : 'Temporal'}</span></td>
        <td className="co-aviso-vigencia">{permanente ? '—' : <>{fila.inicio ? `Del ${fechaAvisoGestion(fila.inicio, true)}` : 'Sin fecha de inicio'}<br />{fila.fin ? `al ${fechaAvisoGestion(fila.fin, true)}` : 'Sin fecha de fin'}</>}</td>
        <td>{fechaAvisoGestion(fila.inicio)}</td><td>{fechaAvisoGestion(fila.fin)}</td>
        <td><span className={`co-chip-gestion co-chip-${estado.toLowerCase()}`}>{estado}</span></td>
        <td><div className="co-aviso-acciones-tabla"><button type="button" className="boton-secundario" disabled={bloqueado} onClick={() => editar(fila)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m15 4 5 5M4 20l4-1L20 7a2 2 0 0 0-4-4L4 15Zm0 0h16" /></svg>Editar</button>{estado !== 'Finalizado' && <MenuAvisoGestion bloqueado={bloqueado} mensaje={String(fila.mensaje ?? '')} finalizando={finalizando === fila.id} finalizar={() => finalizar(fila)} />}</div></td>
      </tr>
    })}
  </tbody></table></div>
}
function MenuAvisoGestion({ bloqueado, mensaje, finalizando, finalizar }: { bloqueado: boolean; mensaje: string; finalizando: boolean; finalizar: () => void }) {
  const id = useId(), menu = useRef<HTMLDivElement>(null)
  return <><button type="button" className="boton-secundario co-aviso-mas-acciones" disabled={bloqueado} aria-label={`Más acciones para ${mensaje}`} popoverTarget={id} onClick={e => {
    const elemento = menu.current
    if (!elemento) return
    const rect = e.currentTarget.getBoundingClientRect()
    elemento.style.left = Math.max(8, Math.min(rect.right - 190, window.innerWidth - 198)) + 'px'
    elemento.style.top = (rect.bottom + 64 < window.innerHeight ? rect.bottom + 6 : Math.max(8, rect.top - 58)) + 'px'
  }}>···</button><div ref={menu} id={id} popover="auto" className="co-menu-aviso-gestion"><button type="button" disabled={bloqueado} onClick={() => { menu.current?.hidePopover(); finalizar() }}>{finalizando ? 'Finalizando…' : 'Finalizar aviso'}</button></div></>
}
