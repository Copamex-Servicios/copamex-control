export type RolUsuario = 'calderas' | 'ptar' | 'admin' | 'calidad'

export interface Perfil {
  id: string
  nombre: string
  rol: RolUsuario
  activo: boolean
}

export type EstadoAuth =
  | 'cargando'
  | 'sin-sesion'
  | 'autenticado'
  | 'sin-perfil'
  | 'inactivo'
  | 'error'