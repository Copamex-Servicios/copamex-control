import { useEffect, useId, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { consultarTurnos, filtrosInicialesPlanta, nombresTurno, validarFiltrosPlanta } from '../../lib/planta'
import type { FiltrosPlanta } from '../../lib/planta'
import type { AreaOperativa } from '../../lib/tiposTurno'
import { consultarCapturasRevision } from '../../lib/revisionCapturas'
import { consultarResumenesTecnicosPlanta } from '../../lib/reportesTecnicosPlanta'
import { MonitorConcesionPozos } from '../pozos/MonitorConcesionPozos'
import { TablaReportesSupervision } from './TablaReportesSupervision'
import './supervisionPlanta.css'

const pestanas = { resumen: 'Resumen', tecnicos: 'Reportes técnicos' } as const
type Pestana = keyof typeof pestanas
const areasSupervision = (area: FiltrosPlanta['area']): AreaOperativa[] => area === 'todas' ? ['calderas', 'ptar'] : [area]
const nombreAreaSupervision = (area: AreaOperativa) => area === 'calderas' ? 'Calderas' : 'PTAR'
const horaSupervision = (v: string) => new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'short', timeStyle: 'short' }).format(new Date(v))

export function PanelSupervisionPlanta() {
  const { perfil, sesion, estado } = useAuth()
  const id = useId()
  const [filtros, setFiltros] = useState(filtrosInicialesPlanta)
  const [borrador, setBorrador] = useState(filtros)
  const [error, setError] = useState<string | null>(null)
  const [pestana, setPestana] = useState<Pestana>('resumen')
  const [abiertas, setAbiertas] = useState<Pestana[]>(['resumen'])
  const [revision, setRevision] = useState(0)
  const consultar = () => {
    try { validarFiltrosPlanta(borrador); setFiltros({ ...borrador }); setRevision(n => n + 1); setError(null) }
    catch (e) { setError(e instanceof Error ? e.message : 'Revisa los filtros.') }
  }
  function elegir(p: Pestana) { setPestana(p); setAbiertas(v => v.includes(p) ? v : [...v, p]) }
  if (estado !== 'autenticado' || !perfil?.activo || perfil.rol !== 'admin' || perfil.id !== sesion?.user.id) return null
  return <div className="planta-admin">
    <section className="panel-informacion supervision-selector">
      <h2>Supervisión de la operación</h2>
      <form className="supervision-periodo" onSubmit={e => { e.preventDefault(); consultar() }}>
        <label>Área<select value={borrador.area} onChange={e => {
          const area = e.target.value as FiltrosPlanta['area']
          setBorrador(f => ({ ...f, area })); setFiltros(f => ({ ...f, area }))
        }}><option value="todas">Ambos</option><option value="calderas">Calderas</option><option value="ptar">PTAR</option></select></label>
        <>
          <label>Desde<input type="date" required value={borrador.desde} onChange={e => setBorrador({ ...borrador, desde: e.target.value })} /></label>
          <label>Hasta<input type="date" required value={borrador.hasta} onChange={e => setBorrador({ ...borrador, hasta: e.target.value })} /></label>
          <label>Turno<select value={borrador.turno} onChange={e => setBorrador({ ...borrador, turno: e.target.value as FiltrosPlanta['turno'] })}><option value="todos">Todos</option>{Object.entries(nombresTurno).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>
          <button type="submit" className="boton-principal">Consultar período</button>
        </>
      </form>
      {error && <p role="alert" className="mensaje-error">{error}</p>}
    </section>
    <div className="supervision-tabs" role="tablist" aria-label="Supervisión de la operación">
      {Object.entries(pestanas).map(([p, nombre], indice) => <button key={p} type="button" role="tab"
        id={`${id}-${p}-tab`} aria-controls={`${id}-${p}`} aria-selected={pestana === p} tabIndex={pestana === p ? 0 : -1}
        onClick={() => elegir(p as Pestana)} onKeyDown={e => {
          const claves = Object.keys(pestanas) as Pestana[]
          const siguiente = e.key === 'ArrowRight' ? (indice + 1) % claves.length : e.key === 'ArrowLeft' ? (indice + claves.length - 1) % claves.length : e.key === 'Home' ? 0 : e.key === 'End' ? claves.length - 1 : null
          if (siguiente === null) return
          e.preventDefault(); elegir(claves[siguiente]); e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[siguiente]?.focus()
        }}>{nombre}</button>)}
    </div>
    {abiertas.map(p => <div key={`${perfil.id}:${p}`} id={`${id}-${p}`} role="tabpanel" aria-labelledby={`${id}-${p}-tab`} hidden={pestana !== p}>
      {p === 'resumen' ? <ResumenSupervision filtros={filtros} cuenta={perfil.id} revision={revision} />
        : <TablaReportesSupervision filtros={filtros} revision={revision} />}
    </div>)}
  </div>
}

type Conteo = { numero: number; limitado: boolean }
type ResumenArea = { area: AreaOperativa; turnos: Conteo | null; capturas: number | null; tecnicos: number | null; ultima: string | null }
async function consultarResumenArea(area: AreaOperativa, cuenta: string, filtros: FiltrosPlanta, signal: AbortSignal): Promise<ResumenArea> {
  const f = { ...filtros, area }
  // Recorre las páginas de las consultas existentes; nunca usa el tamaño de una página como total.
  const [turnos, capturas, tecnicos] = await Promise.allSettled([
    consultarTurnos(f, signal),
    (async () => {
      let pagina = 1, ultima: string | null = null
      const ids = new Set<string>()
      while (true) {
        signal.throwIfAborted()
        const r = await consultarCapturasRevision(cuenta, { ...f, modulo: 'todos', estado: 'vigentes', operador: '' }, pagina++, signal)
        for (const c of r.filas) {
          const id = `${c.modulo}:${c.id}`
          if (ids.has(id)) throw new Error('Las capturas cambiaron. Actualiza el resumen.')
          ids.add(id)
          const instante = String(c.snapshot.registro.capturado_en)
          if (!ultima || Date.parse(instante) > Date.parse(ultima)) ultima = instante
        }
        if (!r.mas) return { numero: ids.size, ultima }
        if (!r.filas.length) throw new Error('Consulta incompleta.')
      }
    })(),
    (async () => {
      let pagina = 0, ultima: string | null = null
      const ids = new Set<string>()
      while (true) {
        signal.throwIfAborted()
        const r = await consultarResumenesTecnicosPlanta(area, f, pagina++, signal)
        for (const t of r.filas) {
          if (ids.has(t.id)) throw new Error('Los reportes cambiaron. Actualiza el resumen.')
          ids.add(t.id)
          if (!ultima || Date.parse(t.creadoEn) > Date.parse(ultima)) ultima = t.creadoEn
        }
        if (!r.hayMas) return { numero: ids.size, ultima }
        if (!r.filas.length) throw new Error('Consulta incompleta.')
      }
    })(),
  ])
  const fechas = [capturas.status === 'fulfilled' ? capturas.value.ultima : null, tecnicos.status === 'fulfilled' ? tecnicos.value.ultima : null].filter((v): v is string => !!v).sort((a,b) => Date.parse(a)-Date.parse(b))
  return { area,
    turnos: turnos.status === 'fulfilled' && !turnos.value.error ? { numero: turnos.value.elementos.length, limitado: turnos.value.incompleta } : null,
    capturas: capturas.status === 'fulfilled' ? capturas.value.numero : null,
    tecnicos: tecnicos.status === 'fulfilled' ? tecnicos.value.numero : null,
    ultima: capturas.status === 'fulfilled' && tecnicos.status === 'fulfilled' ? fechas.at(-1) ?? null : null,
  }
}
function ResumenSupervision({ filtros, cuenta, revision }: { filtros: FiltrosPlanta; cuenta: string; revision: number }) {
  const [recarga, setRecarga] = useState(0)
  const clave = JSON.stringify([filtros, cuenta, revision, recarga])
  const [vista, setVista] = useState<{ clave: string; filas: ResumenArea[] } | null>(null)
  useEffect(() => {
    let vivo = true
    const c = new AbortController(), limite = window.setTimeout(() => c.abort(), 20000)
    void Promise.all(areasSupervision(filtros.area).map(a => consultarResumenArea(a, cuenta, filtros, c.signal)))
      .then(filas => { if (vivo) setVista({ clave, filas }) }).finally(() => window.clearTimeout(limite))
    return () => { vivo = false; c.abort(); window.clearTimeout(limite) }
  }, [clave, cuenta, filtros])
  const filas = vista?.clave === clave ? vista.filas : null
  return <div className="supervision-resumen">

    <section className="panel-informacion">
      <div className="planta-encabezado"><h2>Resumen por área</h2><button type="button" className="boton-secundario" disabled={!filas} onClick={() => setRecarga(n => n + 1)}>Actualizar resumen</button></div>
      <div className="planta-tabla-scroll"><table className="planta-tabla supervision-tabla-resumen"><thead><tr><th>Área</th><th>Turnos registrados</th><th>Capturas vigentes</th><th>Reportes técnicos</th><th>Última captura</th></tr></thead>
        <tbody>{areasSupervision(filtros.area).map(area => { const f = filas?.find(r => r.area === area); return <tr key={area}><th scope="row">{nombreAreaSupervision(area)}</th><td>{!f ? '…' : f.turnos ? `${f.turnos.numero}${f.turnos.limitado ? '+' : ''}` : 'No disponible'}</td><td>{!f ? '…' : f.capturas ?? 'No disponible'}</td><td>{!f ? '…' : f.tecnicos ?? 'No disponible'}</td><td>{!f ? '…' : f.ultima ? horaSupervision(f.ultima) : f.capturas === null || f.tecnicos === null ? 'No disponible' : 'Sin capturas'}</td></tr> })}</tbody>
      </table></div>
      {filas?.some(f => f.turnos?.limitado) && <p className="ayuda-turno">+ indica el límite de 250 turnos por área. Reduce el período para obtener el total exacto.</p>}
      {filas?.some(f => f.capturas === null || f.tecnicos === null || !f.turnos) && <p role="alert" className="mensaje-error">Hay consultas no disponibles. Actualiza el resumen para reintentar.</p>}
    </section>
    {filtros.area !== 'ptar' && <div className="panel-informacion supervision-monitor"><MonitorConcesionPozos revision={revision + recarga} supervision /></div>}
  </div>
}
