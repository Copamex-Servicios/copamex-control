import type { ReactNode } from 'react'
import type { TurnoOperativo } from '../../lib/tiposTurno'
import './fichaRegistro.css'

interface Props {
  titulo: string
  tituloId?: string
  turno: Pick<TurnoOperativo, 'fecha_operativa' | 'area' | 'turno'>
  operador: string
  children?: ReactNode
}

export function CabeceraRegistroGuardado({ titulo, tituloId, turno, operador, children }: Props) {
  return <header className="co-ficha-cabecera">
    <h3 id={tituloId}>{titulo}</h3>
    <dl className="co-ficha-identidad">
      <div><dt>Fecha operativa</dt><dd><time dateTime={turno.fecha_operativa}>{turno.fecha_operativa.split('-').reverse().join('/')}</time></dd></div>
      <div><dt>Área</dt><dd>{turno.area === 'calderas' ? 'Calderas' : 'PTAR'}</dd></div>
      <div><dt>Turno</dt><dd>{turno.turno === 'dia' ? 'Día' : turno.turno === 'tarde' ? 'Tarde' : 'Noche'}</dd></div>
      <div className="co-ficha-operador"><dt>Operador</dt><dd>{operador}</dd></div>
    </dl>
    {children && <dl className="co-ficha-fechas">{children}</dl>}
  </header>
}
