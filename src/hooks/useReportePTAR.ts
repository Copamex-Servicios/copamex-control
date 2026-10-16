import { useEffect } from 'react'
import { create } from 'zustand'
import { useAuthStore } from '../stores/authStore'
import { useTurnoStore } from '../stores/turnoStore'
import { borradorBitacoraPTAR } from '../lib/tiposBitacoraPTAR'
import type { BorradorBitacoraPTAR } from '../lib/tiposBitacoraPTAR'
import { consultarReportePTAR, enviarReportePTAR, ErrorReportePTAR, prepararDatosPTAR } from '../lib/bitacoraTecnicaPTAR'
import type { EnvioReportePTAR, ReporteTecnicoPTAR } from '../lib/bitacoraTecnicaPTAR'

interface Captura {
  borrador: BorradorBitacoraPTAR
  reporte: ReporteTecnicoPTAR | null
  estado: 'sin-consultar' | 'cargando' | 'listo' | 'error'
  guardando: boolean
  pendiente: EnvioReportePTAR | null
  mensaje: string | null
}
const nueva = (): Captura => ({ borrador: borradorBitacoraPTAR(), reporte: null, estado: 'sin-consultar', guardando: false, pendiente: null, mensaje: null })
const vacia = nueva()
// Solo memoria, por cuenta y turno. No es una cola offline ni sobrevive a una recarga.
const useCapturas = create<{ entradas: Record<string, Captura> }>()(() => ({ entradas: {} }))
const controles = new Set<AbortController>()
let generacion = 0
function cuentaActiva() {
  const a = useAuthStore.getState()
  return a.estado === 'autenticado' && a.perfil?.activo && a.perfil.rol === 'ptar'
    && a.sesion?.user.id === a.perfil.id ? a.perfil.id : null
}
useAuthStore.subscribe(() => {
  const cuenta = cuentaActiva()
  if (Object.keys(useCapturas.getState().entradas).some(k => !cuenta || !k.startsWith(`${cuenta}:`))) {
    generacion++
    for (const control of controles) control.abort()
    controles.clear()
    useCapturas.setState({ entradas: {} })
  }
})
function poner(clave: string, cambio: Partial<Captura>) {
  useCapturas.setState(s => ({ entradas: { ...s.entradas, [clave]: { ...(s.entradas[clave] ?? nueva()), ...cambio } } }))
}
async function limitado<T>(accion: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const control = new AbortController()
  controles.add(control)
  let temporizador: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([accion(control.signal), new Promise<never>((_, rechazar) => {
      temporizador = setTimeout(() => { control.abort(); rechazar(new ErrorReportePTAR('No llegó la respuesta a tiempo. Reintenta.', true)) }, 25000)
    })])
  } finally {
    clearTimeout(temporizador)
    controles.delete(control)
    control.abort()
  }
}
function sigue(cuentaId: string, g: number) { return cuentaActiva() === cuentaId && generacion === g }
async function consultar(clave: string, cuentaId: string, turnoId: string) {
  if (cuentaActiva() !== cuentaId || useCapturas.getState().entradas[clave]?.guardando) return
  const g = generacion
  poner(clave, { estado: 'cargando' })
  try {
    const reporte = await limitado(signal => consultarReportePTAR(turnoId, signal))
    if (!sigue(cuentaId, g)) return
    poner(clave, { estado: 'listo', reporte,
      ...(reporte ? { borrador: reporte.borrador, pendiente: null, mensaje: 'Reporte técnico registrado. Solo Administración puede corregirlo.' } : { mensaje: null }) })
  } catch (error) {
    if (sigue(cuentaId, g)) poner(clave, { estado: 'error', mensaje: error instanceof Error ? error.message : 'No se pudo consultar el reporte técnico.' })
  }
}
function turnoAutorizado(cuentaId: string, turnoId: string) {
  const t = useTurnoStore.getState()
  return cuentaActiva() === cuentaId && t.estadoCarga === 'listo' && t.cuentaId === cuentaId && t.area === 'ptar'
    && t.turno?.id === turnoId && t.turno.finalizado_en === null && t.turno.iniciado_por === cuentaId
    && !t.accionEnCurso && !t.solicitudPendiente
}

export function useReportePTAR(cuentaId: string | null, turnoId: string | null, habilitado: boolean) {
  const entradas = useCapturas(s => s.entradas)
  // Un reintento pendiente conserva su turno original, incluso si el turno se cerró.
  const anterior = Object.entries(entradas).find(([k, e]) => cuentaId && k.startsWith(`${cuentaId}:`) && e.pendiente)
  const ultimo = Object.entries(entradas).filter(([k, e]) => cuentaId && k.startsWith(`${cuentaId}:`) && e.reporte).at(-1)
  const clave = cuentaActiva() === cuentaId && cuentaId ? anterior?.[0] ?? (turnoId ? `${cuentaId}:${turnoId}` : ultimo?.[0] ?? null) : null
  const datos = clave ? entradas[clave] ?? vacia : vacia
  const turnoConsultado = datos.pendiente?.turnoId ?? datos.reporte?.turnoId ?? turnoId
  useEffect(() => {
    if (clave && cuentaId && turnoConsultado && (useCapturas.getState().entradas[clave]?.estado ?? 'sin-consultar') === 'sin-consultar') {
      void consultar(clave, cuentaId, turnoConsultado)
    }
  }, [clave, cuentaId, turnoConsultado])

  async function guardar() {
    if (!clave || !cuentaId || !turnoConsultado || cuentaActiva() !== cuentaId) return
    const estado = useCapturas.getState().entradas[clave]
    if (!estado || estado.guardando || estado.reporte || estado.estado !== 'listo') return
    if (!estado.pendiente && (!habilitado || !turnoAutorizado(cuentaId, turnoConsultado))) {
      poner(clave, { mensaje: 'Confirma tu turno activo de PTAR antes de guardar.' }); return
    }
    let envio: EnvioReportePTAR
    try {
      envio = estado.pendiente ?? { id: crypto.randomUUID(), cuentaId, turnoId: turnoConsultado, datos: prepararDatosPTAR(estado.borrador) }
    } catch (error) {
      poner(clave, { mensaje: error instanceof Error ? error.message : 'Revisa los campos del reporte.' }); return
    }
    const g = generacion
    poner(clave, { guardando: true, pendiente: envio, mensaje: null })
    try {
      const reporte = await limitado(signal => enviarReportePTAR(envio, signal))
      if (sigue(cuentaId, g)) {
        poner(clave, { guardando: false, pendiente: null, reporte, borrador: reporte.borrador,
          mensaje: 'Reporte técnico guardado. Solo Administración puede corregirlo.' })
        return true as const
      }
    } catch (error) {
      if (!sigue(cuentaId, g)) return
      const incierto = !(error instanceof ErrorReportePTAR) || error.incierto
      poner(clave, { guardando: false, pendiente: incierto ? envio : null,
        mensaje: error instanceof Error ? error.message : 'No llegó la confirmación. Reintenta el envío original.' })
      // Si otra sesión ya guardó, recuperar el reporte autorizado sin sobrescribirlo.
      if (error instanceof ErrorReportePTAR && error.conflicto) await consultar(clave, cuentaId, turnoConsultado)
    }
  }
  const editable = !!clave && !datos.reporte && !datos.guardando && datos.estado === 'listo'
    && (habilitado || datos.pendiente !== null)
  return {
    ...datos, editable,
    puedeGuardar: editable && (!!datos.pendiente || (!!cuentaId && !!turnoId && turnoAutorizado(cuentaId, turnoId))),
    cambiarBorrador: (cambio: (b: BorradorBitacoraPTAR) => BorradorBitacoraPTAR) => {
      if (clave && editable) poner(clave, { borrador: cambio(useCapturas.getState().entradas[clave]?.borrador ?? borradorBitacoraPTAR()) })
    },
    guardar,
    actualizar: () => { if (clave && cuentaId && turnoConsultado) void consultar(clave, cuentaId, turnoConsultado) },
  }
}
