import type { AreaOperativa as AreaPlanta, TurnoOperativo } from './tiposTurno'
export interface PuntoCalidad { id: string; nombre: string; area: AreaPlanta | null; activo: boolean; orden: number }
export interface ParametroCalidad { id: string; nombre: string; unidad: string | null; activo: boolean }
export interface CatalogosCalidad { puntos: PuntoCalidad[]; parametros: ParametroCalidad[] }
export interface ResultadoCalidad {
  id: string; muestra_id: string; punto_id: string; parametro_id: string; valor: number
  limite_min_aplicado: number | null; limite_max_aplicado: number | null; fuera_norma: boolean | null
  punto: Pick<PuntoCalidad, 'id' | 'nombre' | 'area'>
  parametro: Pick<ParametroCalidad, 'id' | 'nombre' | 'unidad'>
}
export interface LecturaCalidad {
  id: string; turno_id: string; hora_muestra: string; notas: string | null
  capturado_en: string; recibido_en: string; creado_por: string
  eliminado_en: null; eliminado_por: null; resultados: readonly ResultadoCalidad[]
}
export interface RegistroCalidad { lectura: LecturaCalidad; turno: TurnoOperativo; operadorNombre: string }
export interface CamposCalidad { valores: Record<string, string>; notas: string }
export interface ResultadoEnviadoCalidad { id: string; punto_id: string; parametro_id: string; valor: number }
export interface ValoresCalidad { resultados: readonly ResultadoEnviadoCalidad[]; notas: string | null }
export interface SolicitudGuardadoCalidad { id: string; turnoId: string; valores: ValoresCalidad; original: LecturaCalidad | null }
