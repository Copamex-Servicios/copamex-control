import { Icono } from '../diseno/Icono'
import { CalendarDays, Factory, RefreshCw } from 'lucide-react'
import type { useInformacionDia } from '../../hooks/useInformacionDia'
import type { EventoDia } from '../../lib/informacionDia'

function fechaCorta(fecha: string) {
  const [anio, mes, dia] = fecha.split('-')
  return `${dia}/${mes}/${anio}`
}

function Evento({ evento, fecha }: { evento: EventoDia; fecha: string | null }) {
  const hoy = evento.fecha === fecha
  return <article className={`resumen-dia-evento${hoy ? ' evento-hoy' : ''}`}>
    <div className="resumen-dia-evento-fecha">
      <time dateTime={evento.fecha}>{fechaCorta(evento.fecha)}</time>
      {hoy && <span className="resumen-dia-hoy">Hoy</span>}
      {evento.horario && <span>{evento.horario}</span>}
    </div>
    <strong>{evento.tipo.replaceAll('_', ' ')}</strong>
    {evento.motivo && <p>{evento.motivo}</p>}
  </article>
}

export function InformacionDelDia({ fecha, informacion, compacto = false }: {
  compacto?: boolean
  fecha: string | null; informacion: ReturnType<typeof useInformacionDia>
}) {
  const { datos, cargando, actualizar } = informacion
  const eventos = datos?.eventos.elementos ?? []
  const deHoy = eventos.filter(e => e.fecha === fecha)
  const destacados = deHoy.length ? deHoy : eventos.slice(0, 1)
  const otros = eventos.filter(e => !destacados.some(d => d.id === e.id))
  return <div className={compacto ? "resumen-dia co-encabezado-datos" : "resumen-dia"}>
    <section className="resumen-dia-tarjeta" aria-label="Producción de hoy">
      <span className="co-dia-icono" aria-hidden="true"><Icono nombre="calderas" /></span>
      <div className="resumen-dia-cabecera">
        <h2>{compacto ? <Factory aria-hidden="true" /> : <Icono nombre="calderas" />}Producción de hoy</h2>
        <button className="boton-icono" type="button" onClick={actualizar}
          disabled={!fecha || cargando} aria-label="Actualizar producción y eventos">{compacto ? <RefreshCw aria-hidden="true" /> : <span aria-hidden="true">↻</span>}</button>
      </div>
      {!fecha ? <p className="resumen-dia-vacio">Esperando fecha del servidor…</p>
        : !datos ? <p className="resumen-dia-vacio" role="status">Consultando…</p>
        : datos.produccion.error ? <p className="error-lateral" role="alert">No se pudo consultar la producción. Usa Actualizar.</p>
        : !datos.produccion.elementos.length ? <p className="resumen-dia-vacio">Sin producción programada.</p>
        : <div className="resumen-dia-produccion">{datos.produccion.elementos.map(p => <article className="resumen-dia-programa" key={p.id}>
          <div className="resumen-dia-papel"><span className="resumen-dia-maquina">{p.maquina}</span><strong>{p.papel}</strong></div>
          <dl><div><dt>Color requerido</dt><dd>{p.color ?? 'Sin definir'}</dd></div>
            <div><dt>Consumo objetivo</dt><dd>{p.consumo ?? 'Sin definir'}</dd></div></dl>
        </article>)}</div>}
    </section>
    <section className="resumen-dia-tarjeta" aria-label="Próximos eventos del área">
      <span className="co-dia-icono" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M8 3v4m8-4v4M4 10h16" /></svg></span>
      <div className="resumen-dia-cabecera"><h2>{compacto ? <CalendarDays aria-hidden="true" /> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M8 3v4m8-4v4M4 10h16" /></svg>}Próximos eventos</h2></div>
      {!fecha ? <p className="resumen-dia-vacio">Esperando fecha del servidor…</p>
        : !datos ? <p className="resumen-dia-vacio" role="status">Consultando…</p>
        : datos.eventos.error ? <p className="error-lateral" role="alert">No se pudieron consultar los eventos. Usa Actualizar.</p>
        : !eventos.length ? <p className="resumen-dia-vacio">Sin eventos programados.</p>
        : <div className={compacto ? "co-eventos-contenido" : undefined}>{destacados.map(e => <Evento key={e.id} evento={e} fecha={fecha} />)}
          {otros.length > 0 && <details className="resumen-dia-otros"><summary>Otros eventos ({otros.length})</summary>
            {otros.map(e => <Evento key={e.id} evento={e} fecha={fecha} />)}</details>}
        </div>}
    </section>
  </div>
}
