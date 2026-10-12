import type { IconoNombre } from './Icono'

export interface AccesoVisual { titulo: string; ruta: string; descripcion: string; icono: IconoNombre }

export interface SubmenuVisual { titulo: string; seleccion: string; opciones: readonly { id: string; nombre: string; icono: IconoNombre }[]; alSeleccionar: (id: string) => void }
