import { useId } from 'react'
import './reportesOperadores.css'
import { useTurnoStore } from '../../stores/turnoStore'
import { mayusculasNota } from '../../lib/notasOperativas'
import { resumenReportesIndividuales } from '../../lib/reportesIndividuales'
import type { ReportesIndividuales } from '../../lib/reportesIndividuales'
import type { AreaOperativa } from '../../lib/tiposTurno'

interface Props {
  area: AreaOperativa
  texto: string
  reportes?: ReportesIndividuales
  nombres?: readonly string[]
  historico: boolean
  habilitado: boolean
  obligatorio: boolean
  cambiar: (texto: string, reportes?: ReportesIndividuales) => void
}

export function ReportesRelevantesOperadores({ area, texto, reportes, nombres, historico, habilitado, obligatorio, cambiar }: Props) {
  const id = useId()
  const turno = useTurnoStore()
  const nombresTurno = turno.area === area && turno.turno
    ? [turno.turno.operador_id, turno.turno.operador_acompanante_id]
      .map(operador => turno.operadores.find(o => o.id === operador)?.nombre).filter((n): n is string => !!n) : []
  const disponibles = nombres ?? nombresTurno
  const individuales: ReportesIndividuales | undefined = reportes ?? (!historico && disponibles.length === 2
    ? [{ nombre: disponibles[0], comentario: '' }, { nombre: disponibles[1], comentario: '' }] : undefined)
  const clase = area === 'calderas' ? 'bc-campo bc-ancho' : 'bpt-campo bpt-ancho'
  if (!individuales) return <label className={clase} htmlFor={id}><span>Reporte relevante del turno</span>
    <textarea id={id} aria-label="Reporte relevante del turno" lang="es-MX" spellCheck={true} rows={4} maxLength={4000} required={obligatorio}
      disabled={!habilitado} value={texto} onChange={e => cambiar(mayusculasNota(e.target.value))} /></label>

  return <div className="co-reportes-operadores">
    <h3>Reportes relevantes del turno</h3>
    {individuales.map((r, indice) => <label className={clase} htmlFor={`${id}-${indice}`} key={indice}>
      <span>{r.nombre}</span><textarea id={`${id}-${indice}`} aria-label={`Reporte relevante de ${r.nombre}`} lang="es-MX" spellCheck={true} rows={4}
        maxLength={4000} required={obligatorio} disabled={!habilitado} value={r.comentario}
        onChange={e => {
          const nuevos = individuales.map((anterior, i) => i === indice ? { ...anterior, comentario: e.target.value } : anterior) as ReportesIndividuales
          cambiar(resumenReportesIndividuales(nuevos), nuevos)
        }} />
    </label>)}
  </div>
}
