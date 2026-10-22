import { useRef, useState } from 'react'
type Campo = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
export interface FaltaReporte { campo: Campo; seccion: number; nombre: string }
export function revisarCamposReporte(raiz: HTMLElement): FaltaReporte[] {
  const paneles = Array.from(raiz.querySelectorAll<HTMLElement>('[role="tabpanel"]'))
  const faltas: FaltaReporte[] = []
  paneles.slice(0, -1).forEach((panel, seccion) => {
    const radios = new Set<string>()
    panel.querySelectorAll<Campo>('input,select,textarea').forEach(campo => {
      campo.removeAttribute('aria-invalid')
      if (campo.matches(':disabled') || campo.id.endsWith('-uf-comentarios') || campo.id.endsWith('-comentario-prensas')) return
      // Una casilla desmarcada significa fuera de servicio, no una respuesta faltante.
      if (campo instanceof HTMLInputElement && campo.type === 'checkbox') return
      let vacio = !campo.value.trim() || !campo.validity.valid
      if (campo instanceof HTMLInputElement && campo.type === 'radio') {
        if (radios.has(campo.name)) return
        radios.add(campo.name)
        vacio = !Array.from(panel.querySelectorAll<HTMLInputElement>('input[type="radio"]')).some(r => r.name === campo.name && r.checked)
      }
      if (!vacio) return
      campo.setAttribute('aria-invalid', 'true')
      const nombre = campo.type === 'radio' ? campo.closest('fieldset')?.querySelector('legend')?.textContent
        : campo.getAttribute('aria-label') || campo.closest('label')?.querySelector('span')?.textContent
      faltas.push({ campo, seccion, nombre: nombre?.trim() || 'Campo pendiente' })
    })
  })
  return faltas
}
export function useValidacionReporte() {
  const raiz = useRef<HTMLDivElement>(null)
  const intentado = useRef(false)
  const [faltas, setFaltas] = useState<FaltaReporte[]>([])
  function revisar() {
    intentado.current = true
    const resultado = raiz.current ? revisarCamposReporte(raiz.current) : []
    setFaltas(resultado)
    return resultado
  }
  function alCambiar() {
    if (intentado.current) window.requestAnimationFrame(revisar)
  }
  return { raiz, faltas, revisar, alCambiar }
}
