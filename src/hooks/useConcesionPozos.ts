import { useEffect, useRef, useState } from 'react'
import { cacheConsultas } from '../lib/cacheConsultas'
import { useAuthStore } from '../stores/authStore'
import { consultarConcesionPozos } from '../lib/concesionPozos'
import type { ResumenConcesion } from '../lib/concesionPozos'

function anioMexico(): number {
  return Number(new Intl.DateTimeFormat('en', { timeZone: 'America/Mexico_City', year: 'numeric' }).format(new Date()))
}
interface Vista { clave: string; resumen: ResumenConcesion | null; error: string | null; cargando: boolean; actualizadoEn: string | null }

const cache = cacheConsultas<Vista>('concesion')

export function useConcesionPozos(revision: number) {
  const auth = useAuthStore()
  const cuenta = auth.estado === 'autenticado' && auth.perfil?.activo && auth.perfil.id === auth.sesion?.user.id
    && ['calderas', 'admin'].includes(auth.perfil.rol) ? auth.perfil.id : null
  const [anio] = useState(anioMexico)
  const revisionAnterior = useRef(revision)
  const [vista, setVista] = useState<Vista>({ clave: '', resumen: null, error: null, cargando: true, actualizadoEn: null })
  const clave = `${cuenta}:${anio}`

  useEffect(() => {
    const forzarConsulta = revision !== revisionAnterior.current
    revisionAnterior.current = revision
    const reciente = forzarConsulta ? null : cache.leer(clave)
    if (reciente) {
      setVista({ ...reciente, cargando: false, error: null })
      return
    }
    const guardarCache = cache.preparar()
    if (!cuenta) return
    const control = new AbortController()
    // Evita duplicar la consulta al montar y al cargar los demás datos de Pozos.
    const timer = window.setTimeout(() => {
      setVista(v => ({ ...(v.clave === clave ? v : cache.leer(clave) ?? { clave, resumen: null, actualizadoEn: null }), error: null, cargando: true }))
      void consultarConcesionPozos(anio, control.signal).then(resumen => {
        if (!control.signal.aborted) {
          const siguiente = { clave, resumen, error: null, cargando: false, actualizadoEn: new Date().toISOString() }
          guardarCache(clave, siguiente); setVista(siguiente)
        }
      }).catch(error => {
        if (!control.signal.aborted) setVista(v => ({ ...(v.clave === clave ? v : cache.leer(clave) ?? { clave, resumen: null, actualizadoEn: null }), error: error instanceof Error ? error.message : 'No se pudo consultar el acumulado.', cargando: false }))
      }).finally(() => { window.clearTimeout(limite) })
    }, 200)
    const limite = window.setTimeout(() => {
      setVista(v => ({ ...(v.clave === clave ? v : cache.leer(clave) ?? { clave, resumen: null, actualizadoEn: null }), error: 'La consulta anual tardó demasiado. Actualiza Pozos para reintentar.', cargando: false }))
      control.abort()
    }, 20000)
    return () => { window.clearTimeout(timer); window.clearTimeout(limite); control.abort() }
  }, [cuenta, clave, anio, revision])

  const actual = cuenta && vista.clave === clave ? vista : (cuenta ? cache.leer(clave) : null) ?? { resumen: null, error: null, cargando: true, actualizadoEn: null }
  return { ...actual, anio }
}
