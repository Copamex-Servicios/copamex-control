import { create } from 'zustand'
import type { RegistroUF, SolicitudGuardadoUF } from '../lib/uf'
import type { LecturaUF, ValoresUF } from '../lib/tiposUF'

export interface ContextoCuentaUF {
  cuentaId: string
  rol: 'calderas' | 'admin'
}

// Guardar una copia de los datos enviados para confirmar un reintento idéntico.
// El original conserva los valores y fechas anteriores de una corrección.
export interface SolicitudPendienteUF {
  readonly contexto: Readonly<ContextoCuentaUF>
  readonly solicitud: Readonly<Omit<SolicitudGuardadoUF, 'valores' | 'original'>> & {
    readonly valores: Readonly<ValoresUF>
    readonly original: Readonly<LecturaUF> | null
  }
}

export interface DatosUF {
  cuentaId: string | null
  rol: ContextoCuentaUF['rol'] | null
  turnoConsultadoId: string | null
  lecturaActual: RegistroUF | null
  historial: RegistroUF[]
  estadoCarga: 'sin-cuenta' | 'cargando' | 'listo' | 'error'
  mensaje: string | null
  guardando: boolean
  solicitudPendiente: SolicitudPendienteUF | null
  mensajeAccion: string | null
}

interface UFStore extends DatosUF {
  establecerEstado: (datos: DatosUF) => void
  limpiar: () => void
}

function crearEstadoInicial(): DatosUF {
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
export const useUFStore = create<UFStore>()((set) => ({
  ...crearEstadoInicial(),
  establecerEstado: (datos) => set(datos),
  limpiar: () => set(crearEstadoInicial()),
}))
