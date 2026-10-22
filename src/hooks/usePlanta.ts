import { useEffect, useRef, useState } from 'react'
import { cacheConsultas } from '../lib/cacheConsultas'
import { useAuth } from './useAuth'
import { useAuthStore } from '../stores/authStore'
import { supabase } from '../lib/supabase'
import { consultarPlanta } from '../lib/planta'
import type { DatosPlanta, FiltrosPlanta } from '../lib/planta'

interface EstadoPlanta { clave: string; datos: DatosPlanta | null; cargando: boolean; error: boolean; actualizado: string | null; conectado: boolean }
const cache = cacheConsultas<{ datos: DatosPlanta; actualizado: string }>('planta')
export function usePlanta(filtros: FiltrosPlanta) {
  const { perfil, sesion, estado } = useAuth()
  const cuenta = estado === 'autenticado' && perfil?.activo === true && perfil.id === sesion?.user.id ? perfil.id : null
  const clave = JSON.stringify([cuenta, filtros.desde, filtros.hasta, filtros.area, filtros.turno])
  const [vista, establecer] = useState<EstadoPlanta>({ clave: '', datos: null, cargando: false, error: false, actualizado: null, conectado: false })
  const anterior = cuenta ? cache.leer(clave) : null
  const solicitar = useRef<() => void>(() => {})
  useEffect(() => {
    if (!cuenta) return
    const guardarCache = cache.preparar()
    const signal = new AbortController()
    let vigente = true, trabajando = false, pendiente = false, debounce: ReturnType<typeof setTimeout> | null = null
    const valida = () => {
      const a = useAuthStore.getState()
      return vigente && a.estado === 'autenticado' && a.perfil?.activo === true && a.perfil.id === cuenta && a.sesion?.user.id === cuenta
    }
    let ultimaConsulta = 0
    async function cargar(repetirSiOcupado = true) {
      if (!valida()) return
      if (trabajando) { if (repetirSiOcupado) pendiente = true; return }
      pendiente = false
      trabajando = true
      establecer(v => v.clave === clave ? { ...v, cargando: true } : { clave, datos: cache.leer(clave)?.datos ?? null, cargando: true, error: false, actualizado: cache.leer(clave)?.actualizado ?? null, conectado: false })
      try {
        const datos = await consultarPlanta(filtros, signal.signal)
        if (valida()) {
          const actualizado = new Date().toISOString()
          guardarCache(clave, { datos, actualizado })
          establecer(v => ({ ...v, clave, datos, cargando: false, error: false, actualizado }))
        }
      } catch {
        if (valida()) establecer(v => ({ ...v, cargando: false, error: true }))
      } finally {
        ultimaConsulta = Date.now()
        trabajando = false
        if (pendiente && valida() && document.visibilityState === 'visible') { pendiente = false; void cargar() }
      }
    }
    const actualizar = () => { void cargar() }
    const cambio = () => {
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => {
        debounce = null
        if (document.visibilityState === 'visible') actualizar()
        else pendiente = true
      }, 400)
    }
    // Foco y visibilidad suelen llegar juntos; una consulta en curso ya los atiende.
    const despertar = () => {
      if (document.visibilityState === 'visible' && (pendiente || Date.now() - ultimaConsulta >= 1000)) {
        void cargar(false)
      }
    }
    solicitar.current = actualizar
    void cargar()
    const channel = supabase.channel(`planta:${cuenta}:${crypto.randomUUID()}`)
    for (const tabla of ['turnos_operativos', 'operadores', 'lecturas_pozos', 'lecturas_uf', 'lecturas_ptar', 'muestras_calidad', 'resultados_calidad', 'puntos_muestreo', 'parametros_calidad']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table: tabla }, cambio)
    }
    channel.subscribe(status => {
      if (valida()) establecer(v => ({ ...v, conectado: status === 'SUBSCRIBED' }))
      if (status === 'SUBSCRIBED' && valida()) cambio()
    })
    const intervalo = setInterval(despertar, 30000)
    window.addEventListener('focus', despertar); window.addEventListener('online', despertar)
    document.addEventListener('visibilitychange', despertar)
    return () => {
      vigente = false; signal.abort(); solicitar.current = () => {}
      if (debounce) clearTimeout(debounce)
      clearInterval(intervalo); window.removeEventListener('focus', despertar); window.removeEventListener('online', despertar)
      document.removeEventListener('visibilitychange', despertar)
      void supabase.removeChannel(channel)
    }
  }, [cuenta, clave, filtros])
  const actual = cuenta && vista.clave === clave ? vista : { clave, datos: anterior?.datos ?? null, cargando: !!cuenta, error: false, actualizado: anterior?.actualizado ?? null, conectado: false }
  return { ...actual, actualizar: () => solicitar.current() }
}
