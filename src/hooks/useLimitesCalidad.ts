import { useEffect, useRef, useState } from 'react'
import { useAuth } from './useAuth'
import { consultarLimites } from '../lib/limitesCalidad'
import type { LimiteCalidad } from '../lib/limitesCalidad'

export function useLimitesCalidad(historial = false) {
  const { estado, perfil, sesion } = useAuth()
  const cuenta = estado === 'autenticado' && perfil?.activo && perfil.id === sesion?.user.id && (!historial || perfil.rol === 'admin') ? perfil.id : null
  const clave = cuenta ? `${cuenta}:${perfil?.rol}:${historial}` : null
  const [vista, setVista] = useState<{ clave: string | null; limites: LimiteCalidad[]; cargando: boolean; error: string | null }>({ clave: null, limites: [], cargando: false, error: null })
  const actualizarRef = useRef<() => void>(() => {})
  useEffect(() => {
    if (!cuenta || !clave) return
    const controller = new AbortController()
    let vivo = true, leyendo = false, repetir = false
    async function cargar() {
      if (!vivo) return
      if (leyendo) { repetir = true; return }
      leyendo = true
      setVista(v => ({ clave, limites: v.clave === clave ? v.limites : [], cargando: true, error: null }))
      try { const limites = await consultarLimites(cuenta!, historial, controller.signal); if (vivo) setVista({ clave, limites, cargando: false, error: null }) }
      catch (e) { if (vivo) setVista({ clave, limites: [], cargando: false, error: e instanceof Error ? e.message : 'No se pudieron consultar los límites.' }) }
      finally { leyendo = false; if (vivo && repetir) { repetir = false; void cargar() } }
    }
    const actualizar = () => { void cargar() }
    actualizarRef.current = actualizar
    actualizar()
    const intervalo = window.setInterval(() => { if (document.visibilityState === 'visible') actualizar() }, 60000)
    window.addEventListener('focus', actualizar)
    return () => { vivo = false; controller.abort(); window.clearInterval(intervalo); window.removeEventListener('focus', actualizar); actualizarRef.current = () => {} }
  }, [cuenta, clave, historial])
  const actual = clave && vista.clave === clave ? vista : { clave, limites: [], cargando: !!clave, error: null }
  return { cuenta, ...actual, actualizar: () => actualizarRef.current() }
}
