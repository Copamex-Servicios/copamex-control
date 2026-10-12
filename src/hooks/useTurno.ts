import { useAuthStore } from '../stores/authStore'
import { useTurnoStore } from '../stores/turnoStore'
import type { SolicitudPendienteTurno } from '../stores/turnoStore'
import {
  cerrarTurno as guardarCierreTurno,
  consultarDatosTurno,
  ErrorTurnos,
  esTipoTurno,
  iniciarTurno as guardarInicioTurno,
  normalizarNombreOperador,
} from '../lib/turnos'
import type { ContextoCuentaTurno, SolicitudInicioTurno } from '../lib/turnos'

export type CamposInicioTurno = Pick<SolicitudInicioTurno,
  'tipoTurno' | 'nombreOperador' | 'operadorId' | 'numeroEmpleado'>

let revisionConsulta = 0
let revisionAccion = 0
let consultaActiva: AbortController | null = null
let accionActiva: AbortController | null = null

function contextoDesdeAuth(auth: ReturnType<typeof useAuthStore.getState>): ContextoCuentaTurno | null {
  const { estado, sesion, perfil } = auth
  if (estado !== 'autenticado' || !sesion || !perfil || perfil.activo !== true
    || perfil.id !== sesion.user.id || (perfil.rol !== 'calderas' && perfil.rol !== 'ptar')) return null
  return { cuentaId: perfil.id, area: perfil.rol }
}

export function obtenerContextoTurno(): ContextoCuentaTurno | null {
  return contextoDesdeAuth(useAuthStore.getState())
}

function sigueLaCuenta(contexto: ContextoCuentaTurno): boolean {
  const actual = obtenerContextoTurno()
  return actual?.cuentaId === contexto.cuentaId && actual.area === contexto.area
}

function cacheDeLaCuenta(contexto: ContextoCuentaTurno): boolean {
  const datos = useTurnoStore.getState()
  return datos.cuentaId === contexto.cuentaId && datos.area === contexto.area
}

function cancelarConsulta(): void {
  revisionConsulta += 1
  consultaActiva?.abort()
  consultaActiva = null
}

export function cancelarGestionTurno(): void {
  cancelarConsulta()
  revisionAccion += 1
  accionActiva?.abort()
  accionActiva = null
  useTurnoStore.getState().limpiar()
}

async function conLimite<T>(
  tarea: () => Promise<T>, control: AbortController, espera: number, mutacion = false,
): Promise<T> {
  let temporizador: number | null = null
  let alCancelar: (() => void) | null = null
  const limite = new Promise<never>((_resolver, rechazar) => {
    alCancelar = () => rechazar(new ErrorTurnos('La operación se canceló. Revisa la información antes de continuar.', mutacion))
    control.signal.addEventListener('abort', alCancelar, { once: true })
    if (control.signal.aborted) alCancelar()
    temporizador = window.setTimeout(() => {
      rechazar(new ErrorTurnos(mutacion
        ? 'No llegó la confirmación a tiempo. Puedes reintentar la misma operación.'
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

export async function actualizarDatosTurno(conservarVista = false): Promise<void> {
  const contexto = obtenerContextoTurno()
  if (!contexto) {
    cancelarGestionTurno()
    return
  }
  if (!cacheDeLaCuenta(contexto)) cancelarGestionTurno()
  const anteriores = useTurnoStore.getState()
  if (anteriores.accionEnCurso) return

  cancelarConsulta()
  const revision = revisionConsulta
  const control = new AbortController()
  consultaActiva = control
  const conservar = conservarVista && anteriores.estadoCarga === 'listo'
  anteriores.establecerEstado({
    ...anteriores, cuentaId: contexto.cuentaId, area: contexto.area,
    operadores: conservar ? anteriores.operadores : [],
    turno: conservar ? anteriores.turno : null,
    estadoCarga: conservar ? 'listo' : 'cargando', mensaje: null,
  })
  try {
    const datos = await conLimite(() => consultarDatosTurno(contexto.area, control.signal), control, 15000)
    if (revision !== revisionConsulta || !sigueLaCuenta(contexto)) return
    const actuales = useTurnoStore.getState()
    actuales.establecerEstado({ ...actuales, ...datos, estadoCarga: 'listo', mensaje: null })
  } catch (fallo) {
    if (revision !== revisionConsulta || !sigueLaCuenta(contexto)) return
    const actuales = useTurnoStore.getState()
    actuales.establecerEstado({
      ...actuales, operadores: [], turno: null, estadoCarga: 'error',
      mensaje: fallo instanceof ErrorTurnos ? fallo.message : 'No se pudo consultar el turno. Reintenta.',
    })
  } finally {
    if (consultaActiva === control) consultaActiva = null
    control.abort()
  }
}

export function sincronizarContextoTurno(): void {
  const contexto = obtenerContextoTurno()
  if (!contexto) {
    cancelarGestionTurno()
    return
  }
  if (cacheDeLaCuenta(contexto) && useTurnoStore.getState().estadoCarga !== 'sin-cuenta') return
  cancelarGestionTurno()
  void actualizarDatosTurno()
}

function mostrarFalloAccion(mensaje: string): false {
  const actuales = useTurnoStore.getState()
  actuales.establecerEstado({ ...actuales, mensajeAccion: mensaje })
  return false
}

function prepararAccionNueva(): ContextoCuentaTurno | null {
  const contexto = obtenerContextoTurno()
  if (!contexto || !cacheDeLaCuenta(contexto)) return null
  const actuales = useTurnoStore.getState()
  if (actuales.accionEnCurso) return null
  if (actuales.solicitudPendiente) {
    mostrarFalloAccion('Hay una operación sin confirmar. Reintenta esa misma operación antes de hacer otra.')
    return null
  }
  if (actuales.estadoCarga !== 'listo') {
    mostrarFalloAccion('Actualiza la información del turno antes de continuar.')
    return null
  }
  if (actuales.turno && actuales.turno.iniciado_por !== contexto.cuentaId) {
    mostrarFalloAccion('Ese turno pertenece a otra cuenta del área. Consulta al administrador.')
    return null
  }
  return contexto
}

async function ejecutarAccion(pendiente: SolicitudPendienteTurno): Promise<boolean> {
  if (!sigueLaCuenta(pendiente.contexto) || !cacheDeLaCuenta(pendiente.contexto)
    || useTurnoStore.getState().accionEnCurso) return false

  cancelarConsulta()
  revisionAccion += 1
  const revision = revisionAccion
  const control = new AbortController()
  accionActiva = control
  const anteriores = useTurnoStore.getState()
  anteriores.establecerEstado({
    ...anteriores, accionEnCurso: pendiente.accion, solicitudPendiente: pendiente, mensajeAccion: null,
  })
  try {
    await conLimite(() => pendiente.accion === 'cerrar'
      ? guardarCierreTurno(pendiente.contexto, pendiente.id, pendiente.notas, control.signal)
      : guardarInicioTurno(pendiente.contexto, pendiente.solicitud, control.signal), control, 25000, true)
    if (revision !== revisionAccion || !sigueLaCuenta(pendiente.contexto)) return false
    const actuales = useTurnoStore.getState()
    actuales.establecerEstado({
      ...actuales, accionEnCurso: null, solicitudPendiente: null,
      mensajeAccion: pendiente.accion === 'cerrar' ? 'Cierre confirmado.' : 'Turno guardado.',
    })
    // Recargar el turno real: un reintento puede devolver uno que ya fue cerrado.
    await actualizarDatosTurno()
    return revision === revisionAccion && sigueLaCuenta(pendiente.contexto)
  } catch (fallo) {
    if (revision !== revisionAccion || !sigueLaCuenta(pendiente.contexto)) return false
    const incierto = !(fallo instanceof ErrorTurnos) || fallo.resultadoIncierto
    const actuales = useTurnoStore.getState()
    actuales.establecerEstado({
      ...actuales, accionEnCurso: null, solicitudPendiente: incierto ? pendiente : null,
      mensajeAccion: fallo instanceof ErrorTurnos ? fallo.message : 'No se recibió la confirmación. Reintenta la misma operación.',
    })
    await actualizarDatosTurno()
    return false
  } finally {
    if (accionActiva === control) accionActiva = null
    control.abort()
  }
}

async function iniciarOCambiarTurno(campos: CamposInicioTurno): Promise<boolean> {
  const contexto = prepararAccionNueva()
  if (!contexto) return false
  const nombre = normalizarNombreOperador(campos.nombreOperador)
  if (!esTipoTurno(campos.tipoTurno) || !nombre) {
    return mostrarFalloAccion('Selecciona el tipo de turno y escribe el nombre completo del operador.')
  }
  const anterior = useTurnoStore.getState().turno
  let id: string
  try {
    id = crypto.randomUUID()
  } catch {
    return mostrarFalloAccion('No se pudo preparar el nuevo turno. Intenta de nuevo.')
  }
  return ejecutarAccion({
    accion: anterior ? 'cambiar' : 'iniciar', contexto: { ...contexto },
    solicitud: {
      id, tipoTurno: campos.tipoTurno,
      nombreOperador: nombre, operadorId: campos.operadorId, numeroEmpleado: campos.numeroEmpleado, turnoAnterior: anterior?.id ?? null,
    },
  })
}

async function cerrarTurnoActual(notas: string): Promise<boolean> {
  const contexto = prepararAccionNueva()
  if (!contexto) return false
  const turno = useTurnoStore.getState().turno
  if (!turno) return mostrarFalloAccion('No hay un turno abierto que cerrar.')
  return ejecutarAccion({ accion: 'cerrar', contexto: { ...contexto }, id: turno.id, notas: notas.trim() })
}

async function reintentarOperacion(): Promise<boolean> {
  const pendiente = useTurnoStore.getState().solicitudPendiente
  if (!pendiente) return false
  return ejecutarAccion(pendiente)
}

function reintentarConsulta(): Promise<void> {
  return actualizarDatosTurno()
}

export function useTurno() {
  const auth = useAuthStore()
  const datos = useTurnoStore()
  const contexto = contextoDesdeAuth(auth)
  const coincide = contexto !== null && datos.cuentaId === contexto.cuentaId && datos.area === contexto.area
  return {
    cuentaId: contexto?.cuentaId ?? null,
    area: contexto?.area ?? null,
    operadores: coincide ? datos.operadores : [],
    turno: coincide ? datos.turno : null,
    estadoCarga: coincide ? datos.estadoCarga : contexto ? 'cargando' as const : 'sin-cuenta' as const,
    mensaje: coincide ? datos.mensaje : null,
    accionEnCurso: coincide ? datos.accionEnCurso : null,
    solicitudPendiente: coincide ? datos.solicitudPendiente : null,
    mensajeAccion: coincide ? datos.mensajeAccion : null,
    iniciarOCambiarTurno,
    cerrarTurnoActual,
    reintentarOperacion,
    actualizarTurno: reintentarConsulta,
  }
}
