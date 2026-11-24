import { useEffect, useState } from 'react'
import { useAuthStore } from '../stores/authStore'
import { claveCacheAvisos, consultarInformacionDia } from '../lib/informacionDia'
import type { InformacionDia } from '../lib/informacionDia'
import type { AreaOperativa } from '../lib/tiposTurno'
import {
  crearActualizadorAgrupado,
  escucharCambiosInformacion,
  escucharReactivacionInformacion,
  intervaloInformacion,
} from '../lib/actualizacionInformacion'

export function useInformacionDia(area: AreaOperativa | 'todas', fecha: string | null) {
  const auth = useAuthStore()
  const cuentaId = auth.estado === 'autenticado' && auth.perfil?.activo === true
    && auth.perfil.id === auth.sesion?.user.id
    && (area === 'todas' ? auth.perfil.rol === 'admin' : auth.perfil.rol === area) ? auth.perfil.id : null
  const claveAvisos = cuentaId && auth.sesion && auth.perfil
    ? claveCacheAvisos(cuentaId, auth.sesion.access_token, auth.sesion.user.last_sign_in_at, auth.perfil.rol, area)
    : null
  const clave = cuentaId && fecha && claveAvisos ? `${claveAvisos}:${fecha}` : null
  const [vista, setVista] = useState<{ clave: string; datos: InformacionDia | null; cargando: boolean } | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!clave || !fecha) return
    let vigente = true
    let pendiente = false
    let control: AbortController | null = null
    let limite: number | null = null
    function sigueLaCuenta() {
      const a = useAuthStore.getState()
      return vigente && a.estado === 'autenticado' && a.perfil?.activo === true
        && a.perfil.id === cuentaId && a.sesion?.user.id === cuentaId
        && (area === 'todas' ? a.perfil.rol === 'admin' : a.perfil.rol === area)
    }
    async function cargar() {
      if (!sigueLaCuenta()) return
      if (control || document.visibilityState === 'hidden') { pendiente = true; return }
      pendiente = false
      const peticion = new AbortController()
      control = peticion
      setVista(anterior => ({ clave: clave!, datos: anterior?.clave === clave ? anterior.datos : null, cargando: true }))
      limite = window.setTimeout(() => peticion.abort(), 15000)
      try {
        const datos = await consultarInformacionDia(fecha!, area, claveAvisos!, peticion.signal)
        if (sigueLaCuenta()) setVista({ clave: clave!, datos, cargando: false })
      } catch {
        if (sigueLaCuenta()) setVista({ clave: clave!, datos: {
          avisos: { elementos: [], error: true }, produccion: { elementos: [], error: true }, eventos: { elementos: [], error: true },
        }, cargando: false })
      } finally {
        if (limite !== null) window.clearTimeout(limite)
        limite = null
        control = null
        if (pendiente && sigueLaCuenta()) void cargar()
      }
    }
    const agenda = crearActualizadorAgrupado(() => { void cargar() })
    void cargar()
    const dejarEscuchar = escucharCambiosInformacion(agenda.solicitar)
    const dejarReactivacion = escucharReactivacionInformacion(agenda.solicitar)
    const intervalo = window.setInterval(agenda.solicitar, intervaloInformacion)
    return () => {
      vigente = false
      dejarEscuchar()
      dejarReactivacion()
      agenda.limpiar()
      control?.abort()
      if (limite !== null) window.clearTimeout(limite)
      window.clearInterval(intervalo)
    }
  }, [area, cuentaId, clave, claveAvisos, fecha, revision])

  return {
    datos: clave && vista?.clave === clave ? vista.datos : null,
    cargando: !!clave && (vista?.clave !== clave || vista.cargando),
    actualizar: () => setRevision(n => n + 1),
  }
}
