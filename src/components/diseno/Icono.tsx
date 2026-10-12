import type { SVGProps } from 'react'

export type IconoNombre =
  | 'inicio'
  | 'calderas'
  | 'ptar'
  | 'planta'
  | 'reportes'
  | 'administracion'
  | 'menu'
  | 'cerrar'
  | 'salir'
  | 'flecha'
  | 'cuenta'
  | 'modulos'
  | 'bitacora'
  | 'pozos'
  | 'uf'
  | 'calidad'
  | 'cuentaadm'
const imagenes: Record<IconoNombre, string> = {
  inicio: 'inicio.png',
  calderas: 'calderas.png',
  ptar: 'ptar.png',
  planta: 'planta.png',
  reportes: 'reportes.png',
  administracion: 'administracion.png',
  menu: 'menu.png',
  cerrar: 'cerrar.png',
  salir: 'salir.png',
  flecha: 'flecha.png',
  cuenta: 'cuenta.png',
  modulos: 'modulos.png',
  bitacora: 'bitacora.png',
  pozos: 'pozos.png',
  uf: 'uf.png',
  calidad: 'calidad.png',
  cuentaadm: 'cuentaadm.png',
}

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
      <image
        href={import.meta.env.BASE_URL + imagenes[nombre]}
        x="0"
        y="0"
        width="24"
        height="24"
        preserveAspectRatio="xMidYMid meet"
      />
    </svg>
  )
}