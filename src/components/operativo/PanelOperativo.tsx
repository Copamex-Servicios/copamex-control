import './calderasReferencia.css'
import './operativoReferencia.css'
import './operativoCompacto.css'
import { PageHeader } from '../diseno/Elementos'
import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { ConsultaTurno } from '../turno/ConsultaTurno'
import { PanelBitacoraPTAR } from '../bitacora/PanelBitacoraPTAR'
import { PanelBitacoraCalderas } from '../bitacora/PanelBitacoraCalderas'
import { PanelPozos } from '../pozos/PanelPozos'
import { PanelUF } from '../uf/PanelUF'
import { PanelCalidad } from '../calidad/PanelCalidad'
import { PanelPTAR } from '../ptar/PanelPTAR'
import { EncabezadoOperativo } from './EncabezadoOperativo'
import { useInformacionDia } from '../../hooks/useInformacionDia'
import { useTurno } from '../../hooks/useTurno'
import { useBitacora } from '../../hooks/useBitacora'
import { usePozos } from '../../hooks/usePozos'
import { useUF } from '../../hooks/useUF'
import { useCalidad } from '../../hooks/useCalidad'
import { usePTAR } from '../../hooks/usePTAR'
import { useRelojServidor } from '../../hooks/useRelojServidor'
import type { AreaOperativa } from '../../lib/tiposTurno'
import type { RolUsuario } from '../../lib/tiposAuth'

export type ModuloOperativo = 'bitacora' | 'pozos' | 'uf' | 'calidad' | 'ptar'
interface Apartado { id: ModuloOperativo; nombre: string; simbolo: string }
const apartados: Apartado[] = [
  { id: 'bitacora', nombre: 'Bitácora', simbolo: '▤' },
  { id: 'pozos', nombre: 'Pozos', simbolo: '◉' },
  { id: 'uf', nombre: 'Ultrafiltración', simbolo: '≋' },
  { id: 'calidad', nombre: 'Calidad de agua', simbolo: '◇' },
  { id: 'ptar', nombre: 'PTAR', simbolo: '▥' },
]

function estadoModulo(datos: {
  estadoCarga: string; guardando: boolean; solicitudPendiente: unknown;
  lecturaActual: { turno?: { id: string }; turno_id?: string; lectura?: { turno_id: string } } | null;
  historial: { turno?: { id: string }; lectura?: { turno_id: string } }[];
}, turnoId: string | null) {
  if (datos.guardando) return { texto: 'Guardando', clase: 'ocupado', registrado: false }
  if (datos.solicitudPendiente) return { texto: 'Por confirmar', clase: 'pendiente', registrado: false }
  if (datos.estadoCarga === 'error') return { texto: 'Revisar consulta', clase: 'pendiente', registrado: false }
  if (datos.estadoCarga !== 'listo') return { texto: 'Consultando', clase: 'ocupado', registrado: false }
  if (!turnoId) return { texto: 'Ver historial', clase: 'neutro', registrado: false }
  const actual = datos.lecturaActual
  const registrado = actual?.turno_id === turnoId || actual?.turno?.id === turnoId
    || actual?.lectura?.turno_id === turnoId || datos.historial.some(r => r.turno?.id === turnoId || r.lectura?.turno_id === turnoId)
  return { texto: registrado ? 'Registrado' : 'Sin registros', clase: registrado ? 'registrado' : 'neutro', registrado }
}

export function PanelOperativo({ area, rol, seleccionExterna, alSeleccionar }: { area: AreaOperativa; rol: RolUsuario; seleccionExterna?: ModuloOperativo; alSeleccionar?: (modulo: ModuloOperativo) => void }) {
  const id = useId()
  const [seleccionInterna, setSeleccionInterna] = useState<ModuloOperativo>('bitacora')
  const seleccion = seleccionExterna ?? seleccionInterna
  const setSeleccion = alSeleccionar ?? setSeleccionInterna
  const turno = useTurno()
  const bitacora = useBitacora(area), pozos = usePozos(), uf = useUF(), calidad = useCalidad(area), ptar = usePTAR()
  const reloj = useRelojServidor()
  const opciones = apartados.filter(a => area === 'calderas' ? a.id !== 'ptar' : a.id !== 'pozos' && a.id !== 'uf')
  const actual = opciones.find(a => a.id === seleccion) ?? opciones[0]
  const destinoModulo = useRef<HTMLDivElement>(null)
  const moduloAnterior = useRef(actual.id)
  useEffect(() => {
    if (moduloAnterior.current === actual.id) return
    moduloAnterior.current = actual.id
    const destino = destinoModulo.current?.closest('.panel-operativo')?.querySelector<HTMLElement>('.co-encabezado-operativo') ?? destinoModulo.current
    if (!destino) return
    const barra = destino.closest('.co-layout')?.querySelector<HTMLElement>('.co-aviso-barra')
    const espacio = barra ? barra.getBoundingClientRect().height + 30 : 20
    const top = Math.max(0, destino.getBoundingClientRect().top + window.scrollY - espacio)
    window.scrollTo({ top, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [actual.id])
  const turnoId = turno.area === area && turno.turno?.finalizado_en === null ? turno.turno.id : null
  const datosModulos = { bitacora, pozos, uf, calidad, ptar }
  const estados = Object.fromEntries(opciones.map(a => [a.id, estadoModulo(datosModulos[a.id], turnoId)]))
  const registrados = opciones.filter(a => estados[a.id].registrado).length
  const fechaISO = reloj.fecha?.split('/').reverse().join('-') ?? null
  const informacionDia = useInformacionDia(area, fechaISO)
  function navegarTeclado(evento: KeyboardEvent<HTMLButtonElement>, indice: number) {
    let siguiente: number | null = null
    if (evento.key === 'ArrowRight') siguiente = (indice + 1) % opciones.length
    if (evento.key === 'ArrowLeft') siguiente = (indice - 1 + opciones.length) % opciones.length
    if (evento.key === 'Home') siguiente = 0
    if (evento.key === 'End') siguiente = opciones.length - 1
    if (siguiente === null) return
    evento.preventDefault()
    setSeleccion(opciones[siguiente].id)
    const botones = evento.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    botones?.[siguiente]?.focus()
  }
  return <div className="panel-operativo co-bitacora-referencia co-operativo-referencia">
    <div className="titulo-operativo">
      <div><PageHeader titulo={area === 'calderas' ? 'Calderas' : 'PTAR'} icono={area === 'calderas' ? 'calderas' : 'ptar'} /></div>

    </div>
    {rol !== 'admin' && <EncabezadoOperativo area={area} fecha={fechaISO} informacion={informacionDia} />}

    {rol === 'admin' && <div className="identificacion-jornada"><ConsultaTurno area={area} /></div>}
    {seleccionExterna !== undefined && <div className="co-calderas-summary"><span>{rol === 'admin' ? 'Consulta del área' : turno.estadoCarga === 'error' ? 'No se pudo consultar el turno' : turno.estadoCarga !== 'listo' ? 'Consultando turno…' : turnoId ? 'Turno abierto' : 'Sin turno abierto'}</span>{rol !== 'admin' && turnoId && <span>{registrados} de {opciones.length} apartados con registros</span>}<strong>{actual.nombre}</strong></div>}
    <div className="rejilla-operativa">
      <aside className="lateral-operativo" aria-label="Resumen de capturas del turno">
        {rol !== 'admin' && <section className="avance-jornada">
          <h2>Capturas del turno</h2>
          <p className="resumen-avance">{turnoId ? `${registrados} de ${opciones.length} apartados con registros` : 'Sin turno abierto'}</p>
          {turnoId && <div className="barra-avance" aria-hidden="true"><span style={{ width: `${registrados / opciones.length * 100}%` }} /></div>}
          <div className="lista-avance">{opciones.map(a => <button type="button" key={a.id} onClick={() => setSeleccion(a.id)}
            className={actual.id === a.id ? 'apartado-elegido' : ''} aria-label={`Abrir ${a.nombre}: ${estados[a.id].texto}`}>
            <span className={`punto-avance ${estados[a.id].clase}`} aria-hidden="true">{estados[a.id].registrado ? '✓' : '·'}</span>
            <span>{a.nombre}<small>{estados[a.id].texto}</small></span><span aria-hidden="true">›</span>
          </button>)}</div>
        </section>}
        {rol === 'admin' && <section className="avance-jornada">
          <p className="sobre-titulo">Supervisión</p><h2>Consulta por módulo</h2>

          <div className="lista-avance">{opciones.map(a => <button type="button" key={a.id} onClick={() => setSeleccion(a.id)}
            className={actual.id === a.id ? 'apartado-elegido' : ''}><span>{a.simbolo}</span><span>{a.nombre}</span><span>›</span></button>)}</div>
        </section>}
      </aside>
      <div className="captura-operativa" ref={destinoModulo}>
        {seleccionExterna === undefined && <div className="pestanas-modulos" role="tablist" aria-label="Módulos de PTAR">
          {opciones.map((a, indice) => <button type="button" key={a.id} role="tab" id={`${id}-tab-${a.id}`}
            aria-selected={actual.id === a.id} aria-controls={`${id}-panel-${a.id}`} tabIndex={actual.id === a.id ? 0 : -1}
            onClick={() => setSeleccion(a.id)} onKeyDown={e => navegarTeclado(e, indice)}>
            <span className="simbolo-modulo" aria-hidden="true">{a.simbolo}</span>{a.nombre}
            {rol !== 'admin' && (estados[a.id].clase === 'pendiente' || estados[a.id].registrado) && <span
              className={`marca-modulo ${estados[a.id].clase}`} aria-label={estados[a.id].texto}>{estados[a.id].registrado ? '✓' : '!'}</span>}
          </button>)}
        </div>}

        {opciones.map(a => <div key={a.id} id={`${id}-panel-${a.id}`} role={seleccionExterna !== undefined ? 'region' : 'tabpanel'} aria-label={seleccionExterna !== undefined ? a.nombre : undefined} aria-labelledby={seleccionExterna !== undefined ? undefined : `${id}-tab-${a.id}`}
          hidden={actual.id !== a.id} tabIndex={0} className="contenido-modulo">
          {a.id === 'bitacora' && (area === 'calderas' ? <PanelBitacoraCalderas /> : <PanelBitacoraPTAR />)}
          {a.id === 'pozos' && <PanelPozos />}
          {a.id === 'uf' && <PanelUF />}
          {a.id === 'calidad' && <PanelCalidad area={area} horaServidor={reloj.hora} />}
          {a.id === 'ptar' && <PanelPTAR />}
        </div>)}
      </div>
    </div>
  </div>
}
