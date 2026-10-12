import { useAuthStore } from '../stores/authStore'
import { useTurnoStore } from '../stores/turnoStore'
import { useCalidadStore } from '../stores/calidadStore'
import type { ContextoCuentaCalidad, SolicitudPendienteCalidad } from '../stores/calidadStore'
import {
  consultarHistorialCalidad, consultarLecturaCalidad, consultarCatalogosCalidad, ErrorCalidad,
  originalCalidad,
  guardarLecturaCalidad, validarCamposCalidad,
} from '../lib/calidad'
import type { AreaOperativa } from '../lib/tiposTurno'
import type { CamposCalidad, LecturaCalidad, ValoresCalidad } from '../lib/tiposCalidad'

let revisionConsulta = 0
let revisionAccion = 0
let consultaActiva: AbortController | null = null
let accionActiva: AbortController | null = null

function contextoDesdeAuth(auth: ReturnType<typeof useAuthStore.getState>): ContextoCuentaCalidad | null {
  const { estado, sesion, perfil } = auth
  if (estado !== 'autenticado' || !sesion || !perfil || perfil.activo !== true
    || perfil.id !== sesion.user.id || (perfil.rol !== 'calderas' && perfil.rol !== 'ptar' && perfil.rol !== 'admin')) return null
  return { cuentaId: perfil.id, rol: perfil.rol }
}

export function obtenerContextoCalidad(): ContextoCuentaCalidad | null {
  return contextoDesdeAuth(useAuthStore.getState())
}

function sigueLaCuenta(contexto: ContextoCuentaCalidad): boolean {
  const actual = obtenerContextoCalidad()
  return actual?.cuentaId === contexto.cuentaId && actual.rol === contexto.rol
}

function cacheDeLaCuenta(contexto: ContextoCuentaCalidad): boolean {
  const datos = useCalidadStore.getState()
  return datos.cuentaId === contexto.cuentaId && datos.rol === contexto.rol
}

function turnoActual(contexto: ContextoCuentaCalidad) {
  const datos = useTurnoStore.getState()
  if (contexto.rol === 'admin' || datos.cuentaId !== contexto.cuentaId
    || datos.area !== contexto.rol || datos.estadoCarga !== 'listo') return null
  const turno = datos.turno
  return turno?.area === contexto.rol && turno.finalizado_en === null ? turno : null
}

function idTurnoActual(contexto: ContextoCuentaCalidad): string | null {
  return turnoActual(contexto)?.id ?? null
}

function cancelarConsulta(): void {
  revisionConsulta += 1
  consultaActiva?.abort()
  consultaActiva = null
}

export function cancelarGestionCalidad(): void {
  cancelarConsulta()
  revisionAccion += 1
  accionActiva?.abort()
  accionActiva = null
  useCalidadStore.getState().limpiar()
}

async function conLimite<T>(
  tarea: () => Promise<T>, control: AbortController, espera: number, mutacion = false,
): Promise<T> {
  let temporizador: number | null = null
  let alCancelar: (() => void) | null = null
  const limite = new Promise<never>((_resolver, rechazar) => {
    alCancelar = () => rechazar(new ErrorCalidad('La operación se canceló. Actualiza antes de continuar.', mutacion))
    control.signal.addEventListener('abort', alCancelar, { once: true })
    if (control.signal.aborted) alCancelar()
    temporizador = window.setTimeout(() => {
      rechazar(new ErrorCalidad(mutacion
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

export async function actualizarDatosCalidad(): Promise<void> {
  const contexto = obtenerContextoCalidad()
  if (!contexto) {
    cancelarGestionCalidad()
    return
  }
  if (!cacheDeLaCuenta(contexto)) cancelarGestionCalidad()
  const anteriores = useCalidadStore.getState()
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
    const [lecturaActual, historial, catalogos] = await conLimite(() => Promise.all([
      turnoId ? consultarLecturaCalidad(turnoId, control.signal) : Promise.resolve(null),
      consultarHistorialCalidad(control.signal), consultarCatalogosCalidad(control.signal),
    ]), control, 15000)
    if (revision !== revisionConsulta || !sigueLaCuenta(contexto)
      || idTurnoActual(contexto) !== turnoId) return
    const actuales = useCalidadStore.getState()
    actuales.establecerEstado({ ...actuales, lecturaActual, historial, catalogos, estadoCarga: 'listo', mensaje: null })
  } catch (fallo) {
    if (revision !== revisionConsulta || !sigueLaCuenta(contexto)
      || idTurnoActual(contexto) !== turnoId) return
    const actuales = useCalidadStore.getState()
    actuales.establecerEstado({
      ...actuales, lecturaActual: null, historial: [], estadoCarga: 'error',
      mensaje: fallo instanceof ErrorCalidad ? fallo.message : 'No se pudo consultar Calidad. Reintenta.',
    })
  } finally {
    if (consultaActiva === control) consultaActiva = null
    control.abort()
  }
}

// El componente ControlCalidad llamará a esto al cambiar cuenta o turno.
export function sincronizarContextoCalidad(): void {
  const contexto = obtenerContextoCalidad()
  if (!contexto) {
    cancelarGestionCalidad()
    return
  }
  if (!cacheDeLaCuenta(contexto)) {
    cancelarGestionCalidad()
    void actualizarDatosCalidad()
    return
  }
  const datos = useCalidadStore.getState()
  if (!datos.guardando && (datos.estadoCarga === 'sin-cuenta'
    || datos.turnoConsultadoId !== idTurnoActual(contexto))) void actualizarDatosCalidad()
}

function mostrarFalloAccion(mensaje: string): false {
  const actuales = useCalidadStore.getState()
  actuales.establecerEstado({ ...actuales, mensajeAccion: mensaje })
  return false
}

function prepararAccionNueva(): ContextoCuentaCalidad | null {
  const contexto = obtenerContextoCalidad()
  if (!contexto || contexto.rol === 'admin' || !cacheDeLaCuenta(contexto)) return null
  const datos = useCalidadStore.getState()
  if (datos.guardando) return null
  if (datos.solicitudPendiente) {
    mostrarFalloAccion('Hay un guardado sin confirmar. Reintenta esa misma solicitud antes de hacer otra.')
    return null
  }
  if (datos.estadoCarga !== 'listo' || datos.turnoConsultadoId !== idTurnoActual(contexto)) {
    mostrarFalloAccion('Actualiza la información de Calidad antes de continuar.')
    return null
  }
  const turnos = useTurnoStore.getState()
  if (turnos.accionEnCurso || turnos.solicitudPendiente) {
    mostrarFalloAccion('Confirma la operación del turno antes de guardar Calidad.')
    return null
  }
  return contexto
}

function mismaLectura(a: LecturaCalidad, b: LecturaCalidad): boolean {
  return a.id === b.id && a.turno_id === b.turno_id && a.creado_por === b.creado_por
    && a.capturado_en === b.capturado_en && a.recibido_en === b.recibido_en
    && JSON.stringify(originalCalidad(a)) === JSON.stringify(originalCalidad(b))
    && a.notas === b.notas && a.eliminado_en === null && b.eliminado_en === null
    && a.eliminado_por === null && b.eliminado_por === null
}

function originalConsultado(contexto: ContextoCuentaCalidad, original: LecturaCalidad): boolean {
  const datos = useCalidadStore.getState()
  const registros = datos.lecturaActual ? [datos.lecturaActual, ...datos.historial] : datos.historial
  return original.creado_por === contexto.cuentaId && registros.some((registro) =>
    registro.turno.area === contexto.rol && registro.turno.iniciado_por === contexto.cuentaId
    && mismaLectura(registro.lectura, original))
}

function congelarSolicitud(pendiente: SolicitudPendienteCalidad): SolicitudPendienteCalidad {
  return Object.freeze({
    contexto: Object.freeze({ ...pendiente.contexto }),
    solicitud: Object.freeze({
      ...pendiente.solicitud,
      valores: Object.freeze({ ...pendiente.solicitud.valores, resultados: Object.freeze(pendiente.solicitud.valores.resultados.map(r => Object.freeze({ ...r }))) }),
      original: pendiente.solicitud.original ? Object.freeze({ ...pendiente.solicitud.original, resultados: Object.freeze(pendiente.solicitud.original.resultados.map(r => Object.freeze({ ...r, punto: Object.freeze({ ...r.punto }), parametro: Object.freeze({ ...r.parametro }) }))) }) : null,
    }),
  })
}

async function ejecutarAccion(pendiente: SolicitudPendienteCalidad): Promise<boolean> {
  if (pendiente.contexto.rol === 'admin' || !sigueLaCuenta(pendiente.contexto)
    || !cacheDeLaCuenta(pendiente.contexto) || useCalidadStore.getState().guardando) return false
  cancelarConsulta()
  revisionAccion += 1
  const revision = revisionAccion
  const control = new AbortController()
  accionActiva = control
  const anteriores = useCalidadStore.getState()
  anteriores.establecerEstado({ ...anteriores, guardando: true, solicitudPendiente: pendiente, mensajeAccion: null })
  try {
    await conLimite(() => guardarLecturaCalidad(pendiente.contexto.cuentaId,
      pendiente.solicitud, control.signal), control, 25000, true)
    if (revision !== revisionAccion || !sigueLaCuenta(pendiente.contexto)) return false
    const actuales = useCalidadStore.getState()
    actuales.establecerEstado({
      ...actuales, guardando: false, solicitudPendiente: null,
      mensajeAccion: pendiente.solicitud.original ? 'Corrección de Calidad confirmada.' : 'Lectura de Calidad guardada.',
    })
    // Recuperar el estado real: un reintento puede confirmar una captura de un turno ya cerrado.
    await actualizarDatosCalidad()
    return revision === revisionAccion && sigueLaCuenta(pendiente.contexto)
  } catch (fallo) {
    if (revision !== revisionAccion || !sigueLaCuenta(pendiente.contexto)) return false
    const incierto = !(fallo instanceof ErrorCalidad) || fallo.resultadoIncierto
    const actuales = useCalidadStore.getState()
    actuales.establecerEstado({
      ...actuales, guardando: false, solicitudPendiente: incierto ? pendiente : null,
      mensajeAccion: fallo instanceof ErrorCalidad ? fallo.message : 'No llegó la confirmación. Reintenta la misma solicitud.',
    })
    await actualizarDatosCalidad()
    return false
  } finally {
    if (accionActiva === control) accionActiva = null
    control.abort()
  }
}


function prepararValores(campos: CamposCalidad, contexto: ContextoCuentaCalidad, original?: LecturaCalidad): ValoresCalidad {
  const valores = validarCamposCalidad(campos)
  const catalogos = useCalidadStore.getState().catalogos
  if (original && valores.resultados.length !== original.resultados.length) throw new ErrorCalidad('La corrección conserva todos los resultados originales.')
  return { ...valores, resultados: valores.resultados.map(r => {
    const anterior = original?.resultados.find(p => p.punto_id === r.punto_id && p.parametro_id === r.parametro_id)
    if (original ? !anterior : !catalogos.puntos.some(p => p.id === r.punto_id && p.activo && (p.area === null || p.area === contexto.rol))
      || !catalogos.parametros.some(p => p.id === r.parametro_id && p.activo)) throw new ErrorCalidad('Revisa los puntos y parámetros disponibles para tu área.')
    return { ...r, id: anterior?.id ?? crypto.randomUUID() }
  }) }
}

async function guardarCalidad(campos: CamposCalidad): Promise<boolean> {
  const contexto = prepararAccionNueva()
  if (!contexto) return false
  const turno = turnoActual(contexto)
  if (!turno || turno.iniciado_por !== contexto.cuentaId) {
    return mostrarFalloAccion('Inicia tu turno del área antes de guardar una muestra nueva.')
  }
  let pendiente: SolicitudPendienteCalidad
  try {
    const valores = prepararValores(campos, contexto)
    pendiente = congelarSolicitud({ contexto, solicitud: { id: crypto.randomUUID(), turnoId: turno.id, valores, original: null } })
  } catch (fallo) {
    return mostrarFalloAccion(fallo instanceof ErrorCalidad ? fallo.message : 'No se pudo preparar la captura. Intenta de nuevo.')
  }
  return ejecutarAccion(pendiente)
}

async function corregirCalidad(campos: CamposCalidad, original: LecturaCalidad): Promise<boolean> {
  const contexto = prepararAccionNueva()
  if (!contexto) return false
  if (!originalConsultado(contexto, original)) {
    return mostrarFalloAccion('La lectura original cambió o no pertenece a esta cuenta. Actualiza antes de corregir.')
  }
  let pendiente: SolicitudPendienteCalidad
  try {
    const valores = prepararValores(campos, contexto, original)
    pendiente = congelarSolicitud({ contexto, solicitud: { id: original.id, turnoId: original.turno_id, valores, original } })
  } catch (fallo) {
    return mostrarFalloAccion(fallo instanceof ErrorCalidad ? fallo.message : 'No se pudo preparar la corrección. Intenta de nuevo.')
  }
  // El servidor comprueba la hora desde la captura original, también en turnos cerrados.
  return ejecutarAccion(pendiente)
}

async function reintentarGuardadoCalidad(): Promise<boolean> {
  const pendiente = useCalidadStore.getState().solicitudPendiente
  return pendiente ? ejecutarAccion(pendiente) : false
}

export function useCalidad(area: AreaOperativa) {
  const auth = useAuthStore()
  const datos = useCalidadStore()
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
    catalogos: mismaCuenta ? datos.catalogos : { puntos: [], parametros: [] },
    lecturaActual: mismaVista && datos.lecturaActual?.turno.area === area ? datos.lecturaActual : null,
    historial: mismaVista ? datos.historial.filter(r => r.turno.area === area) : [],
    estadoCarga: mismaVista ? datos.estadoCarga : contexto ? 'cargando' as const : 'sin-cuenta' as const,
    mensaje: mismaVista ? datos.mensaje : null,
    guardando: mismaCuenta ? datos.guardando : false,
    solicitudPendiente: mismaCuenta ? datos.solicitudPendiente : null,
    mensajeAccion: mismaCuenta ? datos.mensajeAccion : null,
    puedeCrear: contexto?.rol === area && !bloqueado && turno !== null && turno.area === area
      && turno.iniciado_por === contexto.cuentaId,
    puedeCorregir: (original: LecturaCalidad): boolean => contexto?.rol === area
      && !bloqueado && originalConsultado(contexto, original),
    guardarCalidad, corregirCalidad, reintentarGuardadoCalidad,
    actualizarCalidad: actualizarDatosCalidad,
  }
}
