import { useEffect, useRef, useState } from 'react'
import { consultarPendientesTecnicos } from '../../lib/reporteOperativo'
import type { PendienteTecnico } from '../../lib/reporteOperativo'
import type { FiltrosPlanta } from '../../lib/planta'
import { nombresTurno } from '../../lib/planta'
import type { FilaTecnicaAdmin } from '../../lib/revisionTecnica'
import { borradorBitacoraCalderas } from '../../lib/tiposBitacoraCalderas'
import { borradorBitacoraPTAR } from '../../lib/tiposBitacoraPTAR'
import { enviarReporteCalderas, prepararDatosCalderas } from '../../lib/bitacoraTecnicaCalderas'
import type { EnvioReporteCalderas } from '../../lib/bitacoraTecnicaCalderas'
import { enviarReportePTAR, prepararDatosPTAR } from '../../lib/bitacoraTecnicaPTAR'
import type { EnvioReportePTAR } from '../../lib/bitacoraTecnicaPTAR'
import { FormularioBitacoraCalderas } from '../bitacora/FormularioBitacoraCalderas'
import { FormularioBitacoraPTAR } from '../bitacora/FormularioBitacoraPTAR'
import './pendientesTecnicos.css'

export function PendientesTecnicos({ cuenta, filtros, corregir, actualizar }: { cuenta: string; filtros: FiltrosPlanta; corregir: (f: FilaTecnicaAdmin) => void; actualizar: () => void }) {
  const [pagina, setPagina] = useState(0), [intento, setIntento] = useState(0)
  const [vista, setVista] = useState<{ clave: string; datos: Awaited<ReturnType<typeof consultarPendientesTecnicos>>; error: string | null } | null>(null)
  const [elegido, setElegido] = useState<PendienteTecnico | null>(null)
  const clave = JSON.stringify([cuenta,filtros,pagina,intento])
  useEffect(() => {
    let vivo = true; const control = new AbortController(), limite = window.setTimeout(() => control.abort(), 20000)
    void consultarPendientesTecnicos(cuenta,filtros,pagina,control.signal).then(datos => { if (vivo) setVista({ clave,datos,error:null }) })
      .catch(e => { if (vivo) setVista({ clave,datos:null,error:e instanceof Error ? e.message : 'Consulta no disponible.' }) })
      .finally(() => window.clearTimeout(limite))
    return () => { vivo=false; control.abort(); window.clearTimeout(limite) }
  },[cuenta,filtros,pagina,clave])
  const actual = vista?.clave === clave ? vista : null
  if (actual && !actual.error && !actual.datos) return null
  return <section className="panel-informacion pendientes-tecnicos">
    <div className="pendientes-encabezado">
      <h2>Reportes cerrados con pendientes</h2>
      {!elegido && actual?.datos && !actual.error && <span className="pendientes-contador">{actual.datos.filas.length}{actual.datos.mas ? '+' : ''} {actual.datos.filas.length === 1 && !actual.datos.mas ? 'reporte' : 'reportes'}{pagina > 0 ? ' en esta página' : ''}</span>}
    </div>
    {elegido ? <CompletarPendiente key={elegido.turno_id} cuenta={cuenta} turno={elegido} cerrar={() => { setElegido(null); actualizar() }} /> : <>
      {!actual ? <p role="status">Consultando pendientes…</p> : actual.error ? <p role="alert">{actual.error}</p> : !actual.datos?.filas.length ? <p>Sin reportes pendientes en este período.</p> : actual.datos.filas.map(t =>
        <div className="pendientes-fila" key={t.turno_id}>
          <div className="pendientes-fecha"><strong>{t.fecha_operativa.split('-').reverse().join('/')}</strong><span>{nombresTurno[t.turno]}</span></div>
          <strong className="pendientes-area">{t.area === 'ptar' ? 'PTAR' : 'Calderas'}</strong>
          <span className="pendientes-operadores">{t.operador}{t.operador_acompanante ? ' · '+t.operador_acompanante : ''}</span>
          <span className="pendientes-estado">Cerrado con pendientes</span>
          <button type="button" className="boton-secundario" onClick={() => {
            if (t.reporte_id) corregir({ id:t.reporte_id,turnoId:t.turno_id,area:t.area,fechaOperativa:t.fecha_operativa,turno:t.turno,
              operador:t.operador+(t.operador_acompanante ? ' · '+t.operador_acompanante : ''),revision:t.revision!,creadoEn:t.creado_en! })
            else setElegido(t)
          }}>Completar</button></div>)}
      <nav className="pendientes-paginacion" aria-label="Páginas de pendientes técnicos">
        <button type="button" className="boton-secundario" disabled={!actual || pagina===0} onClick={() => setPagina(n => n-1)}>Anterior</button>
        <button type="button" className="boton-secundario" disabled={!actual?.datos?.mas} onClick={() => setPagina(n => n+1)}>Siguiente</button>
        {actual?.error && <button type="button" className="boton-secundario" onClick={() => setIntento(n => n+1)}>Reintentar</button>}
      </nav>
    </>}
  </section>
}
export function CompletarPendiente({ cuenta, turno, cerrar }: { cuenta: string; turno: PendienteTecnico; cerrar: () => void }) {
  const [borrador,setBorrador] = useState(() => turno.area==='calderas' ? borradorBitacoraCalderas() : borradorBitacoraPTAR())
  const [guardando,setGuardando] = useState(false), [mensaje,setMensaje] = useState<string | null>(null)
  const [confirmado,setConfirmado] = useState(false), [incierto,setIncierto] = useState(false)
  const pendiente = useRef<{ area:'calderas'; envio:EnvioReporteCalderas } | { area:'ptar'; envio:EnvioReportePTAR } | null>(null)
  const ocupado = useRef(false)
  const peticion = useRef<AbortController | null>(null)
  useEffect(() => () => peticion.current?.abort(), [])
  async function guardar() {
    if (ocupado.current || confirmado) return
    ocupado.current=true; setGuardando(true);setMensaje(null)
    const control = new AbortController(); peticion.current = control
    const limite = window.setTimeout(() => control.abort(), 25000)
    try {
      if (!pendiente.current) pendiente.current = 'equipos' in borrador
        ? { area:'calderas',envio:{ id:crypto.randomUUID(),turnoId:turno.turno_id,cuentaId:cuenta,operativo:true,supervisor:true,datos:prepararDatosCalderas(borrador) } }
        : { area:'ptar',envio:{ id:crypto.randomUUID(),turnoId:turno.turno_id,cuentaId:cuenta,operativo:true,supervisor:true,datos:prepararDatosPTAR(borrador) } }
      const p=pendiente.current
      if (p.area==='calderas') await enviarReporteCalderas(p.envio,control.signal)
      else await enviarReportePTAR(p.envio,control.signal)
      pendiente.current=null;setIncierto(false);setConfirmado(true);setMensaje('Reporte completado por supervisión. Se conservan el turno y la fecha originales.')
    } catch(e) {
      const desconocido=!!pendiente.current && (!(e instanceof Error) || !('incierto' in e) || !!e.incierto)
      if (!desconocido) pendiente.current=null
      setIncierto(desconocido);setMensaje(e instanceof Error ? e.message : 'No se confirmó el guardado. Reintenta la misma solicitud.')
    } finally { window.clearTimeout(limite);peticion.current=null;ocupado.current=false;setGuardando(false) }
  }
  const editable=!guardando && !incierto && !confirmado
  return <div aria-busy={guardando || incierto}><p>{turno.fecha_operativa.split('-').reverse().join('/')} · {turno.area === 'ptar' ? 'PTAR' : 'Calderas'} · {nombresTurno[turno.turno]}</p>
    {'equipos' in borrador ? <div className="bc-panel"><FormularioBitacoraCalderas captura={{ borrador,reporte:null,editable,unidadPresion:'kg/cm²',
      cambiarBorrador: cambiar => { if(editable) setBorrador(b => 'equipos' in b ? cambiar(b) : b) } }} observaciones={null} nombresOperadores={turno.operador_acompanante ? [turno.operador, turno.operador_acompanante] : undefined} /></div>
      : <div className="bpt-panel"><FormularioBitacoraPTAR captura={{ borrador,reporte:null,editable,
        cambiarBorrador: cambiar => { if(editable) setBorrador(b => 'bombas' in b ? cambiar(b) : b) } }} observaciones={null} nombresOperadores={turno.operador_acompanante ? [turno.operador, turno.operador_acompanante] : undefined} /></div>}
    {mensaje && <p role={confirmado ? 'status' : 'alert'}>{mensaje}</p>}
    <button type="button" className="boton-secundario" disabled={guardando || incierto} onClick={cerrar}>Cerrar</button>
    {!confirmado && <button type="button" className="boton-primario" disabled={guardando} onClick={() => { void guardar() }}>{guardando ? 'Guardando…' : incierto ? 'Reintentar envío original' : 'Guardar reporte completo'}</button>}
  </div>
}

