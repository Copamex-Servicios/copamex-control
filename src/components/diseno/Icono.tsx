import type { SVGProps } from 'react'
import { imagenes } from './recursosIconos'
import type { IconoNombre } from './recursosIconos'
export type { IconoNombre } from './recursosIconos'

export function Icono({
  nombre,
  ...props
}: SVGProps<SVGSVGElement> & { nombre: IconoNombre }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {nombre === 'flecha' ? <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /> : <image
        href={import.meta.env.BASE_URL + imagenes[nombre]}
        x="0"
        y="0"
        width="24"
        height="24"
        preserveAspectRatio="xMidYMid meet"
      />}
    </svg>
  )
}