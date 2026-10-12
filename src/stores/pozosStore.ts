import { create } from 'zustand'
import type { RegistroPozos, SolicitudGuardadoPozos } from '../lib/pozos'
import type { LecturaPozos, ValoresPozos } from '../lib/tiposPozos'

export interface ContextoCuentaPozos {
  cuentaId: string
  rol: 'calderas' | 'admin'
}

// Guardar una copia de los datos enviados para confirmar un reintento idéntico.
// El original conserva los valores y fechas anteriores de una corrección.
export interface SolicitudPendientePozos {
  readonly contexto: Readonly<ContextoCuentaPozos>
  readonly solicitud: Readonly<Omit<SolicitudGuardadoPozos, 'valores' | 'original'>> & {
    readonly valores: Readonly<ValoresPozos>
    readonly original: Readonly<LecturaPozos> | null
  }
}

export interface DatosPozos {
  cuentaId: string | null
  rol: ContextoCuentaPozos['rol'] | null
  turnoConsultadoId: string | null
  lecturaActual: RegistroPozos | null
  historial: RegistroPozos[]
  estadoCarga: 'sin-cuenta' | 'cargando' | 'listo' | 'error'
  mensaje: string | null
  guardando: boolean
  solicitudPendiente: SolicitudPendientePozos | null
  mensajeAccion: string | null
}

interface PozosStore extends DatosPozos {
  establecerEstado: (datos: DatosPozos) => void
  limpiar: () => void
}

function crearEstadoInicial(): DatosPozos {
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
export const usePozosStore = create<PozosStore>()((set) => ({
  ...crearEstadoInicial(),
  establecerEstado: (datos) => set(datos),
  limpiar: () => set(crearEstadoInicial()),
}))
