import { useEffect, useRef, useState } from 'react'
import { useAuth } from './useAuth'
import { consultarReporte } from '../lib/reportes'
import type { ConsultaReporte } from '../lib/reportes'
import type { FiltrosPlanta } from '../lib/planta'

export function useReportes() {
  const { estado, perfil, sesion } = useAuth()
  const cuenta = estado === 'autenticado' && perfil?.activo === true && perfil.id === sesion?.user.id && perfil.rol === 'admin' ? perfil.id : null
  const contexto = cuenta ? `${cuenta}:${perfil?.rol}` : null
  const [vista, setVista] = useState<{ contexto: string | null; reporte: ConsultaReporte | null; cargando: boolean; error: string | null }>({ contexto: null, reporte: null, cargando: false, error: null })
  const peticion = useRef<AbortController | null>(null), secuencia = useRef(0)
  useEffect(() => () => { secuencia.current++; peticion.current?.abort() }, [contexto])
  async function generar(filtros: FiltrosPlanta, auditoria: boolean) {
    if (!cuenta) return
    peticion.current?.abort(); const controller = new AbortController(), version = ++secuencia.current
    peticion.current = controller
    setVista({ contexto, reporte: null, cargando: true, error: null })
    try { const reporte = await consultarReporte(cuenta, filtros, auditoria, controller.signal); if (version === secuencia.current && !controller.signal.aborted) setVista({ contexto, reporte, cargando: false, error: null }) }
    catch (e) { if (version === secuencia.current && !controller.signal.aborted) setVista({ contexto, reporte: null, cargando: false, error: e instanceof Error ? e.message : 'No se pudo generar el reporte.' }) }
  }
  const actual = vista.contexto === contexto && cuenta ? vista : { reporte: null, cargando: false, error: null }
  return { ...actual, generar, admin: perfil?.rol === 'admin' }
}
