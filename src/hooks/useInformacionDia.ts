import { useEffect, useState } from 'react'
import { useAuthStore } from '../stores/authStore'
import { consultarInformacionDia } from '../lib/informacionDia'
import type { InformacionDia } from '../lib/informacionDia'
import type { AreaOperativa } from '../lib/tiposTurno'

export function useInformacionDia(area: AreaOperativa, fecha: string | null) {
  const auth = useAuthStore()
  const cuentaId = auth.estado === 'autenticado' && auth.perfil?.activo === true
    && auth.perfil.id === auth.sesion?.user.id && auth.perfil.rol === area ? auth.perfil.id : null
  const clave = cuentaId && fecha ? `${cuentaId}:${area}:${fecha}` : null
  const [vista, setVista] = useState<{ clave: string; datos: InformacionDia | null; cargando: boolean } | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!clave || !fecha) return
    let vigente = true
    let control: AbortController | null = null
    let limite: number | null = null
    function sigueLaCuenta() {
      const a = useAuthStore.getState()
      return vigente && a.estado === 'autenticado' && a.perfil?.activo === true
        && a.perfil.id === cuentaId && a.sesion?.user.id === cuentaId && a.perfil.rol === area
    }
    async function cargar() {
      if (!sigueLaCuenta() || control || document.visibilityState === 'hidden') return
      const peticion = new AbortController()
      control = peticion
      setVista(anterior => ({ clave: clave!, datos: anterior?.clave === clave ? anterior.datos : null, cargando: true }))
      limite = window.setTimeout(() => peticion.abort(), 15000)
      try {
        const datos = await consultarInformacionDia(fecha!, area, peticion.signal)
        if (sigueLaCuenta()) setVista({ clave: clave!, datos, cargando: false })
      } catch {
        if (sigueLaCuenta()) setVista({ clave: clave!, datos: {
          avisos: { elementos: [], error: true }, produccion: { elementos: [], error: true }, eventos: { elementos: [], error: true },
        }, cargando: false })
      } finally {
        if (limite !== null) window.clearTimeout(limite)
        limite = null
        control = null
      }
    }
    const alVolver = () => { void cargar() }
    void cargar()
    const intervalo = window.setInterval(alVolver, 60000)
    window.addEventListener('focus', alVolver)
    window.addEventListener('online', alVolver)
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      vigente = false
      control?.abort()
      if (limite !== null) window.clearTimeout(limite)
      window.clearInterval(intervalo)
      window.removeEventListener('focus', alVolver)
      window.removeEventListener('online', alVolver)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [area, cuentaId, clave, fecha, revision])

  return {
    datos: clave && vista?.clave === clave ? vista.datos : null,
    cargando: !!clave && (vista?.clave !== clave || vista.cargando),
    actualizar: () => setRevision(n => n + 1),
  }
}
