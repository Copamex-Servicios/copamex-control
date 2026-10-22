import { create } from 'zustand'
import type { AreaOperativa, Operador, TurnoOperativo } from '../lib/tiposTurno'
import type { ContextoCuentaTurno, SolicitudInicioTurno } from '../lib/turnos'

export type SolicitudPendienteTurno =
  | {
    readonly accion: 'iniciar' | 'cambiar'
    readonly contexto: Readonly<ContextoCuentaTurno>
    readonly solicitud: Readonly<SolicitudInicioTurno>
  }
  | {
    readonly accion: 'cerrar'
    readonly contexto: Readonly<ContextoCuentaTurno>
    readonly id: string
    readonly notas: string
  }

export interface DatosTurno {
  cuentaId: string | null
  area: AreaOperativa | null
  operadores: Operador[]
  turno: TurnoOperativo | null
  estadoCarga: 'sin-cuenta' | 'cargando' | 'listo' | 'error'
  mensaje: string | null
  accionEnCurso: 'iniciar' | 'cambiar' | 'cerrar' | null
  solicitudPendiente: SolicitudPendienteTurno | null
  mensajeAccion: string | null
}

interface TurnoStore extends DatosTurno {
  establecerEstado: (datos: DatosTurno) => void
  limpiar: () => void
}

function crearEstadoInicial(): DatosTurno {
  return {
    cuentaId: null,
    area: null,
    operadores: [],
    turno: null,
    estadoCarga: 'sin-cuenta',
    mensaje: null,
    accionEnCurso: null,
    solicitudPendiente: null,
    mensajeAccion: null,
  }
}

export const useTurnoStore = create<TurnoStore>()((set) => ({
  ...crearEstadoInicial(),
  establecerEstado: (datos) => set(datos),
  limpiar: () => set(crearEstadoInicial()),
}))

// Las confirmaciones son temporales; los errores y operaciones pendientes permanecen visibles.
let temporizadorConfirmacion: ReturnType<typeof setTimeout> | undefined
useTurnoStore.subscribe((actual, anterior) => {
  if (actual.mensajeAccion === anterior.mensajeAccion && actual.cuentaId === anterior.cuentaId) return
  clearTimeout(temporizadorConfirmacion)
  temporizadorConfirmacion = undefined
  if (actual.mensajeAccion !== 'Turno guardado.' && actual.mensajeAccion !== 'Cierre confirmado.') return
  const { cuentaId, mensajeAccion } = actual
  temporizadorConfirmacion = setTimeout(() => {
    const vigente = useTurnoStore.getState()
    if (vigente.cuentaId === cuentaId && vigente.mensajeAccion === mensajeAccion
      && !vigente.accionEnCurso && !vigente.solicitudPendiente) {
      useTurnoStore.setState({ mensajeAccion: null })
    }
  }, 4000)
})
