import { useAuthStore } from '../stores/authStore'
import { useTurnoStore } from '../stores/turnoStore'
import { usePozosStore } from '../stores/pozosStore'
import type { ContextoCuentaPozos, SolicitudPendientePozos } from '../stores/pozosStore'
import {
  consultarHistorialPozos, consultarLecturaPozos, ErrorPozos,
  guardarLecturaPozos, validarCamposPozos,
} from '../lib/pozos'
import type { CamposPozos, LecturaPozos } from '../lib/tiposPozos'

let revisionConsulta = 0
let revisionAccion = 0
let consultaActiva: AbortController | null = null
let accionActiva: AbortController | null = null

function contextoDesdeAuth(auth: ReturnType<typeof useAuthStore.getState>): ContextoCuentaPozos | null {
  const { estado, sesion, perfil } = auth
  if (estado !== 'autenticado' || !sesion || !perfil || perfil.activo !== true
    || perfil.id !== sesion.user.id || (perfil.rol !== 'calderas' && perfil.rol !== 'admin')) return null
  return { cuentaId: perfil.id, rol: perfil.rol }
}

export function obtenerContextoPozos(): ContextoCuentaPozos | null {
  return contextoDesdeAuth(useAuthStore.getState())
}

function sigueLaCuenta(contexto: ContextoCuentaPozos): boolean {
  const actual = obtenerContextoPozos()
  return actual?.cuentaId === contexto.cuentaId && actual.rol === contexto.rol
}

function cacheDeLaCuenta(contexto: ContextoCuentaPozos): boolean {
  const datos = usePozosStore.getState()
  return datos.cuentaId === contexto.cuentaId && datos.rol === contexto.rol
}

function turnoActual(contexto: ContextoCuentaPozos) {
  const datos = useTurnoStore.getState()
  if (contexto.rol !== 'calderas' || datos.cuentaId !== contexto.cuentaId
    || datos.area !== 'calderas' || datos.estadoCarga !== 'listo') return null
  const turno = datos.turno
  return turno?.area === 'calderas' && turno.finalizado_en === null ? turno : null
}

function idTurnoActual(contexto: ContextoCuentaPozos): string | null {
  return turnoActual(contexto)?.id ?? null
}

function cancelarConsulta(): void {
  revisionConsulta += 1
  consultaActiva?.abort()
  consultaActiva = null
}

export function cancelarGestionPozos(): void {
  cancelarConsulta()
  revisionAccion += 1
  accionActiva?.abort()
  accionActiva = null
  usePozosStore.getState().limpiar()
}

async function conLimite<T>(
  tarea: () => Promise<T>, control: AbortController, espera: number, mutacion = false,
): Promise<T> {
  let temporizador: number | null = null
  let alCancelar: (() => void) | null = null
  const limite = new Promise<never>((_resolver, rechazar) => {
    alCancelar = () => rechazar(new ErrorPozos('La operación se canceló. Actualiza antes de continuar.', mutacion))
    control.signal.addEventListener('abort', alCancelar, { once: true })
    if (control.signal.aborted) alCancelar()
    temporizador = window.setTimeout(() => {
      rechazar(new ErrorPozos(mutacion
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

export async function actualizarDatosPozos(): Promise<void> {
  const contexto = obtenerContextoPozos()
  if (!contexto) {
    cancelarGestionPozos()
    return
  }
  if (!cacheDeLaCuenta(contexto)) cancelarGestionPozos()
  const anteriores = usePozosStore.getState()
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
      turnoId ? consultarLecturaPozos(turnoId, control.signal) : Promise.resolve(null),
      consultarHistorialPozos(control.signal),
    ]), control, 15000)
    if (revision !== revisionConsulta || !sigueLaCuenta(contexto)
      || idTurnoActual(contexto) !== turnoId) return
    const actuales = usePozosStore.getState()
    actuales.establecerEstado({ ...actuales, lecturaActual, historial, estadoCarga: 'listo', mensaje: null })
  } catch (fallo) {
    if (revision !== revisionConsulta || !sigueLaCuenta(contexto)
      || idTurnoActual(contexto) !== turnoId) return
    const actuales = usePozosStore.getState()
    actuales.establecerEstado({
      ...actuales, lecturaActual: null, historial: [], estadoCarga: 'error',
      mensaje: fallo instanceof ErrorPozos ? fallo.message : 'No se pudo consultar Pozos. Reintenta.',
    })
  } finally {
    if (consultaActiva === control) consultaActiva = null
    control.abort()
  }
}

// El componente ControlPozos llamará a esto al cambiar cuenta o turno.
export function sincronizarContextoPozos(): void {
  const contexto = obtenerContextoPozos()
  if (!contexto) {
    cancelarGestionPozos()
    return
  }
  if (!cacheDeLaCuenta(contexto)) {
    cancelarGestionPozos()
    void actualizarDatosPozos()
    return
  }
  const datos = usePozosStore.getState()
  if (!datos.guardando && (datos.estadoCarga === 'sin-cuenta'
    || datos.turnoConsultadoId !== idTurnoActual(contexto))) void actualizarDatosPozos()
}

function mostrarFalloAccion(mensaje: string): false {
  const actuales = usePozosStore.getState()
  actuales.establecerEstado({ ...actuales, mensajeAccion: mensaje })
  return false
}

function prepararAccionNueva(): ContextoCuentaPozos | null {
  const contexto = obtenerContextoPozos()
  if (!contexto || contexto.rol !== 'calderas' || !cacheDeLaCuenta(contexto)) return null
  const datos = usePozosStore.getState()
  if (datos.guardando) return null
  if (datos.solicitudPendiente) {
    mostrarFalloAccion('Hay un guardado sin confirmar. Reintenta esa misma solicitud antes de hacer otra.')
    return null
  }
  if (datos.estadoCarga !== 'listo' || datos.turnoConsultadoId !== idTurnoActual(contexto)) {
    mostrarFalloAccion('Actualiza la información de Pozos antes de continuar.')
    return null
  }
  const turnos = useTurnoStore.getState()
  if (turnos.accionEnCurso || turnos.solicitudPendiente) {
    mostrarFalloAccion('Confirma la operación del turno antes de guardar Pozos.')
    return null
  }
  return contexto
}

function mismaLectura(a: LecturaPozos, b: LecturaPozos): boolean {
  return a.id === b.id && a.turno_id === b.turno_id && a.creado_por === b.creado_por
    && a.capturado_en === b.capturado_en && a.recibido_en === b.recibido_en
    && a.pozo1_ini === b.pozo1_ini && a.pozo1_fin === b.pozo1_fin
    && a.pozo2_ini === b.pozo2_ini && a.pozo2_fin === b.pozo2_fin
    && a.notas === b.notas && a.eliminado_en === null && b.eliminado_en === null
    && a.eliminado_por === null && b.eliminado_por === null
}

function originalConsultado(contexto: ContextoCuentaPozos, original: LecturaPozos): boolean {
  const datos = usePozosStore.getState()
  const registros = datos.lecturaActual ? [datos.lecturaActual, ...datos.historial] : datos.historial
  return original.creado_por === contexto.cuentaId && registros.some((registro) =>
    registro.turno.area === 'calderas' && registro.turno.iniciado_por === contexto.cuentaId
    && mismaLectura(registro.lectura, original))
}

function congelarSolicitud(pendiente: SolicitudPendientePozos): SolicitudPendientePozos {
  return Object.freeze({
    contexto: Object.freeze({ ...pendiente.contexto }),
    solicitud: Object.freeze({
      ...pendiente.solicitud,
      valores: Object.freeze({ ...pendiente.solicitud.valores }),
      original: pendiente.solicitud.original ? Object.freeze({ ...pendiente.solicitud.original }) : null,
    }),
  })
}

async function ejecutarAccion(pendiente: SolicitudPendientePozos): Promise<boolean> {
  if (pendiente.contexto.rol !== 'calderas' || !sigueLaCuenta(pendiente.contexto)
    || !cacheDeLaCuenta(pendiente.contexto) || usePozosStore.getState().guardando) return false
  cancelarConsulta()
  revisionAccion += 1
  const revision = revisionAccion
  const control = new AbortController()
  accionActiva = control
  const anteriores = usePozosStore.getState()
  anteriores.establecerEstado({ ...anteriores, guardando: true, solicitudPendiente: pendiente, mensajeAccion: null })
  try {
    await conLimite(() => guardarLecturaPozos(pendiente.contexto.cuentaId,
      pendiente.solicitud, control.signal), control, 25000, true)
    if (revision !== revisionAccion || !sigueLaCuenta(pendiente.contexto)) return false
    const actuales = usePozosStore.getState()
    actuales.establecerEstado({
      ...actuales, guardando: false, solicitudPendiente: null,
      mensajeAccion: pendiente.solicitud.original ? 'Corrección de Pozos confirmada.' : 'Lectura de Pozos guardada.',
    })
    // Recuperar el estado real: un reintento puede confirmar una captura de un turno ya cerrado.
    await actualizarDatosPozos()
    return revision === revisionAccion && sigueLaCuenta(pendiente.contexto)
  } catch (fallo) {
    if (revision !== revisionAccion || !sigueLaCuenta(pendiente.contexto)) return false
    const incierto = !(fallo instanceof ErrorPozos) || fallo.resultadoIncierto
    const actuales = usePozosStore.getState()
    actuales.establecerEstado({
      ...actuales, guardando: false, solicitudPendiente: incierto ? pendiente : null,
      mensajeAccion: fallo instanceof ErrorPozos ? fallo.message : 'No llegó la confirmación. Reintenta la misma solicitud.',
    })
    await actualizarDatosPozos()
    return false
  } finally {
    if (accionActiva === control) accionActiva = null
    control.abort()
  }
}

async function guardarPozos(campos: CamposPozos): Promise<boolean> {
  const contexto = prepararAccionNueva()
  if (!contexto) return false
  const turno = turnoActual(contexto)
  if (!turno || turno.iniciado_por !== contexto.cuentaId) {
    return mostrarFalloAccion('Inicia tu turno de Calderas antes de guardar una lectura nueva.')
  }
  const datos = usePozosStore.getState()
  if (datos.lecturaActual || datos.historial.some((registro) => registro.lectura.turno_id === turno.id)) {
    return mostrarFalloAccion('Ese turno ya tiene una lectura de Pozos. Usa la opción de corregir.')
  }
  let pendiente: SolicitudPendientePozos
  try {
    const valores = validarCamposPozos(campos)
    pendiente = congelarSolicitud({ contexto, solicitud: { id: crypto.randomUUID(), turnoId: turno.id, valores, original: null } })
  } catch (fallo) {
    return mostrarFalloAccion(fallo instanceof ErrorPozos ? fallo.message : 'No se pudo preparar la captura. Intenta de nuevo.')
  }
  return ejecutarAccion(pendiente)
}

async function corregirPozos(campos: CamposPozos, original: LecturaPozos): Promise<boolean> {
  const contexto = prepararAccionNueva()
  if (!contexto) return false
  if (!originalConsultado(contexto, original)) {
    return mostrarFalloAccion('La lectura original cambió o no pertenece a esta cuenta. Actualiza antes de corregir.')
  }
  let pendiente: SolicitudPendientePozos
  try {
    const valores = validarCamposPozos(campos)
    pendiente = congelarSolicitud({ contexto, solicitud: { id: original.id, turnoId: original.turno_id, valores, original } })
  } catch (fallo) {
    return mostrarFalloAccion(fallo instanceof ErrorPozos ? fallo.message : 'No se pudo preparar la corrección. Intenta de nuevo.')
  }
  // El servidor comprueba la hora desde la captura original, también en turnos cerrados.
  return ejecutarAccion(pendiente)
}

async function reintentarGuardadoPozos(): Promise<boolean> {
  const pendiente = usePozosStore.getState().solicitudPendiente
  return pendiente ? ejecutarAccion(pendiente) : false
}

export function usePozos() {
  const auth = useAuthStore()
  const datos = usePozosStore()
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
    turno,
    lecturaActual: mismaVista ? datos.lecturaActual : null,
    historial: mismaVista ? datos.historial : [],
    estadoCarga: mismaVista ? datos.estadoCarga : contexto ? 'cargando' as const : 'sin-cuenta' as const,
    mensaje: mismaVista ? datos.mensaje : null,
    guardando: mismaCuenta ? datos.guardando : false,
    solicitudPendiente: mismaCuenta ? datos.solicitudPendiente : null,
    mensajeAccion: mismaCuenta ? datos.mensajeAccion : null,
    puedeCrear: contexto?.rol === 'calderas' && !bloqueado && turno !== null
      && turno.iniciado_por === contexto.cuentaId && datos.lecturaActual === null
      && !datos.historial.some((registro) => registro.lectura.turno_id === turno.id),
    puedeCorregir: (original: LecturaPozos): boolean => contexto?.rol === 'calderas'
      && !bloqueado && originalConsultado(contexto, original),
    guardarPozos, corregirPozos, reintentarGuardadoPozos,
    actualizarPozos: actualizarDatosPozos,
  }
}
