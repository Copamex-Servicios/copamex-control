export type AreaOperativa = 'calderas' | 'ptar'

export type TipoTurno = 'dia' | 'tarde' | 'noche'

export interface Operador {
  id: string
  nombre: string
  numero_empleado: string | null
  activo: boolean
  creado_en: string
}

export interface TurnoOperativo {
  id: string
  fecha_operativa: string
  area: AreaOperativa
  turno: TipoTurno
  operador_id: string
  operador_acompanante_id: string | null
  iniciado_por: string
  iniciado_en: string
  finalizado_en: string | null
  notas_cierre: string | null
}

export const relacionOperadorAcompanante =
  'operador_acompanante:operadores!turnos_operativos_operador_acompanante_id_fkey(id,nombre)'
export const relacionOperadorPrincipal =
  'operador:operadores!turnos_operativos_operador_id_fkey!inner(id,nombre)'

export function leerNombreOperadorAcompanante(turno: Record<string, unknown>): string | null {
  const id = turno.operador_acompanante_id
  const relacion = turno.operador_acompanante
  if (id === null) {
    if (relacion !== null && relacion !== undefined) throw new Error('La relación del segundo operador no coincide con el turno.')
    return null
  }
  if (typeof id !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)
    || !relacion || typeof relacion !== 'object' || Array.isArray(relacion)) {
    throw new Error('No se pudo comprobar el segundo operador del turno.')
  }
  const operador = relacion as Record<string, unknown>
  if (operador.id !== id || typeof operador.nombre !== 'string' || !operador.nombre.trim()) {
    throw new Error('No se pudo comprobar el segundo operador del turno.')
  }
  return operador.nombre
}

export function etiquetaOperadoresTurno(principal: string, acompanante: string | null | undefined): string {
  return acompanante ? `${principal} · ${acompanante}` : principal
}
