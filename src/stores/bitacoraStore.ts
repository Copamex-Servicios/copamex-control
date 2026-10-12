import { create } from 'zustand'
import type { RegistroBitacora, SolicitudGuardadoBitacora } from '../lib/bitacora'
import type { LecturaBitacora, ValoresBitacora } from '../lib/tiposBitacora'

export interface ContextoCuentaBitacora {
  cuentaId: string
  rol: 'calderas' | 'ptar' | 'admin'
}

// Guardar una copia de los datos enviados para confirmar un reintento idéntico.
// El original conserva los valores y fechas anteriores de una corrección.
export interface SolicitudPendienteBitacora {
  readonly contexto: Readonly<ContextoCuentaBitacora>
  readonly solicitud: Readonly<Omit<SolicitudGuardadoBitacora, 'valores' | 'original'>> & {
    readonly valores: Readonly<ValoresBitacora>
    readonly original: Readonly<LecturaBitacora> | null
  }
}

export interface DatosBitacora {
  cuentaId: string | null
  rol: ContextoCuentaBitacora['rol'] | null
  turnoConsultadoId: string | null
  lecturaActual: RegistroBitacora | null
  historial: RegistroBitacora[]
  estadoCarga: 'sin-cuenta' | 'cargando' | 'listo' | 'error'
  mensaje: string | null
  guardando: boolean
  solicitudPendiente: SolicitudPendienteBitacora | null
  mensajeAccion: string | null
}

interface BitacoraStore extends DatosBitacora {
  establecerEstado: (datos: DatosBitacora) => void
  limpiar: () => void
}

function crearEstadoInicial(): DatosBitacora {
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
export const useBitacoraStore = create<BitacoraStore>()((set) => ({
  ...crearEstadoInicial(),
  establecerEstado: (datos) => set(datos),
  limpiar: () => set(crearEstadoInicial()),
}))
