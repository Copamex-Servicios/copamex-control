import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode, TableHTMLAttributes } from 'react'
import { Icono } from './Icono'
import type { IconoNombre } from './Icono'

export function Button({ variante = 'secondary', className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: 'primary' | 'secondary' | 'danger' }) {
  return <button type={type} className={`co-button co-button-${variante} ${className}`} {...props} />
}
export function Card({ className = '', ...props }: HTMLAttributes<HTMLElement>) {
  return <article className={`co-card ${className}`} {...props} />
}
export function StatusBadge({ children, tono = 'neutral' }: { children: ReactNode; tono?: 'neutral' | 'success' | 'warning' | 'danger' }) {
  return <span className={`co-badge co-badge-${tono}`}><span aria-hidden="true" />{children}</span>
}
export function PageHeader({ titulo, descripcion, icono }: { titulo: string; descripcion?: string; icono: IconoNombre }) {
  return <div className="co-page-header"><span className="co-page-icon"><Icono nombre={icono} /></span><div><h1>{titulo}</h1>{descripcion && <p>{descripcion}</p>}</div></div>
}
export function DataTable({ children, className = '', ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <div className="co-table-scroll"><table className={`co-table ${className}`} {...props}>{children}</table></div>
}
export function FormField({ etiqueta, htmlFor, children, ayuda }: { etiqueta: string; htmlFor: string; children: ReactNode; ayuda?: string }) {
  return <div className="co-field"><label htmlFor={htmlFor}>{etiqueta}</label>{children}{ayuda && <small>{ayuda}</small>}</div>
}
