import { useAuthStore } from '../stores/authStore'
import { useTurnoStore } from '../stores/turnoStore'
import { useUFStore } from '../stores/ufStore'
import type { ContextoCuentaUF, SolicitudPendienteUF } from '../stores/ufStore'
import {
  consultarHistorialUF, consultarLecturaUF, ErrorUF,
  guardarLecturaUF, validarCamposUF,
} from '../lib/uf'
import type { CamposUF, LecturaUF } from '../lib/tiposUF'

let revisionConsulta = 0
let revisionAccion = 0
let consultaActiva: AbortController | null = null
let accionActiva: AbortController | null = null

function contextoDesdeAuth(auth: ReturnType<typeof useAuthStore.getState>): ContextoCuentaUF | null {
  const { estado, sesion, perfil } = auth
  if (estado !== 'autenticado' || !sesion || !perfil || perfil.activo !== true
    || perfil.id !== sesion.user.id || (perfil.rol !== 'calderas' && perfil.rol !== 'admin')) return null
  return { cuentaId: perfil.id, rol: perfil.rol }
}

export function obtenerContextoUF(): ContextoCuentaUF | null {
  return contextoDesdeAuth(useAuthStore.getState())
}

function sigueLaCuenta(contexto: ContextoCuentaUF): boolean {
  const actual = obtenerContextoUF()
  return actual?.cuentaId === contexto.cuentaId && actual.rol === contexto.rol
}

function cacheDeLaCuenta(contexto: ContextoCuentaUF): boolean {
  const datos = useUFStore.getState()
  return datos.cuentaId === contexto.cuentaId && datos.rol === contexto.rol
}

function turnoActual(contexto: ContextoCuentaUF) {
  const datos = useTurnoStore.getState()
  if (contexto.rol !== 'calderas' || datos.cuentaId !== contexto.cuentaId
    || datos.area !== 'calderas' || datos.estadoCarga !== 'listo') return null
  const turno = datos.turno
  return turno?.area === 'calderas' && turno.finalizado_en === null ? turno : null
}

function idTurnoActual(contexto: ContextoCuentaUF): string | null {
  return turnoActual(contexto)?.id ?? null
}

function cancelarConsulta(): void {
  revisionConsulta += 1
  consultaActiva?.abort()
  consultaActiva = null
}

export function cancelarGestionUF(): void {
  cancelarConsulta()
  revisionAccion += 1
  accionActiva?.abort()
  accionActiva = null
  useUFStore.getState().limpiar()
}

async function conLimite<T>(
  tarea: () => Promise<T>, control: AbortController, espera: number, mutacion = false,
): Promise<T> {
  let temporizador: number | null = null
  let alCancelar: (() => void) | null = null
  const limite = new Promise<never>((_resolver, rechazar) => {
    alCancelar = () => rechazar(new ErrorUF('La operación se canceló. Actualiza antes de continuar.', mutacion))
    control.signal.addEventListener('abort', alCancelar, { once: true })
    if (control.signal.aborted) alCancelar()
    temporizador = window.setTimeout(() => {
      rechazar(new ErrorUF(mutacion
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

export async function actualizarDatosUF(): Promise<void> {
  const contexto = obtenerContextoUF()
  if (!contexto) {
    cancelarGestionUF()
    return
  }
  if (!cacheDeLaCuenta(contexto)) cancelarGestionUF()
  const anteriores = useUFStore.getState()
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
      turnoId ? consultarLecturaUF(turnoId, control.signal) : Promise.resolve(null),
      consultarHistorialUF(control.signal),
    ]), control, 15000)
    if (revision !== revisionConsulta || !sigueLaCuenta(contexto)
      || idTurnoActual(contexto) !== turnoId) return
    const actuales = useUFStore.getState()
    actuales.establecerEstado({ ...actuales, lecturaActual, historial, estadoCarga: 'listo', mensaje: null })
  } catch (fallo) {
    if (revision !== revisionConsulta || !sigueLaCuenta(contexto)
      || idTurnoActual(contexto) !== turnoId) return
    const actuales = useUFStore.getState()
    actuales.establecerEstado({
      ...actuales, lecturaActual: null, historial: [], estadoCarga: 'error',
      mensaje: fallo instanceof ErrorUF ? fallo.message : 'No se pudo consultar UF. Reintenta.',
    })
  } finally {
    if (consultaActiva === control) consultaActiva = null
    control.abort()
  }
}

// El componente ControlUF llamará a esto al cambiar cuenta o turno.
export function sincronizarContextoUF(): void {
  const contexto = obtenerContextoUF()
  if (!contexto) {
    cancelarGestionUF()
    return
  }
  if (!cacheDeLaCuenta(contexto)) {
    cancelarGestionUF()
    void actualizarDatosUF()
    return
  }
  const datos = useUFStore.getState()
  if (!datos.guardando && (datos.estadoCarga === 'sin-cuenta'
    || datos.turnoConsultadoId !== idTurnoActual(contexto))) void actualizarDatosUF()
}

function mostrarFalloAccion(mensaje: string): false {
  const actuales = useUFStore.getState()
  actuales.establecerEstado({ ...actuales, mensajeAccion: mensaje })
  return false
}

function prepararAccionNueva(): ContextoCuentaUF | null {
  const contexto = obtenerContextoUF()
  if (!contexto || contexto.rol !== 'calderas' || !cacheDeLaCuenta(contexto)) return null
  const datos = useUFStore.getState()
  if (datos.guardando) return null
  if (datos.solicitudPendiente) {
    mostrarFalloAccion('Hay un guardado sin confirmar. Reintenta esa misma solicitud antes de hacer otra.')
    return null
  }
  if (datos.estadoCarga !== 'listo' || datos.turnoConsultadoId !== idTurnoActual(contexto)) {
    mostrarFalloAccion('Actualiza la información de UF antes de continuar.')
    return null
  }
  const turnos = useTurnoStore.getState()
  if (turnos.accionEnCurso || turnos.solicitudPendiente) {
    mostrarFalloAccion('Confirma la operación del turno antes de guardar UF.')
    return null
  }
  return contexto
}

function mismaLectura(a: LecturaUF, b: LecturaUF): boolean {
  return a.id === b.id && a.turno_id === b.turno_id && a.creado_por === b.creado_por
    && a.capturado_en === b.capturado_en && a.recibido_en === b.recibido_en
    && a.alim_ini === b.alim_ini && a.alim_fin === b.alim_fin
    && a.acep_ini === b.acep_ini && a.acep_fin === b.acep_fin
    && a.notas === b.notas && a.eliminado_en === null && b.eliminado_en === null
    && a.eliminado_por === null && b.eliminado_por === null
}

function originalConsultado(contexto: ContextoCuentaUF, original: LecturaUF): boolean {
  const datos = useUFStore.getState()
  const registros = datos.lecturaActual ? [datos.lecturaActual, ...datos.historial] : datos.historial
  return original.creado_por === contexto.cuentaId && registros.some((registro) =>
    registro.turno.area === 'calderas' && registro.turno.iniciado_por === contexto.cuentaId
    && mismaLectura(registro.lectura, original))
}

function congelarSolicitud(pendiente: SolicitudPendienteUF): SolicitudPendienteUF {
  return Object.freeze({
    contexto: Object.freeze({ ...pendiente.contexto }),
    solicitud: Object.freeze({
      ...pendiente.solicitud,
      valores: Object.freeze({ ...pendiente.solicitud.valores }),
      original: pendiente.solicitud.original ? Object.freeze({ ...pendiente.solicitud.original }) : null,
    }),
  })
}

async function ejecutarAccion(pendiente: SolicitudPendienteUF): Promise<boolean> {
  if (pendiente.contexto.rol !== 'calderas' || !sigueLaCuenta(pendiente.contexto)
    || !cacheDeLaCuenta(pendiente.contexto) || useUFStore.getState().guardando) return false
  cancelarConsulta()
  revisionAccion += 1
  const revision = revisionAccion
  const control = new AbortController()
  accionActiva = control
  const anteriores = useUFStore.getState()
  anteriores.establecerEstado({ ...anteriores, guardando: true, solicitudPendiente: pendiente, mensajeAccion: null })
  try {
    await conLimite(() => guardarLecturaUF(pendiente.contexto.cuentaId,
      pendiente.solicitud, control.signal), control, 25000, true)
    if (revision !== revisionAccion || !sigueLaCuenta(pendiente.contexto)) return false
    const actuales = useUFStore.getState()
    actuales.establecerEstado({
      ...actuales, guardando: false, solicitudPendiente: null,
      mensajeAccion: pendiente.solicitud.original ? 'Corrección de UF confirmada.' : 'Lectura de UF guardada.',
    })
    // Recuperar el estado real: un reintento puede confirmar una captura de un turno ya cerrado.
    await actualizarDatosUF()
    return revision === revisionAccion && sigueLaCuenta(pendiente.contexto)
  } catch (fallo) {
    if (revision !== revisionAccion || !sigueLaCuenta(pendiente.contexto)) return false
    const incierto = !(fallo instanceof ErrorUF) || fallo.resultadoIncierto
    const actuales = useUFStore.getState()
    actuales.establecerEstado({
      ...actuales, guardando: false, solicitudPendiente: incierto ? pendiente : null,
      mensajeAccion: fallo instanceof ErrorUF ? fallo.message : 'No llegó la confirmación. Reintenta la misma solicitud.',
    })
    await actualizarDatosUF()
    return false
  } finally {
    if (accionActiva === control) accionActiva = null
    control.abort()
  }
}

async function guardarUF(campos: CamposUF): Promise<boolean> {
  const contexto = prepararAccionNueva()
  if (!contexto) return false
  const turno = turnoActual(contexto)
  if (!turno || turno.iniciado_por !== contexto.cuentaId) {
    return mostrarFalloAccion('Inicia tu turno de Calderas antes de guardar una lectura nueva.')
  }
  const datos = useUFStore.getState()
  if (datos.lecturaActual || datos.historial.some((registro) => registro.lectura.turno_id === turno.id)) {
    return mostrarFalloAccion('Ese turno ya tiene una lectura de UF. Usa la opción de corregir.')
  }
  let pendiente: SolicitudPendienteUF
  try {
    const valores = validarCamposUF(campos)
    pendiente = congelarSolicitud({ contexto, solicitud: { id: crypto.randomUUID(), turnoId: turno.id, valores, original: null } })
  } catch (fallo) {
    return mostrarFalloAccion(fallo instanceof ErrorUF ? fallo.message : 'No se pudo preparar la captura. Intenta de nuevo.')
  }
  return ejecutarAccion(pendiente)
}

async function corregirUF(campos: CamposUF, original: LecturaUF): Promise<boolean> {
  const contexto = prepararAccionNueva()
  if (!contexto) return false
  if (!originalConsultado(contexto, original)) {
    return mostrarFalloAccion('La lectura original cambió o no pertenece a esta cuenta. Actualiza antes de corregir.')
  }
  let pendiente: SolicitudPendienteUF
  try {
    const valores = validarCamposUF(campos)
    pendiente = congelarSolicitud({ contexto, solicitud: { id: original.id, turnoId: original.turno_id, valores, original } })
  } catch (fallo) {
    return mostrarFalloAccion(fallo instanceof ErrorUF ? fallo.message : 'No se pudo preparar la corrección. Intenta de nuevo.')
  }
  // El servidor comprueba la hora desde la captura original, también en turnos cerrados.
  return ejecutarAccion(pendiente)
}

async function reintentarGuardadoUF(): Promise<boolean> {
  const pendiente = useUFStore.getState().solicitudPendiente
  return pendiente ? ejecutarAccion(pendiente) : false
}

export function useUF() {
  const auth = useAuthStore()
  const datos = useUFStore()
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
    puedeCorregir: (original: LecturaUF): boolean => contexto?.rol === 'calderas'
      && !bloqueado && originalConsultado(contexto, original),
    guardarUF, corregirUF, reintentarGuardadoUF,
    actualizarUF: actualizarDatosUF,
  }
}
