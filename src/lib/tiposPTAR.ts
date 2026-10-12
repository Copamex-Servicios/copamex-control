import type { TurnoOperativo } from './tiposTurno'
export const medicionesPTAR = [
  { campo: 'dqo_sand_float', parametro: 'DQO', punto: 'Sand Float' },
  { campo: 'dqo_t03_04', parametro: 'DQO', punto: 'T03/04' },
  { campo: 'dqo_colector', parametro: 'DQO', punto: 'Colector' },
  { campo: 'dqo_pila', parametro: 'DQO', punto: 'Pila' },
  { campo: 'sst_sand_float', parametro: 'SST', punto: 'Sand Float' },
  { campo: 'sst_t03_04', parametro: 'SST', punto: 'T03/04' },
  { campo: 'sst_colector', parametro: 'SST', punto: 'Colector' },
  { campo: 'sst_pila', parametro: 'SST', punto: 'Pila' },
] as const
export type CampoMedicionPTAR = typeof medicionesPTAR[number]['campo']
export type ValoresPTAR = Record<CampoMedicionPTAR, number | null> & { notas: string | null }
export type CamposPTAR = Record<CampoMedicionPTAR, string> & { notas: string }
export interface LecturaPTAR extends ValoresPTAR {
  id: string; turno_id: string; capturado_en: string; recibido_en: string
  creado_por: string; eliminado_en: null; eliminado_por: null
}
export interface RegistroPTAR { lectura: LecturaPTAR; turno: TurnoOperativo; operadorNombre: string }
export interface SolicitudGuardadoPTAR { id: string; turnoId: string; valores: ValoresPTAR; original: LecturaPTAR | null }
