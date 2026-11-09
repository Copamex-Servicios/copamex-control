import type { FilaAdmin } from './administracion'

export const mensajeAutorAviso = 'Solo la cuenta que creó el aviso puede editarlo o finalizarlo.'

export function esAutorAviso(cuenta: string | null, aviso: FilaAdmin): boolean {
  return !!cuenta && aviso.creado_por === cuenta
}
