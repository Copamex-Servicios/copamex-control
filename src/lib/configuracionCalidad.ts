import type { ParametroCalidad, PuntoCalidad } from './tiposCalidad'
import type { AreaOperativa } from './tiposTurno'

/** La elegibilidad depende de IDs y configuración del catálogo, nunca del nombre visible. */
export function parametrosParaPuntoCalidad(parametros: readonly ParametroCalidad[], punto: PuntoCalidad, area: AreaOperativa) {
  if (!punto.activo || (punto.area !== null && punto.area !== area)) return []
  return parametros.filter(p => p.activo && p.areas_captura.includes(area)
    && (p.puntos_permitidos === null || p.puntos_permitidos.includes(punto.id)))
}
