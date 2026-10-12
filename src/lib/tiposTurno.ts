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
  iniciado_por: string
  iniciado_en: string
  finalizado_en: string | null
  notas_cierre: string | null
}
