import type { TurnoOperativo } from './tiposTurno'
export interface LecturaBitacora {
  id: string; turno_id: string; texto: string
  capturado_en: string; recibido_en: string; creado_por: string
  eliminado_en: null; eliminado_por: null
}
export interface RegistroBitacora { lectura: LecturaBitacora; turno: TurnoOperativo; operadorNombre: string }
export interface CamposBitacora { texto: string }
export interface ValoresBitacora { texto: string }
export interface SolicitudGuardadoBitacora { id: string; turnoId: string; valores: ValoresBitacora; original: LecturaBitacora | null }
