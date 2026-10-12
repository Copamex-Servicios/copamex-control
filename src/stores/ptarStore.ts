import { create } from 'zustand'
import type { RegistroPTAR, SolicitudGuardadoPTAR } from '../lib/ptar'
import type { LecturaPTAR, ValoresPTAR } from '../lib/tiposPTAR'

export interface ContextoCuentaPTAR {
  cuentaId: string
  rol: 'ptar' | 'admin'
}

// Guardar una copia de los datos enviados para confirmar un reintento idéntico.
// El original conserva los valores y fechas anteriores de una corrección.
export interface SolicitudPendientePTAR {
  readonly contexto: Readonly<ContextoCuentaPTAR>
  readonly solicitud: Readonly<Omit<SolicitudGuardadoPTAR, 'valores' | 'original'>> & {
    readonly valores: Readonly<ValoresPTAR>
    readonly original: Readonly<LecturaPTAR> | null
  }
}

export interface DatosPTAR {
  cuentaId: string | null
  rol: ContextoCuentaPTAR['rol'] | null
  turnoConsultadoId: string | null
  lecturaActual: RegistroPTAR | null
  historial: RegistroPTAR[]
  estadoCarga: 'sin-cuenta' | 'cargando' | 'listo' | 'error'
  mensaje: string | null
  guardando: boolean
  solicitudPendiente: SolicitudPendientePTAR | null
  mensajeAccion: string | null
}

interface PTARStore extends DatosPTAR {
  establecerEstado: (datos: DatosPTAR) => void
  limpiar: () => void
}

function crearEstadoInicial(): DatosPTAR {
  return {
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
export const usePTARStore = create<PTARStore>()((set) => ({
  ...crearEstadoInicial(),
  establecerEstado: (datos) => set(datos),
  limpiar: () => set(crearEstadoInicial()),
}))
