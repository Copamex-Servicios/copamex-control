import { useEffect, useRef, useState } from 'react'
import { useAuth } from './useAuth'
import { consultarDashboardAdministracion } from '../lib/dashboardAdministracion'
import type { DatosDashboard } from '../lib/dashboardAdministracion'

export function useDashboardAdministracion() {
  const { estado, perfil, sesion } = useAuth()
  const cuenta = estado === 'autenticado' && perfil?.activo === true && perfil.rol === 'admin'
    && perfil.id === sesion?.user.id ? perfil.id : null
  const [revision, setRevision] = useState(0)
  const [vista, setVista] = useState<{ cuenta: string | null; revision: number; datos: DatosDashboard | null; cargando: boolean; error: string | null }>({ cuenta: null, revision: -1, datos: null, cargando: true, error: null })
  const cargandoRef = useRef(false)
  useEffect(() => {
    if (!cuenta) return
    let vigente = true
    const controller = new AbortController()
    cargandoRef.current = true
    const limite = window.setTimeout(() => controller.abort(), 20000)
    void consultarDashboardAdministracion(cuenta, controller.signal).then(datos => {
      if (vigente) setVista({ cuenta, revision, datos, cargando: false, error: null })
    }).catch(() => {
      if (vigente) setVista({ cuenta, revision, datos: null, cargando: false, error: 'No se pudo actualizar el Dashboard. Revisa la conexión y vuelve a intentar.' })
    }).finally(() => {
      window.clearTimeout(limite)
      if (vigente) cargandoRef.current = false
    })
    return () => { vigente = false; window.clearTimeout(limite); controller.abort(); cargandoRef.current = false }
  }, [cuenta, revision])
  const actual = cuenta && cuenta === vista.cuenta && vista.revision === revision ? vista : { cuenta, datos: null, cargando: !!cuenta, error: null }
  return { ...actual, actualizar: () => { if (cuenta && !cargandoRef.current) setRevision(n => n + 1) } }
}
