import { useAuthStore } from '../stores/authStore'
import { useTurnoStore } from '../stores/turnoStore'
import { useBitacoraStore } from '../stores/bitacoraStore'
import type { ContextoCuentaBitacora, SolicitudPendienteBitacora } from '../stores/bitacoraStore'
import {
  consultarHistorialBitacora, consultarLecturaBitacora, ErrorBitacora,
  originalBitacora,
  guardarLecturaBitacora, validarCamposBitacora,
} from '../lib/bitacora'
import type { AreaOperativa } from '../lib/tiposTurno'
import type { CamposBitacora, LecturaBitacora, ValoresBitacora } from '../lib/tiposBitacora'

let revisionConsulta = 0
let revisionAccion = 0
let consultaActiva: AbortController | null = null
let accionActiva: AbortController | null = null

function contextoDesdeAuth(auth: ReturnType<typeof useAuthStore.getState>): ContextoCuentaBitacora | null {
  const { estado, sesion, perfil } = auth
  if (estado !== 'autenticado' || !sesion || !perfil || perfil.activo !== true
    || perfil.id !== sesion.user.id || (perfil.rol !== 'calderas' && perfil.rol !== 'ptar' && perfil.rol !== 'admin')) return null
  return { cuentaId: perfil.id, rol: perfil.rol }
}

export function obtenerContextoBitacora(): ContextoCuentaBitacora | null {
  return contextoDesdeAuth(useAuthStore.getState())
}

function sigueLaCuenta(contexto: ContextoCuentaBitacora): boolean {
  const actual = obtenerContextoBitacora()
  return actual?.cuentaId === contexto.cuentaId && actual.rol === contexto.rol
}

function cacheDeLaCuenta(contexto: ContextoCuentaBitacora): boolean {
  const datos = useBitacoraStore.getState()
  return datos.cuentaId === contexto.cuentaId && datos.rol === contexto.rol
}

function turnoActual(contexto: ContextoCuentaBitacora) {
  const datos = useTurnoStore.getState()
  if (contexto.rol === 'admin' || datos.cuentaId !== contexto.cuentaId
    || datos.area !== contexto.rol || datos.estadoCarga !== 'listo') return null
  const turno = datos.turno
  return turno?.area === contexto.rol && turno.finalizado_en === null ? turno : null
}

function idTurnoActual(contexto: ContextoCuentaBitacora): string | null {
  return turnoActual(contexto)?.id ?? null
}

function cancelarConsulta(): void {
  revisionConsulta += 1
  consultaActiva?.abort()
  consultaActiva = null
}

export function cancelarGestionBitacora(): void {
  cancelarConsulta()
  revisionAccion += 1
  accionActiva?.abort()
  accionActiva = null
  useBitacoraStore.getState().limpiar()
}

async function conLimite<T>(
  tarea: () => Promise<T>, control: AbortController, espera: number, mutacion = false,
): Promise<T> {
  let temporizador: number | null = null
  let alCancelar: (() => void) | null = null
  const limite = new Promise<never>((_resolver, rechazar) => {
    alCancelar = () => rechazar(new ErrorBitacora('La operación se canceló. Actualiza antes de continuar.', mutacion))
    control.signal.addEventListener('abort', alCancelar, { once: true })
    if (control.signal.aborted) alCancelar()
    temporizador = window.setTimeout(() => {
      rechazar(new ErrorBitacora(mutacion
        ? 'No llegó la confirmación a tiempo. Reintenta la misma solicitud.'
        : 'La consulta tardó demasiado. Revisa la conexión e intenta de nuevo.', mutacion))
      control.abort()
    }, espera)
  })
  try {
    return await Promise.race([Promise.resolve().then(tarea), limite])
  } finally {
    if (temporizador !== null) window.clearTimeout(temporizador)
    if (alCancelar) control.signal.removeEventListener('abort', alCancelar)
  }
}

export async function actualizarDatosBitacora(): Promise<void> {
  const contexto = obtenerContextoBitacora()
  if (!contexto) {
    cancelarGestionBitacora()
    return
  }
  if (!cacheDeLaCuenta(contexto)) cancelarGestionBitacora()
  const anteriores = useBitacoraStore.getState()
  if (anteriores.guardando) return
  const turnoId = idTurnoActual(contexto)
  cancelarConsulta()
  const revision = revisionConsulta
  const control = new AbortController()
  consultaActiva = control
  anteriores.establecerEstado({
    ...anteriores, cuentaId: contexto.cuentaId, rol: contexto.rol,
    turnoConsultadoId: turnoId, lecturaActual: null, historial: [],
    estadoCarga: 'cargando', mensaje: null,
  })
  try {
    const [lecturaActual, historial] = await conLimite(() => Promise.all([
      turnoId ? consultarLecturaBitacora(turnoId, control.signal) : Promise.resolve(null),
      consultarHistorialBitacora(control.signal),
    ]), control, 15000)
    if (revision !== revisionConsulta || !sigueLaCuenta(contexto)
      || idTurnoActual(contexto) !== turnoId) return
    const actuales = useBitacoraStore.getState()
    actuales.establecerEstado({ ...actuales, lecturaActual, historial, estadoCarga: 'listo', mensaje: null })
  } catch (fallo) {
    if (revision !== revisionConsulta || !sigueLaCuenta(contexto)
      || idTurnoActual(contexto) !== turnoId) return
    const actuales = useBitacoraStore.getState()
    actuales.establecerEstado({
      ...actuales, lecturaActual: null, historial: [], estadoCarga: 'error',
      mensaje: fallo instanceof ErrorBitacora ? fallo.message : 'No se pudo consultar Bitácora. Reintenta.',
    })
  } finally {
    if (consultaActiva === control) consultaActiva = null
    control.abort()
  }
}

// El componente ControlBitacora llamará a esto al cambiar cuenta o turno.
export function sincronizarContextoBitacora(): void {
  const contexto = obtenerContextoBitacora()
  if (!contexto) {
    cancelarGestionBitacora()
    return
  }
  if (!cacheDeLaCuenta(contexto)) {
    cancelarGestionBitacora()
    void actualizarDatosBitacora()
    return
  }
  const datos = useBitacoraStore.getState()
  if (!datos.guardando && (datos.estadoCarga === 'sin-cuenta'
    || datos.turnoConsultadoId !== idTurnoActual(contexto))) void actualizarDatosBitacora()
}

function mostrarFalloAccion(mensaje: string): false {
  const actuales = useBitacoraStore.getState()
  actuales.establecerEstado({ ...actuales, mensajeAccion: mensaje })
  return false
}

function prepararAccionNueva(): ContextoCuentaBitacora | null {
  const contexto = obtenerContextoBitacora()
  if (!contexto || contexto.rol === 'admin' || !cacheDeLaCuenta(contexto)) return null
  const datos = useBitacoraStore.getState()
  if (datos.guardando) return null
  if (datos.solicitudPendiente) {
    mostrarFalloAccion('Hay un guardado sin confirmar. Reintenta esa misma solicitud antes de hacer otra.')
    return null
  }
  if (datos.estadoCarga !== 'listo' || datos.turnoConsultadoId !== idTurnoActual(contexto)) {
    mostrarFalloAccion('Actualiza la información de Bitácora antes de continuar.')
    return null
  }
  const turnos = useTurnoStore.getState()
  if (turnos.accionEnCurso || turnos.solicitudPendiente) {
    mostrarFalloAccion('Confirma la operación del turno antes de guardar Bitácora.')
    return null
  }
  return contexto
}

function mismaLectura(a: LecturaBitacora, b: LecturaBitacora): boolean {
  return a.id === b.id && a.turno_id === b.turno_id && a.creado_por === b.creado_por
    && a.capturado_en === b.capturado_en && a.recibido_en === b.recibido_en
    && JSON.stringify(originalBitacora(a)) === JSON.stringify(originalBitacora(b))
    && a.texto === b.texto && a.eliminado_en === null && b.eliminado_en === null
    && a.eliminado_por === null && b.eliminado_por === null
}

function originalConsultado(contexto: ContextoCuentaBitacora, original: LecturaBitacora): boolean {
  const datos = useBitacoraStore.getState()
  const registros = datos.lecturaActual ? [datos.lecturaActual, ...datos.historial] : datos.historial
  return original.creado_por === contexto.cuentaId && registros.some((registro) =>
    registro.turno.area === contexto.rol && registro.turno.iniciado_por === contexto.cuentaId
    && mismaLectura(registro.lectura, original))
}

function congelarSolicitud(pendiente: SolicitudPendienteBitacora): SolicitudPendienteBitacora {
  return Object.freeze({ contexto: Object.freeze({ ...pendiente.contexto }),
    solicitud: Object.freeze({ ...pendiente.solicitud,
      valores: Object.freeze({ ...pendiente.solicitud.valores }),
      original: pendiente.solicitud.original ? Object.freeze({ ...pendiente.solicitud.original }) : null,
    }),
  })
}

async function ejecutarAccion(pendiente: SolicitudPendienteBitacora): Promise<boolean> {
  if (pendiente.contexto.rol === 'admin' || !sigueLaCuenta(pendiente.contexto)
    || !cacheDeLaCuenta(pendiente.contexto) || useBitacoraStore.getState().guardando) return false
  cancelarConsulta()
  revisionAccion += 1
  const revision = revisionAccion
  const control = new AbortController()
  accionActiva = control
  const anteriores = useBitacoraStore.getState()
  anteriores.establecerEstado({ ...anteriores, guardando: true, solicitudPendiente: pendiente, mensajeAccion: null })
  try {
    await conLimite(() => guardarLecturaBitacora(pendiente.contexto.cuentaId,
      pendiente.solicitud, control.signal), control, 25000, true)
    if (revision !== revisionAccion || !sigueLaCuenta(pendiente.contexto)) return false
    const actuales = useBitacoraStore.getState()
    actuales.establecerEstado({
      ...actuales, guardando: false, solicitudPendiente: null,
      mensajeAccion: pendiente.solicitud.original ? 'Corrección de Bitácora confirmada.' : 'Nota de Bitácora guardada.',
    })
    // Recuperar el estado real: un reintento puede confirmar una captura de un turno ya cerrado.
    await actualizarDatosBitacora()
    return revision === revisionAccion && sigueLaCuenta(pendiente.contexto)
  } catch (fallo) {
    if (revision !== revisionAccion || !sigueLaCuenta(pendiente.contexto)) return false
    const incierto = !(fallo instanceof ErrorBitacora) || fallo.resultadoIncierto
    const actuales = useBitacoraStore.getState()
    actuales.establecerEstado({
      ...actuales, guardando: false, solicitudPendiente: incierto ? pendiente : null,
      mensajeAccion: fallo instanceof ErrorBitacora ? fallo.message : 'No llegó la confirmación. Reintenta la misma solicitud.',
    })
    await actualizarDatosBitacora()
    return false
  } finally {
    if (accionActiva === control) accionActiva = null
    control.abort()
  }
}


function prepararValores(campos: CamposBitacora): ValoresBitacora {
  return validarCamposBitacora(campos)
}

async function guardarBitacora(campos: CamposBitacora): Promise<boolean> {
  const contexto = prepararAccionNueva()
  if (!contexto) return false
  const turno = turnoActual(contexto)
  if (!turno || turno.iniciado_por !== contexto.cuentaId) {
    return mostrarFalloAccion('Inicia tu turno del área antes de guardar una nota nueva.')
  }
  let pendiente: SolicitudPendienteBitacora
  try {
    const valores = prepararValores(campos)
    pendiente = congelarSolicitud({ contexto, solicitud: { id: crypto.randomUUID(), turnoId: turno.id, valores, original: null } })
  } catch (fallo) {
    return mostrarFalloAccion(fallo instanceof ErrorBitacora ? fallo.message : 'No se pudo preparar la captura. Intenta de nuevo.')
  }
  return ejecutarAccion(pendiente)
}

async function corregirBitacora(campos: CamposBitacora, original: LecturaBitacora): Promise<boolean> {
  const contexto = prepararAccionNueva()
  if (!contexto) return false
  if (!originalConsultado(contexto, original)) {
    return mostrarFalloAccion('La nota original cambió o no pertenece a esta cuenta. Actualiza antes de corregir.')
  }
  let pendiente: SolicitudPendienteBitacora
  try {
    const valores = prepararValores(campos)
    pendiente = congelarSolicitud({ contexto, solicitud: { id: original.id, turnoId: original.turno_id, valores, original } })
  } catch (fallo) {
    return mostrarFalloAccion(fallo instanceof ErrorBitacora ? fallo.message : 'No se pudo preparar la corrección. Intenta de nuevo.')
  }
  // El servidor comprueba la hora desde la captura original, también en turnos cerrados.
  return ejecutarAccion(pendiente)
}

async function reintentarGuardadoBitacora(): Promise<boolean> {
  const pendiente = useBitacoraStore.getState().solicitudPendiente
  return pendiente ? ejecutarAccion(pendiente) : false
}

export function useBitacora(area: AreaOperativa) {
  const auth = useAuthStore()
  const datos = useBitacoraStore()
  const datosTurno = useTurnoStore()
  const contexto = contextoDesdeAuth(auth)
  const mismaCuenta = contexto !== null && datos.cuentaId === contexto.cuentaId && datos.rol === contexto.rol
  const mismaVista = mismaCuenta && datos.turnoConsultadoId === idTurnoActual(contexto)
  const turno = contexto ? turnoActual(contexto) : null
  const listo = mismaVista && datos.estadoCarga === 'listo'
  const bloqueado = !listo || datos.guardando || datos.solicitudPendiente !== null
    || datosTurno.accionEnCurso !== null || datosTurno.solicitudPendiente !== null
  return {
    cuentaId: contexto?.cuentaId ?? null,
    rol: contexto?.rol ?? null,
    turno: turno?.area === area ? turno : null,
    lecturaActual: mismaVista && datos.lecturaActual?.turno.area === area ? datos.lecturaActual : null,
    historial: mismaVista ? datos.historial.filter(r => r.turno.area === area) : [],
    estadoCarga: mismaVista ? datos.estadoCarga : contexto ? 'cargando' as const : 'sin-cuenta' as const,
    mensaje: mismaVista ? datos.mensaje : null,
    guardando: mismaCuenta ? datos.guardando : false,
    solicitudPendiente: mismaCuenta ? datos.solicitudPendiente : null,
    mensajeAccion: mismaCuenta ? datos.mensajeAccion : null,
    puedeCrear: contexto?.rol === area && !bloqueado && turno !== null && turno.area === area
      && turno.iniciado_por === contexto.cuentaId,
    puedeCorregir: (original: LecturaBitacora): boolean => contexto?.rol === area
      && !bloqueado && originalConsultado(contexto, original),
    guardarBitacora, corregirBitacora, reintentarGuardadoBitacora,
    actualizarBitacora: actualizarDatosBitacora,
  }
}
