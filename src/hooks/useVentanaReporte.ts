import { useEffect, useState } from 'react'
import { consultarContextoReporte, permisoVigente } from '../lib/reporteOperativo'
import type { ContextoReporteOperativo } from '../lib/reporteOperativo'
import type { AreaOperativa } from '../lib/tiposTurno'

export interface VistaVentanaReporte {
  clave: string; contexto: ContextoReporteOperativo | null; referencia: number
  error: string | null; revalidando: boolean
}

export function iniciarRevalidacionReporte(clave: string, vista: VistaVentanaReporte | null, referencia: number): VistaVentanaReporte {
  const previa = vista?.clave === clave ? vista : null
  return { clave, contexto: previa?.contexto ?? null,
    referencia: previa ? previa.referencia : referencia, error: null, revalidando: true }
}

export function fallarRevalidacionReporte(clave: string, vista: VistaVentanaReporte | null, referencia: number, error: string): VistaVentanaReporte {
  const previa = vista?.clave === clave ? vista : null
  return { clave, contexto: previa?.contexto ?? null, referencia, error, revalidando: false }
}

export function permisoVistaReporteVigente(vista: VistaVentanaReporte | null, clave: string, transcurrido: number) {
  const actual = vista?.clave === clave ? vista : null
  return !!actual?.contexto && !actual.error && !actual.revalidando && permisoVigente(actual.contexto, transcurrido)
}

export function useVentanaReporte(cuenta: string | null, area: AreaOperativa, turnoId: string | null, activo = true) {
  const [activacion, setActivacion] = useState(() => ({ activo, numero: activo ? 1 : 0 }))
  if (activacion.activo !== activo) setActivacion({ activo, numero: activacion.numero + (activo ? 1 : 0) })
  const clave = cuenta + ':' + area + ':' + turnoId + ':' + activacion.numero
  const [vista, setVista] = useState<VistaVentanaReporte | null>(null)
  const [pulso, setPulso] = useState(() => performance.now()), [intento, setIntento] = useState(0)
  useEffect(() => {
    if (!cuenta || !activo) return
    let vivo = true, control: AbortController | null = null, secuencia = 0
    let revalidacion: number | null = null
    let inicioConsultaBloqueante = -Infinity
    async function consultar(bloqueante = true) {
      const s = ++secuencia; control?.abort(); const peticion = new AbortController(); control = peticion
      // Contar también el viaje de red: nunca ampliar el vencimiento por una respuesta tardía.
      const referencia = performance.now()
      if (bloqueante) inicioConsultaBloqueante = referencia
      setVista(v => bloqueante || v?.clave !== clave || !v.contexto
        ? iniciarRevalidacionReporte(clave, v, referencia) : v)
      let excedioTiempo = false
      const limite = window.setTimeout(() => { excedioTiempo = true; peticion.abort() }, 15000)
      try {
        const contexto = await consultarContextoReporte(cuenta!, area, turnoId, peticion.signal)
        if (vivo && s === secuencia) { setPulso(performance.now()); setVista({ clave, contexto, referencia, error: null, revalidando: false }) }
      } catch (e) {
        if (!vivo || s !== secuencia) return
        // Las cancelaciones al actualizar o desmontar son normales; no deben aparecer como error.
        if (peticion.signal.aborted && !excedioTiempo) return
        const error = excedioTiempo
          ? 'La consulta del horario tardó más de 15 segundos. Revisa la conexión e intenta actualizar.'
          : e instanceof Error && /abort/i.test(`${e.name} ${e.message}`)
            ? 'La consulta del horario se interrumpió. Intenta actualizar de nuevo.'
            : e instanceof Error ? e.message : 'No se pudo comprobar el horario.'
        setVista(v => fallarRevalidacionReporte(clave, v, referencia, error))
      } finally {
        window.clearTimeout(limite)
        if (control === peticion) control = null
      }
    }
    const volver = () => {
      if (document.visibilityState !== 'visible' || revalidacion !== null
        || performance.now() - inicioConsultaBloqueante < 250) return
      // Una respuesta iniciada antes de recuperar el foco no puede desbloquear la edición.
      ++secuencia
      control?.abort()
      setVista(v => iniciarRevalidacionReporte(clave, v, performance.now()))
      revalidacion = window.setTimeout(() => {
        revalidacion = null
        if (document.visibilityState === 'visible') void consultar()
      }, 50)
    }
    void consultar()
    const reloj = window.setInterval(() => setPulso(performance.now()), 1000)
    const intervalo = window.setInterval(() => {
      // El permiso vigente permite seguir escribiendo mientras llega la actualización periódica.
      if (document.visibilityState === 'visible' && revalidacion === null && !control) void consultar(false)
    }, 30000)
    const alCambiarVisibilidad = () => {
      if (document.visibilityState === 'visible') volver()
      else inicioConsultaBloqueante = -Infinity
    }
    window.addEventListener('focus', volver); document.addEventListener('visibilitychange', alCambiarVisibilidad)
    return () => {
      vivo = false; control?.abort(); window.clearInterval(reloj); window.clearInterval(intervalo)
      if (revalidacion !== null) window.clearTimeout(revalidacion)
      window.removeEventListener('focus', volver); document.removeEventListener('visibilitychange', alCambiarVisibilidad)
    }
  }, [cuenta, area, turnoId, clave, activo, intento])
  const actual = activo && vista?.clave === clave ? vista : null, contexto = actual?.contexto
  const transcurrido = actual ? Math.max(0, pulso - actual.referencia) : 0
  const cerrado = !!contexto && contexto.fin > 0 && contexto.ahora + transcurrido >= contexto.fin
  return { disponible: !!contexto, listo: !!actual && !actual.error && !actual.revalidando, contexto,
    puedeEditar: permisoVistaReporteVigente(actual, clave, transcurrido),
    estado: actual?.error ?? (cerrado && !contexto.estado.startsWith('Cerrado') ? (contexto.reporteId ? 'Horario finalizado · solo lectura' : 'Cerrado con pendientes') : contexto?.estado),
    actualizar: () => { if (activo) setIntento(n => n + 1) } }
}

