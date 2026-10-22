import { RefreshCw } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import type { useInformacionDia } from '../../hooks/useInformacionDia'
import type { EventoDia } from '../../lib/informacionDia'

function fechaCorta(fecha: string) {
  const [anio, mes, dia] = fecha.split('-')
  return `${dia}/${mes}/${anio}`
}

function Evento({ evento, fecha, compacto = false }: { evento: EventoDia; fecha: string | null; compacto?: boolean }) {
  const hoy = evento.fecha === fecha
  if (compacto) return <article className={`resumen-dia-evento co-evento-ficha${hoy ? ' evento-hoy' : ''}`}>
    <time className="co-evento-fecha" dateTime={evento.fecha} aria-label={fechaCorta(evento.fecha)}>
      <strong>{evento.fecha.slice(8, 10)}</strong>
      <span>{new Intl.DateTimeFormat('es-MX', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${evento.fecha}T12:00:00Z`))}</span>
    </time>
    <div className="co-evento-datos">
      <div className="resumen-dia-evento-fecha">{evento.horario && <span>{evento.horario}</span>}{hoy && <span className="resumen-dia-hoy">Hoy</span>}</div>
      <strong>{evento.tipo.replaceAll('_', ' ')}</strong>
      {evento.motivo && <p>{evento.motivo}</p>}
    </div>
  </article>
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

function CarruselEventos({ eventos, fecha }: { eventos: readonly EventoDia[]; fecha: string | null }) {
  const [seleccion, setSeleccion] = useState<{ indice: number; anterior: number | null; paso: number }>({ indice:0, anterior:null, paso:0 })
  const [sobre, setSobre] = useState(false)
  const [foco, setFoco] = useState(false)
  const [reducido, setReducido] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const preferencia = window.matchMedia('(prefers-reduced-motion: reduce)')
    const cambiar = () => setReducido(preferencia.matches)
    preferencia.addEventListener('change', cambiar)
    return () => preferencia.removeEventListener('change', cambiar)
  }, [])
  useEffect(() => {
    if (eventos.length < 2 || sobre || foco || reducido) return
    const intervalo = window.setInterval(() => setSeleccion(s => ({ indice:(s.indice + 1) % eventos.length, anterior:s.indice, paso:s.paso + 1 })), 5000)
    return () => window.clearInterval(intervalo)
  }, [eventos.length, sobre, foco, reducido])
  const mover = (direccion: number) => setSeleccion(s => ({ indice:(s.indice + direccion + eventos.length) % eventos.length, anterior:s.indice, paso:s.paso + 1 }))
  const animar = seleccion.anterior !== null && !reducido
  if (reducido) return <div className="co-eventos-contenido">{eventos.map(evento => <Evento key={evento.id} evento={evento} fecha={fecha} compacto />)}</div>
  return <div className="co-eventos-carrusel" role="region" aria-roledescription="carrusel" aria-label="Eventos programados"
    tabIndex={eventos.length > 1 ? 0 : undefined} aria-keyshortcuts="ArrowLeft ArrowRight"
    onKeyDown={e => { if (eventos.length > 1 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); mover(e.key === 'ArrowRight' ? 1 : -1) } }}
    onMouseEnter={() => setSobre(true)} onMouseLeave={() => setSobre(false)}
    onFocusCapture={() => setFoco(true)} onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget)) setFoco(false) }}>
    <div className="co-eventos-ventana" aria-live={foco ? 'polite' : 'off'}>
      <div key={seleccion.paso} className={`co-eventos-pista${animar ? ' co-eventos-deslizar' : ''}`}>
        {animar && <div className="co-eventos-diapositiva" aria-hidden="true" inert><Evento evento={eventos[seleccion.anterior!]} fecha={fecha} compacto /></div>}
        <div className="co-eventos-diapositiva" role="group" aria-roledescription="diapositiva" aria-label={`${seleccion.indice + 1} de ${eventos.length}`}>
          <Evento evento={eventos[seleccion.indice]} fecha={fecha} compacto />
        </div>
      </div>
    </div>
  </div>
}

export function InformacionDelDia({ fecha, informacion, compacto = false }: {
  compacto?: boolean
  fecha: string | null; informacion: ReturnType<typeof useInformacionDia>
}) {
  const idEventos = useId()
  const [verTodos, setVerTodos] = useState(false)
  const { datos, cargando, actualizar } = informacion
  const eventos = datos?.eventos.elementos ?? []
  const expandido = verTodos && eventos.length > 0
  const deHoy = eventos.filter(e => e.fecha === fecha)
  const destacados = deHoy.length ? deHoy : eventos.slice(0, 1)
  const otros = eventos.filter(e => !destacados.some(d => d.id === e.id))
  return <div className={compacto ? "resumen-dia co-encabezado-datos" : "resumen-dia"}>
    <section className="resumen-dia-tarjeta" aria-label="Producción de hoy">
      <div className="resumen-dia-cabecera">
        <h2>Producción de hoy</h2>
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
      <div className="resumen-dia-cabecera"><h2>Próximos eventos</h2>
        {compacto && fecha && datos && !datos.eventos.error && <button type="button" className="co-eventos-total"
          disabled={!eventos.length} aria-expanded={expandido} aria-controls={idEventos}
          aria-label={expandido ? 'Volver al carrusel de eventos' : `Mostrar los ${eventos.length} eventos programados`}
          title={expandido ? 'Volver al carrusel' : 'Ver todos los eventos'} onClick={() => setVerTodos(v => !v)}>
          {eventos.length} {eventos.length === 1 ? 'evento' : 'eventos'}</button>}
      </div>
      {!fecha ? <p className="resumen-dia-vacio">Esperando fecha del servidor…</p>
        : !datos ? <p className="resumen-dia-vacio" role="status">Consultando…</p>
        : datos.eventos.error ? <p className="error-lateral" role="alert">No se pudieron consultar los eventos. Usa Actualizar.</p>
        : !eventos.length ? <p className="resumen-dia-vacio">Sin eventos programados.</p>
        : compacto ? <div id={idEventos}>{expandido
          ? <div className="co-eventos-lista" role="region" aria-label="Todos los eventos consultados" tabIndex={0}>
            {eventos.map(evento => <Evento key={evento.id} evento={evento} fecha={fecha} compacto />)}</div>
          : <CarruselEventos key={eventos.map(e => e.id).join(':')} eventos={eventos} fecha={fecha} />}</div>
        : <div>{destacados.map(e => <Evento key={e.id} evento={e} fecha={fecha} />)}
          {otros.length > 0 && <details className="resumen-dia-otros"><summary>Otros eventos ({otros.length})</summary>
            {otros.map(e => <Evento key={e.id} evento={e} fecha={fecha} compacto={compacto} />)}</details>}
        </div>}
    </section>
  </div>
}
