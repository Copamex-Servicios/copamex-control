import { useEffect, useState } from 'react'
import { consultarContextoReporte, permisoVigente } from '../lib/reporteOperativo'
import type { ContextoReporteOperativo } from '../lib/reporteOperativo'
import type { AreaOperativa } from '../lib/tiposTurno'

export function useVentanaReporte(cuenta: string | null, area: AreaOperativa, turnoId: string | null) {
  const clave = cuenta + ':' + area + ':' + turnoId
  const [vista, setVista] = useState<{ clave: string; contexto: ContextoReporteOperativo | null; referencia: number; error: string | null } | null>(null)
  const [pulso, setPulso] = useState(() => performance.now()), [intento, setIntento] = useState(0)
  useEffect(() => {
    if (!cuenta) return
    let vivo = true, control: AbortController | null = null, secuencia = 0
    async function consultar() {
      const s = ++secuencia; control?.abort(); const peticion = new AbortController(); control = peticion
      const limite = window.setTimeout(() => peticion.abort(), 15000)
      // Contar también el viaje de red: nunca ampliar el vencimiento por una respuesta tardía.
      const referencia = performance.now()
      try {
        const contexto = await consultarContextoReporte(cuenta!, area, turnoId, peticion.signal)
        if (vivo && s === secuencia) { setPulso(performance.now()); setVista({ clave, contexto, referencia, error: null }) }
      } catch (e) {
        if (vivo && s === secuencia) setVista(v => ({ clave, contexto: v?.clave === clave ? v.contexto : null, referencia,
          error: e instanceof Error ? e.message : 'No se pudo comprobar el horario.' }))
      } finally { window.clearTimeout(limite) }
    }
    const volver = () => { if (document.visibilityState === 'visible') void consultar() }
    void consultar()
    const reloj = window.setInterval(() => setPulso(performance.now()), 1000)
    const intervalo = window.setInterval(volver, 30000)
    window.addEventListener('focus', volver); document.addEventListener('visibilitychange', volver)
    return () => { vivo = false; control?.abort(); window.clearInterval(reloj); window.clearInterval(intervalo); window.removeEventListener('focus', volver); document.removeEventListener('visibilitychange', volver) }
  }, [cuenta, area, turnoId, clave, intento])
  const actual = vista?.clave === clave ? vista : null, contexto = actual?.contexto
  const transcurrido = actual ? Math.max(0, pulso - actual.referencia) : 0
  const cerrado = !!contexto && contexto.fin > 0 && contexto.ahora + transcurrido >= contexto.fin
  return { disponible: !!contexto, listo: !!actual && !actual.error, contexto,
    puedeEditar: !!contexto && !actual?.error && permisoVigente(contexto, transcurrido),
    estado: actual?.error ?? (cerrado && !contexto.estado.startsWith('Cerrado') ? (contexto.reporteId ? 'Horario finalizado · solo lectura' : 'Cerrado con pendientes') : contexto?.estado),
    actualizar: () => setIntento(n => n + 1) }
}

