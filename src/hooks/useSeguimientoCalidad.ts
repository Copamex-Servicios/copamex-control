import { useCallback, useEffect, useState } from 'react'
import { consultarSeguimiento } from '../lib/seguimientoCalidad'
import type { SeguimientoCalidad } from '../lib/seguimientoCalidad'
import { escucharCambiosInformacion, intervaloInformacion } from '../lib/actualizacionInformacion'

export function useSeguimientoCalidad(cuenta: string) {
  const [revision, setRevision] = useState(0)
  const [vista, setVista] = useState<{ cuenta: string; seguimiento: SeguimientoCalidad | null; error: string | null } | null>(null)
  const actualizar = useCallback(() => setRevision(n => n + 1),[])
  useEffect(() => {
    let vivo = true
    const control = new AbortController(), limite = window.setTimeout(() => control.abort(),15000)
    void consultarSeguimiento(cuenta,control.signal)
      .then(seguimiento => { if (vivo) setVista({ cuenta,seguimiento,error:null }) })
      .catch(e => { if (vivo) setVista({ cuenta,seguimiento:null,error:e instanceof Error ? e.message : 'Consulta no disponible.' }) })
      .finally(() => window.clearTimeout(limite))
    return () => { vivo = false; control.abort(); window.clearTimeout(limite) }
  },[cuenta,revision])
  useEffect(() => {
    const refrescar = () => { if (document.visibilityState === 'visible') actualizar() }
    const intervalo = window.setInterval(refrescar,intervaloInformacion)
    const limpiar = escucharCambiosInformacion(refrescar)
    document.addEventListener('visibilitychange',refrescar)
    window.addEventListener('focus',refrescar)
    return () => { window.clearInterval(intervalo); limpiar(); document.removeEventListener('visibilitychange',refrescar); window.removeEventListener('focus',refrescar) }
  },[actualizar])
  const actual = vista?.cuenta === cuenta ? vista : null
  return { seguimiento:actual?.seguimiento ?? null, error:actual?.error ?? null, cargando:!actual, actualizar }
}
