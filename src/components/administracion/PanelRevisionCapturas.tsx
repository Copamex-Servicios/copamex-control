import { RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { fechaMexicoAdmin } from '../../lib/administracion'
import { filtrosInicialesPlanta } from '../../lib/planta'
import { camposRevision, consultarCapturasRevision, consultarHistorialRevision, datosEdicionRevision, exigirAdminRevision, guardarRevision, nombresRevision, pendienteRevision, prepararRevision, validarFiltrosRevision } from '../../lib/revisionCapturas'
import type { CapturaRevision, FiltrosRevision, Revision, SolicitudRevision } from '../../lib/revisionCapturas'
import type { AreaOperativa } from '../../lib/tiposTurno'
import type { FiltrosPlanta } from '../../lib/planta'

interface SupervisionRegistros {
  filtros: FiltrosPlanta
  borrador: FiltrosPlanta
  onBorrador: (f: FiltrosPlanta) => void
  onConsultar: () => void
}

const hora=(v: unknown)=>typeof v==='string'?fechaMexicoAdmin(v).replace('T',' '):'—'
const mostrar=(v: unknown)=>v===null||v===undefined?'—':String(v)
const fecha=(s: string)=>s.split('-').reverse().join('/')
const modulosPorArea = { calderas: ['bitacora','pozos','uf','calidad'], ptar: ['bitacora','ptar','calidad'] } as const
const moduloValido=(modulo:string,a:string)=>a==='todas'||modulo==='todos'||modulosPorArea[a as AreaOperativa]?.some(m=>m===modulo)?modulo:'todos'
function resultadoNombre(c: CapturaRevision,id: unknown) {
  const n=c.nombres_resultados.find(r=>r.id===id)
  return n?`${n.punto} · ${n.parametro}${n.unidad?` (${n.unidad})`:''}`:`Resultado ${String(id)}`
}
function resumen(c: CapturaRevision) {
  const r=c.snapshot.registro
  if(c.modulo==='bitacora')return String(r.texto)
  if(c.modulo==='pozos')return `Pozo 1: ${r.consumo_pozo1} m³ · Pozo 2: ${r.consumo_pozo2} m³`
  if(c.modulo==='uf')return `Alimentado: ${r.alimentado} m³ · Aceptado: ${r.aceptado} m³ · Rendimiento: ${r.rendimiento===null?'—':`${r.rendimiento}%`}`
  if(c.modulo==='calidad')return c.snapshot.resultados.map(e=>`${resultadoNombre(c,e.id)}: ${e.valor}`).join(' / ')
  return 'DQO y SST · Revisar mediciones'
}
function filasCambios(c: CapturaRevision,r: Revision) {
  const etiquetas: Record<string,string>=Object.fromEntries(camposRevision[c.modulo].map(f=>[f.clave,f.nombre]))
  Object.assign(etiquetas,{consumo_pozo1:'Consumo Pozo 1 (m³)',consumo_pozo2:'Consumo Pozo 2 (m³)',alimentado:'Alimentado (m³)',aceptado:'Aceptado (m³)',rechazo:'Rechazo (m³)',rendimiento:'Rendimiento (%)',eliminado_en:'Fecha de anulación',eliminado_por:'Cuenta que anuló'})
  const filas=Object.entries(etiquetas).filter(([k])=>r.antes.registro[k]!==r.despues.registro[k]).map(([k,nombre])=>({nombre,antes:k==='eliminado_en'?hora(r.antes.registro[k]):mostrar(r.antes.registro[k]),despues:k==='eliminado_en'?hora(r.despues.registro[k]):mostrar(r.despues.registro[k])}))
  for(const antes of r.antes.resultados){const despues=r.despues.resultados.find(e=>e.id===antes.id);if(despues&&antes.valor!==despues.valor)filas.push({nombre:resultadoNombre(c,antes.id),antes:mostrar(antes.valor),despues:mostrar(despues.valor)})}
  return filas
}
function HistorialRevision({ cuenta,captura,revision }: {cuenta:string;captura:CapturaRevision;revision:number}) {
  const [vista,setVista]=useState<{filas:Revision[];error:string|null;cargando:boolean}>({filas:[],error:null,cargando:true})
  useEffect(()=>{let vivo=true;const control=new AbortController();void consultarHistorialRevision(cuenta,captura,control.signal).then(filas=>{if(vivo)setVista({filas,error:null,cargando:false})}).catch(e=>{if(vivo)setVista({filas:[],error:e instanceof Error?e.message:'Consulta no disponible.',cargando:false})});return()=>{vivo=false;control.abort()}},[cuenta,captura,revision])
  return <section className="revision-historial"><h3>Historial administrativo</h3>{vista.cargando?<p>Consultando…</p>:vista.error?<p role="alert" className="mensaje-error">{vista.error}</p>:!vista.filas.length?<p className="ayuda-turno">Sin correcciones o anulaciones administrativas registradas.</p>:vista.filas.map(r=><article key={r.id} className="revision-evento"><div className="planta-encabezado"><strong>{r.accion==='anular'?'Anulación':'Corrección'} · {r.responsable_nombre}</strong><time dateTime={r.creado_en}>{hora(r.creado_en)} · México</time></div><p className="notas-turno"><strong>Motivo:</strong> {r.motivo}</p><div className="planta-tabla-scroll"><table className="planta-tabla"><thead><tr><th>Campo</th><th>Antes</th><th>Después</th></tr></thead><tbody>{filasCambios(captura,r).map((e,i)=><tr key={i}><td>{e.nombre}</td><td className="revision-texto">{e.antes}</td><td className="revision-texto">{e.despues}</td></tr>)}</tbody></table></div><small>Cuenta responsable: {r.creado_por} · Revisión: {r.id}</small></article>)}</section>
}

export function PanelRevisionCapturas({ area, supervision }: { area?: AreaOperativa; supervision?: SupervisionRegistros } = {}) {
  const auth=useAuth()
  const cuenta=auth.estado==='autenticado'&&auth.perfil?.activo===true&&auth.perfil.rol==='admin'&&auth.perfil.id===auth.sesion?.user.id?auth.perfil.id:null
  const inicial=():FiltrosRevision=>({...filtrosInicialesPlanta(),...(area ? {area} : {}),modulo:'todos',estado:'vigentes',operador:''})
  const [borradorLocal,setBorradorLocal]=useState(inicial),[filtrosLocal,setFiltros]=useState(inicial),[navegacion,setNavegacion]=useState({clave:'',pagina:1}),[revision,setRevision]=useState(0)
  const borrador=supervision?{...borradorLocal,...supervision.borrador,modulo:moduloValido(borradorLocal.modulo,supervision.borrador.area)}:borradorLocal
  const filtrosGenerales=supervision?.filtros
  const filtros=useMemo(()=>filtrosGenerales?{...filtrosLocal,...filtrosGenerales,modulo:moduloValido(filtrosLocal.modulo,filtrosGenerales.area)}:filtrosLocal,[filtrosLocal,filtrosGenerales])
  const claveFiltro=JSON.stringify(filtros),pagina=navegacion.clave===claveFiltro?navegacion.pagina:1
  const setPagina=(valor:number|((n:number)=>number))=>setNavegacion({clave:claveFiltro,pagina:typeof valor==='function'?valor(pagina):valor})
  const setBorrador=(f:FiltrosRevision)=>{setBorradorLocal(f);if(supervision)supervision.onBorrador({desde:f.desde,hasta:f.hasta,area:f.area as FiltrosPlanta['area'],turno:f.turno as FiltrosPlanta['turno']})}
  const contexto=!!area||!!supervision
  const areaModulos=supervision?borrador.area:area
  const clave=JSON.stringify([cuenta,filtros,pagina,revision])
  const [vista,setVista]=useState<{clave:string;filas:CapturaRevision[];mas:boolean;error:string|null;cargando:boolean}|null>(null)
  const [editor,setEditor]=useState<{captura:CapturaRevision;accion:'ver'|'corregir'|'anular';campos:Record<string,string>;motivo:string}|null>(null)
  const [operacion,setOperacion]=useState<{cuenta:string;error:string|null;mensaje:string|null;guardando:boolean}|null>(null)
  const guardandoRef=useRef(false),editorRef=useRef<HTMLElement>(null)
  const estado=operacion?.cuenta===cuenta?operacion:null,pendiente=cuenta?pendienteRevision(cuenta):null,bloqueado=!!estado?.guardando||!!pendiente
  const actual=vista?.clave===clave?vista:{filas:[],mas:false,error:null,cargando:!!cuenta}
  useEffect(()=>{if(!cuenta)return;let vivo=true;const c=new AbortController();void consultarCapturasRevision(cuenta,filtros,pagina,c.signal).then(r=>{if(vivo)setVista({...r,clave,error:null,cargando:false})}).catch(e=>{if(vivo)setVista({clave,filas:[],mas:false,error:e instanceof Error?e.message:'Consulta no disponible.',cargando:false})});return()=>{vivo=false;c.abort()}},[cuenta,filtros,pagina,revision,clave])
  const claveEditor=editor?`${editor.captura.id}:${editor.accion}`:null
  useEffect(()=>{if(claveEditor)editorRef.current?.scrollIntoView({block:'start',behavior:'smooth'})},[claveEditor])
  function abrir(captura:CapturaRevision,accion:'ver'|'corregir'|'anular'){setEditor({captura,accion,campos:datosEdicionRevision(captura),motivo:''})}
  function aplicar(){if(!cuenta)return;try{validarFiltrosRevision(borrador);setFiltros({...borrador});setPagina(1);supervision?.onConsultar();setRevision(n=>n+1);setOperacion({cuenta,error:null,mensaje:null,guardando:false})}catch(e){setOperacion({cuenta,error:e instanceof Error?e.message:'Revisa los filtros.',mensaje:null,guardando:false})}}
  async function enviar(s:SolicitudRevision){if(!cuenta||guardandoRef.current)return;guardandoRef.current=true;setOperacion({cuenta,error:null,mensaje:null,guardando:true});try{await guardarRevision(s);exigirAdminRevision(cuenta);setOperacion({cuenta,error:null,mensaje:s.accion==='anular'?'Anulación confirmada. El registro y su historial se conservan.':'Corrección confirmada. El motivo y los datos originales quedaron registrados.',guardando:false});setEditor(null);setRevision(n=>n+1)}catch(e){try{exigirAdminRevision(cuenta)}catch{return}setOperacion({cuenta,error:e instanceof Error?e.message:'No se confirmó el cambio.',mensaje:null,guardando:false})}finally{guardandoRef.current=false}}
  async function guardar(){if(!cuenta||!editor||editor.accion==='ver'||bloqueado)return;try{await enviar(prepararRevision(cuenta,editor.captura,editor.accion,editor.campos,editor.motivo))}catch(e){setOperacion({cuenta,error:e instanceof Error?e.message:'Revisa los datos.',mensaje:null,guardando:false})}}
  if(!cuenta)return null
  return <section className={`panel-informacion${supervision?' supervision-registros':''}`}>
    <div className="planta-encabezado"><div><h2>{contexto ? 'Registros' : 'Gestión de registros'}</h2></div><button className="boton-secundario" disabled={bloqueado||actual.cargando} type="button" onClick={()=>setRevision(n=>n+1)} data-actualizar="true" aria-label="Actualizar" title="Actualizar"><RefreshCw size={18} style={{ width: 18, height: 18, flexShrink: 0 }} aria-hidden="true" /></button></div>
    <form onSubmit={e=>{e.preventDefault();aplicar()}}><fieldset disabled={bloqueado} className={`admin-campos${supervision?' supervision-filtros-registros':''}`}>
      <label>Desde<input type="date" value={borrador.desde} onChange={e=>setBorrador({...borrador,desde:e.target.value})}/></label><label>Hasta<input type="date" value={borrador.hasta} onChange={e=>setBorrador({...borrador,hasta:e.target.value})}/></label>
      {!contexto && <label>Área<select value={borrador.area} onChange={e=>setBorrador({...borrador,area:e.target.value})}><option value="todas">Ambas áreas</option><option value="calderas">Calderas</option><option value="ptar">PTAR</option></select></label>}
      <label>Módulo<select value={borrador.modulo} onChange={e=>setBorrador({...borrador,modulo:e.target.value})}><option value="todos">Todos</option>{(areaModulos && areaModulos!=='todas' ? modulosPorArea[areaModulos as AreaOperativa].map(m=>[m,nombresRevision[m]]) : Object.entries(nombresRevision)).map(([m,n])=><option key={m} value={m}>{contexto && m==='calidad' ? 'Calidad de agua' : contexto && m==='ptar' ? 'Proceso PTAR' : n}</option>)}</select></label>
      <label>Turno<select value={borrador.turno} onChange={e=>setBorrador({...borrador,turno:e.target.value})}><option value="todos">Todos</option><option value="dia">Día</option><option value="tarde">Tarde</option><option value="noche">Noche</option></select></label>
      <label>Estado<select value={borrador.estado} onChange={e=>setBorrador({...borrador,estado:e.target.value})}><option value="vigentes">Vigentes</option><option value="anuladas">Anuladas</option><option value="todos">Ambos</option></select></label>
      <label>Operador<input type="search" maxLength={200} placeholder="Nombre o parte del nombre" value={borrador.operador} onChange={e=>setBorrador({...borrador,operador:e.target.value})}/></label>
      <button className="boton-principal" type="submit">Consultar</button>
    </fieldset></form>
    {contexto && filtros.modulo==='bitacora' && <p className="ayuda-turno">Bitácora conserva las observaciones históricas. Las mediciones y los reportes del formato actual están en Reportes técnicos.</p>}
    {actual.error&&<p role="alert" className="mensaje-error">{actual.error}</p>}{estado?.error&&<p role="alert" className="mensaje-error">{estado.error}</p>}{estado?.mensaje&&<p role="status" className="mensaje-exito">{estado.mensaje}</p>}
    {pendiente&&<div className="admin-pendiente"><strong>Cambio pendiente de confirmación</strong><p>Se conserva el mismo motivo y solicitud para evitar duplicados.</p><button type="button" className="boton-principal" disabled={!!estado?.guardando} onClick={()=>{void enviar(pendiente)}}>Comprobar / reintentar</button></div>}
    {editor&&<section ref={editorRef} className="admin-editor revision-editor"><div className="planta-encabezado"><div><h3>{editor.accion==='ver'?'Detalle':editor.accion==='anular'?'Anular':'Corregir'} · {nombresRevision[editor.captura.modulo]}</h3><p>{editor.captura.operador} · {editor.captura.turno.area==='calderas'?'Calderas':'PTAR'} · {editor.captura.turno.turno} · {fecha(editor.captura.turno.fecha_operativa)}</p><p className="ayuda-turno">Captura original: {hora(editor.captura.snapshot.registro.capturado_en)} · México</p></div><button type="button" className="boton-secundario" disabled={bloqueado} onClick={()=>setEditor(null)}>Cerrar detalle</button></div>
      {editor.accion==='anular'&&<p className="planta-aviso">El registro quedará excluido de las consultas e indicadores operativos vigentes. Se conservan las mediciones y el historial; esta pantalla no permite restaurarlo.</p>}
      {supervision&&editor.accion==='ver'&&editor.captura.snapshot.registro.eliminado_en===null&&<div className="acciones-turno supervision-acciones-detalle"><button type="button" className="boton-secundario" disabled={bloqueado} onClick={()=>abrir(editor.captura,'corregir')}>Corregir</button><button type="button" className="boton-secundario" disabled={bloqueado} onClick={()=>abrir(editor.captura,'anular')}>Anular</button></div>}
      {editor.accion==='ver' && <dl className="datos-turno">{Object.entries({consumo_pozo1:'Consumo Pozo 1 (m³)',consumo_pozo2:'Consumo Pozo 2 (m³)',alimentado:'Alimentado (m³)',aceptado:'Aceptado (m³)',rechazo:'Rechazo (m³)',rendimiento:'Rendimiento (%)',hora_muestra:'Hora de muestra'}).filter(([k])=>Object.hasOwn(editor.captura.snapshot.registro,k)).map(([k,n])=><div key={k}><dt>{n}</dt><dd>{mostrar(editor.captura.snapshot.registro[k])}</dd></div>)}</dl>}
      <form onSubmit={e=>{e.preventDefault();void guardar()}}><fieldset className="admin-campos" disabled={editor.accion!=='corregir'||bloqueado}>
        {camposRevision[editor.captura.modulo].map(f=><label key={f.clave}>{f.nombre}{f.texto?<textarea rows={f.clave==='texto'?5:2} maxLength={20000} value={editor.campos[f.clave]} onChange={e=>setEditor({...editor,campos:{...editor.campos,[f.clave]:e.target.value}})}/>:<input inputMode="decimal" type="text" required={!f.nullable} value={editor.campos[f.clave]} onChange={e=>setEditor({...editor,campos:{...editor.campos,[f.clave]:e.target.value}})}/>}</label>)}
        {editor.captura.snapshot.resultados.map(r=><label key={String(r.id)}>{resultadoNombre(editor.captura,r.id)}<input inputMode="decimal" required value={editor.campos[`resultado:${r.id}`]} onChange={e=>setEditor({...editor,campos:{...editor.campos,[`resultado:${r.id}`]:e.target.value}})}/><small>Límite original: {r.limite_min_aplicado===null&&r.limite_max_aplicado===null?'Sin límites':`${r.limite_min_aplicado===null?'':`Mín. ${r.limite_min_aplicado} `}${r.limite_max_aplicado===null?'':`Máx. ${r.limite_max_aplicado}`}`}</small>{editor.accion==='ver' && <small>{r.fuera_norma===true ? 'Fuera de norma' : r.fuera_norma===false ? 'Dentro de norma' : 'Sin evaluación registrada'}</small>}</label>)}
      </fieldset>
      {editor.accion!=='ver'&&<><div className="admin-campos"><label>Motivo obligatorio<textarea required rows={3} maxLength={4000} disabled={bloqueado} value={editor.motivo} onChange={e=>setEditor({...editor,motivo:e.target.value})}/></label></div><button className="boton-principal" type="submit" disabled={bloqueado}>{editor.accion==='anular'?'Confirmar anulación':'Guardar corrección'}</button></>}
      </form><HistorialRevision key={`${cuenta}:${editor.captura.id}:${revision}`} cuenta={cuenta} captura={editor.captura} revision={revision}/>
    </section>}
    <div className="planta-tabla-scroll"><table className="planta-tabla"><caption>Capturas por fecha operativa. Hasta 25 registros por página.</caption><thead><tr><th>{supervision?'Fecha y hora':'Fecha / captura'}</th><th>Área / turno</th><th>Operador</th><th>Módulo / resumen</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{actual.filas.map(c=><tr key={`${c.modulo}:${c.id}`}><td>{supervision?hora(c.snapshot.registro.capturado_en):fecha(c.turno.fecha_operativa)}<small>{supervision?`Operativa: ${fecha(c.turno.fecha_operativa)}`:hora(c.snapshot.registro.capturado_en)}</small></td><td>{c.turno.area==='calderas'?'Calderas':'PTAR'}<small>{c.turno.turno==='dia'?'Día':c.turno.turno==='tarde'?'Tarde':'Noche'}</small></td><td>{c.operador}</td><td><strong>{nombresRevision[c.modulo]}</strong><p className="planta-resumen-captura">{resumen(c)}</p></td><td><span className={supervision ? (c.snapshot.registro.eliminado_en===null?'supervision-estado':'supervision-estado supervision-anulado') : undefined}>{c.snapshot.registro.eliminado_en===null?'Vigente':'Anulada'}</span></td><td><div className="acciones-turno"><button type="button" className="boton-secundario" disabled={bloqueado||!!editor} onClick={()=>abrir(c,'ver')}>{supervision?'Ver':'Detalle'}</button>{!supervision&&c.snapshot.registro.eliminado_en===null&&<><button type="button" className="boton-secundario" disabled={bloqueado||!!editor} onClick={()=>abrir(c,'corregir')}>Corregir</button><button type="button" className="boton-secundario" disabled={bloqueado||!!editor} onClick={()=>abrir(c,'anular')}>Anular</button></>}</div></td></tr>)}</tbody></table></div>
    {!actual.filas.length&&!actual.error&&<p>{actual.cargando?'Consultando…':'No hay capturas que coincidan con los filtros.'}</p>}
    <div className="planta-paginacion"><button className="boton-secundario" type="button" disabled={pagina<=1||bloqueado||actual.cargando} onClick={()=>setPagina(n=>n-1)}>Anterior</button><span>Página {pagina}</span><button className="boton-secundario" type="button" disabled={!actual.mas||bloqueado||actual.cargando} onClick={()=>setPagina(n=>n+1)}>Siguiente</button></div>
  </section>
}
