import type { ReactNode } from 'react'
import './detalleReportePlanta.css'

export function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return <section className="pcr-seccion"><h5>{titulo}</h5>{children}</section>
}

export function Estado({ valor }: { valor: string }) {
  if (!valor) return <span className="pcr-vacio">Sin registrar</span>
  const tono = valor === 'Servicio' || valor === 'En servicio' ? 'servicio'
    : valor === 'Reserva' || valor === 'Preparado' ? 'reserva'
      : valor === 'Mantenimiento' ? 'mantenimiento' : 'neutro'
  return <span className={`pcr-estado pcr-estado--${tono}`}>{valor}</span>
}

export function Dato({ nombre, valor, unidad = '', vacio = 'Sin lectura', ancho = false }: {
  nombre: string; valor: string; unidad?: string; vacio?: string; ancho?: boolean
}) {
  return <div className={`pcr-dato${ancho ? ' pcr-ancho' : ''}`}><dt>{nombre}</dt><dd className={valor === '' ? 'pcr-vacio' : undefined}>
    {valor === '' ? vacio : <>{valor}{unidad && <span className="pcr-unidad"> {unidad}</span>}</>}
  </dd></div>
}
