import { useAuthStore } from '../stores/authStore'
import { useTurnoStore } from '../stores/turnoStore'
import { usePTARStore } from '../stores/ptarStore'
import type { ContextoCuentaPTAR, SolicitudPendientePTAR } from '../stores/ptarStore'
import {
  consultarHistorialPTAR, consultarLecturaPTAR, ErrorPTAR,
  originalPTAR,
  guardarLecturaPTAR, validarCamposPTAR,
} from '../lib/ptar'
import type { CamposPTAR, LecturaPTAR, ValoresPTAR } from '../lib/tiposPTAR'

let revisionConsulta = 0
let revisionAccion = 0
let consultaActiva: AbortController | null = null
let accionActiva: AbortController | null = null

function contextoDesdeAuth(auth: ReturnType<typeof useAuthStore.getState>): ContextoCuentaPTAR | null {
  const { estado, sesion, perfil } = auth
  if (estado !== 'autenticado' || !sesion || !perfil || perfil.activo !== true
    || perfil.id !== sesion.user.id || (perfil.rol !== 'ptar' && perfil.rol !== 'admin')) return null
  return { cuentaId: perfil.id, rol: perfil.rol }
}

export function obtenerContextoPTAR(): ContextoCuentaPTAR | null {
  return contextoDesdeAuth(useAuthStore.getState())
}

function sigueLaCuenta(contexto: ContextoCuentaPTAR): boolean {
  const actual = obtenerContextoPTAR()
  return actual?.cuentaId === contexto.cuentaId && actual.rol === contexto.rol
}

function cacheDeLaCuenta(contexto: ContextoCuentaPTAR): boolean {
  const datos = usePTARStore.getState()
  return datos.cuentaId === contexto.cuentaId && datos.rol === contexto.rol
}

function turnoActual(contexto: ContextoCuentaPTAR) {
  const datos = useTurnoStore.getState()
  if (contexto.rol === 'admin' || datos.cuentaId !== contexto.cuentaId
    || datos.area !== contexto.rol || datos.estadoCarga !== 'listo') return null
  const turno = datos.turno
  return turno?.area === contexto.rol && turno.finalizado_en === null ? turno : null
}

function idTurnoActual(contexto: ContextoCuentaPTAR): string | null {
  return turnoActual(contexto)?.id ?? null
}

function cancelarConsulta(): void {
  revisionConsulta += 1
  consultaActiva?.abort()
  consultaActiva = null
}

export function cancelarGestionPTAR(): void {
  cancelarConsulta()
  revisionAccion += 1
  accionActiva?.abort()
  accionActiva = null
  usePTARStore.getState().limpiar()
}

async function conLimite<T>(
  tarea: () => Promise<T>, control: AbortController, espera: number, mutacion = false,
): Promise<T> {
  let temporizador: number | null = null
  let alCancelar: (() => void) | null = null
  const limite = new Promise<never>((_resolver, rechazar) => {
    alCancelar = () => rechazar(new ErrorPTAR('La operación se canceló. Actualiza antes de continuar.', mutacion))
    control.signal.addEventListener('abort', alCancelar, { once: true })
    if (control.signal.aborted) alCancelar()
    temporizador = window.setTimeout(() => {
      rechazar(new ErrorPTAR(mutacion
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

export async function actualizarDatosPTAR(): Promise<void> {
  const contexto = obtenerContextoPTAR()
  if (!contexto) {
    cancelarGestionPTAR()
    return
  }
  if (!cacheDeLaCuenta(contexto)) cancelarGestionPTAR()
  const anteriores = usePTARStore.getState()
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
      turnoId ? consultarLecturaPTAR(turnoId, control.signal) : Promise.resolve(null),
      consultarHistorialPTAR(control.signal),
    ]), control, 15000)
    if (revision !== revisionConsulta || !sigueLaCuenta(contexto)
      || idTurnoActual(contexto) !== turnoId) return
    const actuales = usePTARStore.getState()
    actuales.establecerEstado({ ...actuales, lecturaActual, historial, estadoCarga: 'listo', mensaje: null })
  } catch (fallo) {
    if (revision !== revisionConsulta || !sigueLaCuenta(contexto)
      || idTurnoActual(contexto) !== turnoId) return
    const actuales = usePTARStore.getState()
    actuales.establecerEstado({
      ...actuales, lecturaActual: null, historial: [], estadoCarga: 'error',
      mensaje: fallo instanceof ErrorPTAR ? fallo.message : 'No se pudo consultar PTAR. Reintenta.',
    })
  } finally {
    if (consultaActiva === control) consultaActiva = null
    control.abort()
  }
}

// El componente ControlPTAR llamará a esto al cambiar cuenta o turno.
export function sincronizarContextoPTAR(): void {
  const contexto = obtenerContextoPTAR()
  if (!contexto) {
    cancelarGestionPTAR()
    return
  }
  if (!cacheDeLaCuenta(contexto)) {
    cancelarGestionPTAR()
    void actualizarDatosPTAR()
    return
  }
  const datos = usePTARStore.getState()
  if (!datos.guardando && (datos.estadoCarga === 'sin-cuenta'
    || datos.turnoConsultadoId !== idTurnoActual(contexto))) void actualizarDatosPTAR()
}

function mostrarFalloAccion(mensaje: string): false {
  const actuales = usePTARStore.getState()
  actuales.establecerEstado({ ...actuales, mensajeAccion: mensaje })
  return false
}

function prepararAccionNueva(): ContextoCuentaPTAR | null {
  const contexto = obtenerContextoPTAR()
  if (!contexto || contexto.rol === 'admin' || !cacheDeLaCuenta(contexto)) return null
  const datos = usePTARStore.getState()
  if (datos.guardando) return null
  if (datos.solicitudPendiente) {
    mostrarFalloAccion('Hay un guardado sin confirmar. Reintenta esa misma solicitud antes de hacer otra.')
    return null
  }
  if (datos.estadoCarga !== 'listo' || datos.turnoConsultadoId !== idTurnoActual(contexto)) {
    mostrarFalloAccion('Actualiza la información de PTAR antes de continuar.')
    return null
  }
  const turnos = useTurnoStore.getState()
  if (turnos.accionEnCurso || turnos.solicitudPendiente) {
    mostrarFalloAccion('Confirma la operación del turno antes de guardar PTAR.')
    return null
  }
  return contexto
}

function mismaLectura(a: LecturaPTAR, b: LecturaPTAR): boolean {
  return a.id === b.id && a.turno_id === b.turno_id && a.creado_por === b.creado_por
    && a.capturado_en === b.capturado_en && a.recibido_en === b.recibido_en
    && JSON.stringify(originalPTAR(a)) === JSON.stringify(originalPTAR(b))
    && a.eliminado_en === null && b.eliminado_en === null
    && a.eliminado_por === null && b.eliminado_por === null
}

function originalConsultado(contexto: ContextoCuentaPTAR, original: LecturaPTAR): boolean {
  const datos = usePTARStore.getState()
  const registros = datos.lecturaActual ? [datos.lecturaActual, ...datos.historial] : datos.historial
  return original.creado_por === contexto.cuentaId && registros.some((registro) =>
    registro.turno.area === contexto.rol && registro.turno.iniciado_por === contexto.cuentaId
    && mismaLectura(registro.lectura, original))
}

function congelarSolicitud(pendiente: SolicitudPendientePTAR): SolicitudPendientePTAR {
  return Object.freeze({ contexto: Object.freeze({ ...pendiente.contexto }),
    solicitud: Object.freeze({ ...pendiente.solicitud,
      valores: Object.freeze({ ...pendiente.solicitud.valores }),
      original: pendiente.solicitud.original ? Object.freeze({ ...pendiente.solicitud.original }) : null,
    }),
  })
}

async function ejecutarAccion(pendiente: SolicitudPendientePTAR): Promise<boolean> {
  if (pendiente.contexto.rol === 'admin' || !sigueLaCuenta(pendiente.contexto)
    || !cacheDeLaCuenta(pendiente.contexto) || usePTARStore.getState().guardando) return false
  cancelarConsulta()
  revisionAccion += 1
  const revision = revisionAccion
  const control = new AbortController()
  accionActiva = control
  const anteriores = usePTARStore.getState()
  anteriores.establecerEstado({ ...anteriores, guardando: true, solicitudPendiente: pendiente, mensajeAccion: null })
  try {
    await conLimite(() => guardarLecturaPTAR(pendiente.contexto.cuentaId,
      pendiente.solicitud, control.signal), control, 25000, true)
    if (revision !== revisionAccion || !sigueLaCuenta(pendiente.contexto)) return false
    const actuales = usePTARStore.getState()
    actuales.establecerEstado({
      ...actuales, guardando: false, solicitudPendiente: null,
      mensajeAccion: pendiente.solicitud.original ? 'Corrección de PTAR confirmada.' : 'Lectura de PTAR guardada.',
    })
    // Recuperar el estado real: un reintento puede confirmar una captura de un turno ya cerrado.
    await actualizarDatosPTAR()
    return revision === revisionAccion && sigueLaCuenta(pendiente.contexto)
  } catch (fallo) {
    if (revision !== revisionAccion || !sigueLaCuenta(pendiente.contexto)) return false
    const incierto = !(fallo instanceof ErrorPTAR) || fallo.resultadoIncierto
    const actuales = usePTARStore.getState()
    actuales.establecerEstado({
      ...actuales, guardando: false, solicitudPendiente: incierto ? pendiente : null,
      mensajeAccion: fallo instanceof ErrorPTAR ? fallo.message : 'No llegó la confirmación. Reintenta la misma solicitud.',
    })
    await actualizarDatosPTAR()
    return false
  } finally {
    if (accionActiva === control) accionActiva = null
    control.abort()
  }
}


function prepararValores(campos: CamposPTAR): ValoresPTAR {
  return validarCamposPTAR(campos)
}

async function guardarPTAR(campos: CamposPTAR): Promise<boolean> {
  const contexto = prepararAccionNueva()
  if (!contexto) return false
  const turno = turnoActual(contexto)
  if (!turno || turno.iniciado_por !== contexto.cuentaId) {
    return mostrarFalloAccion('Inicia tu turno del área antes de guardar una lectura nueva.')
  }
  let pendiente: SolicitudPendientePTAR
  try {
    const valores = prepararValores(campos)
    pendiente = congelarSolicitud({ contexto, solicitud: { id: crypto.randomUUID(), turnoId: turno.id, valores, original: null } })
  } catch (fallo) {
    return mostrarFalloAccion(fallo instanceof ErrorPTAR ? fallo.message : 'No se pudo preparar la captura. Intenta de nuevo.')
  }
  return ejecutarAccion(pendiente)
}

async function corregirPTAR(campos: CamposPTAR, original: LecturaPTAR): Promise<boolean> {
  const contexto = prepararAccionNueva()
  if (!contexto) return false
  if (!originalConsultado(contexto, original)) {
    return mostrarFalloAccion('La lectura original cambió o no pertenece a esta cuenta. Actualiza antes de corregir.')
  }
  let pendiente: SolicitudPendientePTAR
  try {
    const valores = prepararValores(campos)
    pendiente = congelarSolicitud({ contexto, solicitud: { id: original.id, turnoId: original.turno_id, valores, original } })
  } catch (fallo) {
    return mostrarFalloAccion(fallo instanceof ErrorPTAR ? fallo.message : 'No se pudo preparar la corrección. Intenta de nuevo.')
  }
  // El servidor comprueba la hora desde la captura original, también en turnos cerrados.
  return ejecutarAccion(pendiente)
}

async function reintentarGuardadoPTAR(): Promise<boolean> {
  const pendiente = usePTARStore.getState().solicitudPendiente
  return pendiente ? ejecutarAccion(pendiente) : false
}

export function usePTAR() {
  const area = 'ptar' as const
  const auth = useAuthStore()
  const datos = usePTARStore()
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
    puedeCorregir: (original: LecturaPTAR): boolean => contexto?.rol === area
      && !bloqueado && originalConsultado(contexto, original),
    guardarPTAR, corregirPTAR, reintentarGuardadoPTAR,
    actualizarPTAR: actualizarDatosPTAR,
  }
}
