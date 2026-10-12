import { create } from 'zustand'
import type { RegistroCalidad, SolicitudGuardadoCalidad } from '../lib/calidad'
import type { LecturaCalidad, ValoresCalidad, CatalogosCalidad } from '../lib/tiposCalidad'

export interface ContextoCuentaCalidad {
  cuentaId: string
  rol: 'calderas' | 'ptar' | 'admin'
}

// Guardar una copia de los datos enviados para confirmar un reintento idéntico.
// El original conserva los valores y fechas anteriores de una corrección.
export interface SolicitudPendienteCalidad {
  readonly contexto: Readonly<ContextoCuentaCalidad>
  readonly solicitud: Readonly<Omit<SolicitudGuardadoCalidad, 'valores' | 'original'>> & {
    readonly valores: Readonly<ValoresCalidad>
    readonly original: Readonly<LecturaCalidad> | null
  }
}

export interface DatosCalidad {
  catalogos: CatalogosCalidad
  cuentaId: string | null
  rol: ContextoCuentaCalidad['rol'] | null
  turnoConsultadoId: string | null
  lecturaActual: RegistroCalidad | null
  historial: RegistroCalidad[]
  estadoCarga: 'sin-cuenta' | 'cargando' | 'listo' | 'error'
  mensaje: string | null
  guardando: boolean
  solicitudPendiente: SolicitudPendienteCalidad | null
  mensajeAccion: string | null
}

interface CalidadStore extends DatosCalidad {
  establecerEstado: (datos: DatosCalidad) => void
  limpiar: () => void
}

function crearEstadoInicial(): DatosCalidad {
  return {
    catalogos: { puntos: [], parametros: [] },
    cuentaId: null,
    rol: null,
    turnoConsultadoId: null,
    lecturaActual: null,
    historial: [],
    estadoCarga: 'sin-cuenta',
    mensaje: null,
    guardando: false,
    solicitudPendiente: null,
    mensajeAccion: null,
  }
}

// Estado en memoria. El hook comprobará cuenta, turno y permisos antes de usarlo.
// No es una cola offline: al recargar la página, se consultará lo guardado.
export const useCalidadStore = create<CalidadStore>()((set) => ({
  ...crearEstadoInicial(),
  establecerEstado: (datos) => set(datos),
  limpiar: () => set(crearEstadoInicial()),
}))
