import { useEffect, useState } from 'react'
import type { AvisoDia } from '../lib/informacionDia'

export function useAvisosVigentes(avisos: AvisoDia[]) {
  const [ahora, setAhora] = useState(Date.now)
  const siguienteVencimiento = avisos.reduce((proximo, aviso) => {
    const fin = aviso.fin ? Date.parse(aviso.fin) : Infinity
    return fin > ahora ? Math.min(proximo, fin) : proximo
  }, Infinity)

  useEffect(() => {
    if (!Number.isFinite(siguienteVencimiento)) return
    const demora = Math.min(2_147_483_647, Math.max(0, siguienteVencimiento - Date.now()))
    const temporizador = window.setTimeout(() => setAhora(Date.now()), demora)
    return () => window.clearTimeout(temporizador)
  }, [ahora, siguienteVencimiento])

  return avisos.filter(aviso => !aviso.fin || Date.parse(aviso.fin) > ahora)
}
