import type { CapturaPlanta } from '../../lib/planta'
import { LecturaBitacoraGuardada } from '../bitacora/LecturaBitacoraGuardada'
import { LecturaPozosHistorial } from '../pozos/LecturaPozosHistorial'
import { LecturaUFHistorial } from '../uf/LecturaUFHistorial'
import { LecturaCalidadGuardada } from '../calidad/LecturaCalidadGuardada'
import { LecturaPTARGuardada } from '../ptar/LecturaPTARGuardada'

export function DetallePlanta({ captura }: { captura: CapturaPlanta }) {
  switch (captura.modulo) {
    case 'bitacora': return <LecturaBitacoraGuardada registro={captura.registro} ficha />
    case 'pozos': return <LecturaPozosHistorial registro={captura.registro} />
    case 'uf': return <LecturaUFHistorial registro={captura.registro} />
    case 'calidad': return <LecturaCalidadGuardada registro={captura.registro} />
    case 'ptar': return <LecturaPTARGuardada registro={captura.registro} />
  }
}
