import { useVentanaReporte } from './useVentanaReporte'
import { useEffect } from 'react'
import { create } from 'zustand'
import { useAuthStore } from '../stores/authStore'
import { useTurnoStore } from '../stores/turnoStore'
import { borradorBitacoraCalderas } from '../lib/tiposBitacoraCalderas'
import type { BorradorBitacoraCalderas } from '../lib/tiposBitacoraCalderas'
import { consultarReporteCalderas, enviarReporteCalderas, ErrorReporteCalderas, prepararDatosCalderas } from '../lib/bitacoraTecnicaCalderas'
import type { EnvioReporteCalderas, ReporteTecnicoCalderas } from '../lib/bitacoraTecnicaCalderas'

interface Captura {
  editando: boolean
  borrador: BorradorBitacoraCalderas
  reporte: ReporteTecnicoCalderas | null
  estado: 'sin-consultar' | 'cargando' | 'listo' | 'error'
  guardando: boolean
  pendiente: EnvioReporteCalderas | null
  mensaje: string | null
}
const nueva = (): Captura => ({ editando: false, borrador: borradorBitacoraCalderas(), reporte: null, estado: 'sin-consultar', guardando: false, pendiente: null, mensaje: null })
const vacia = nueva()
// Solo memoria, por cuenta y turno. No es una cola offline ni sobrevive a una recarga.
const useCapturas = create<{ entradas: Record<string, Captura> }>()(() => ({ entradas: {} }))
const controles = new Set<AbortController>()
let generacion = 0
function cuentaActiva() {
  const a = useAuthStore.getState()
  return a.estado === 'autenticado' && a.perfil?.activo && a.perfil.rol === 'calderas'
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
      temporizador = setTimeout(() => { control.abort(); rechazar(new ErrorReporteCalderas('No llegó la respuesta a tiempo. Reintenta.', true)) }, 25000)
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
  if (useCapturas.getState().entradas[clave]?.pendiente?.reporteId) return
  const g = generacion
  poner(clave, { estado: 'cargando' })
  try {
    const reporte = await limitado(signal => consultarReporteCalderas(turnoId, signal))
    if (!sigue(cuentaId, g)) return
    poner(clave, { estado: 'listo', reporte, editando: false,
      ...(reporte ? { borrador: reporte.borrador, pendiente: null, mensaje: 'Reporte técnico registrado. Solo Administración puede corregirlo.' } : { mensaje: null }) })
  } catch (error) {
    if (sigue(cuentaId, g)) poner(clave, { estado: 'error', mensaje: error instanceof Error ? error.message : 'No se pudo consultar el reporte técnico.' })
  }
}
function turnoAutorizado(cuentaId: string, turnoId: string) {
  const t = useTurnoStore.getState()
  return cuentaActiva() === cuentaId && t.estadoCarga === 'listo' && t.cuentaId === cuentaId && t.area === 'calderas'
    && t.turno?.id === turnoId && t.turno.finalizado_en === null && t.turno.iniciado_por === cuentaId
    && !t.accionEnCurso && !t.solicitudPendiente
}

export function useReporteCalderas(cuentaId: string | null, turnoRecibido: string | null, habilitadoAnterior: boolean) {
  const ventana = useVentanaReporte(cuentaId, 'calderas', turnoRecibido)
  const turnoId = ventana.disponible ? ventana.contexto?.turnoId ?? null : turnoRecibido
  const habilitado = ventana.listo && (ventana.disponible ? ventana.puedeEditar : habilitadoAnterior)
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
    if (!estado || estado.guardando || (estado.reporte && !estado.editando) || estado.estado !== 'listo') return
    if (!estado.pendiente && (!habilitado || !(ventana.disponible ? ventana.puedeEditar && ventana.contexto?.turnoId === turnoConsultado : turnoAutorizado(cuentaId, turnoConsultado)))) {
      poner(clave, { mensaje: 'Confirma tu turno activo de Calderas antes de guardar.' }); return
    }
    let envio: EnvioReporteCalderas
    try {
      envio = estado.pendiente ?? { id: crypto.randomUUID(), cuentaId, turnoId: turnoConsultado, datos: prepararDatosCalderas(estado.borrador, estado.reporte?.borrador), operativo: ventana.disponible,
        ...(estado.reporte ? { reporteId: estado.reporte.id, revisionEsperada: estado.reporte.revision, creadoEn: estado.reporte.creadoEn } : {}) }
    } catch (error) {
      poner(clave, { mensaje: error instanceof Error ? error.message : 'Revisa los campos del reporte.' }); return
    }
    const g = generacion
    poner(clave, { guardando: true, pendiente: envio, mensaje: null })
    try {
      const reporte = await limitado(signal => enviarReporteCalderas(envio, signal))
      if (sigue(cuentaId, g)) {
        poner(clave, { guardando: false, pendiente: null, reporte, editando: false, borrador: reporte.borrador,
          mensaje: 'Reporte técnico guardado. Solo Administración puede corregirlo.' })
        return true as const
      }
    } catch (error) {
      if (!sigue(cuentaId, g)) return
      if (error instanceof ErrorReporteCalderas && error.sinCambios && estado.reporte) {
        poner(clave, { guardando: false, pendiente: null, editando: false, borrador: estado.reporte.borrador,
          mensaje: 'No hay cambios para guardar.' })
        return 'sin-cambios' as const
      }
      const incierto = !(error instanceof ErrorReporteCalderas) || error.incierto
      poner(clave, { guardando: false, pendiente: incierto ? envio : null,
        mensaje: error instanceof Error ? error.message : 'No llegó la confirmación. Reintenta el envío original.' })
      // Si otra sesión ya guardó, recuperar el reporte autorizado sin sobrescribirlo.
      if (error instanceof ErrorReporteCalderas && error.conflicto) { await consultar(clave, cuentaId, turnoConsultado); poner(clave, { mensaje: error.message }) }
    }
  }
  const editable = !!clave && (!datos.reporte || datos.editando) && !datos.guardando && !datos.pendiente && datos.estado === 'listo' && habilitado
  const puedeEditar = !!datos.reporte && datos.estado === 'listo' && ventana.disponible && ventana.puedeEditar && !datos.guardando && !datos.pendiente
  const sinEnviar = JSON.stringify(datos.borrador) !== JSON.stringify(datos.reporte?.borrador ?? borradorBitacoraCalderas())
  const estadoDelReporte = ventana.estado && !habilitado && sinEnviar && !datos.pendiente
    ? `${ventana.estado} · Los cambios sin enviar no se guardaron.` : ventana.estado
  return {
    ...datos, editable, puedeEditar, estadoDelReporte, unidadPresion: datos.reporte?.unidadCondensado ?? 'kg/cm²',
    mensaje: ventana.disponible && datos.mensaje?.includes('Solo Administración puede corregirlo.') ? null : datos.mensaje,
    editar: () => { if (clave && puedeEditar) poner(clave, { editando: true, mensaje: null }) },
    puedeGuardar: !datos.guardando && datos.estado === 'listo' && (!!datos.pendiente || editable),
    cambiarBorrador: (cambio: (b: BorradorBitacoraCalderas) => BorradorBitacoraCalderas) => {
      if (clave && editable) poner(clave, { borrador: cambio(useCapturas.getState().entradas[clave]?.borrador ?? borradorBitacoraCalderas()) })
    },
    guardar,
    actualizar: () => { if (clave && cuentaId && turnoConsultado) { ventana.actualizar(); void consultar(clave, cuentaId, turnoConsultado) } },
  }
}
