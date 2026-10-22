import { useAuthStore } from '../stores/authStore'

// Datos de lectura en memoria: no persisten ni conservan formularios o credenciales.
const entradas = new Map<string, { valor: unknown; vence: number }>()
function identidad() {
  const a = useAuthStore.getState()
  return a.estado === 'autenticado' && a.perfil?.activo && a.perfil.id === a.sesion?.user.id
    ? a.perfil.id + ':' + a.perfil.rol : null
}
let generacion = 0
let cuenta = identidad()
useAuthStore.subscribe(() => {
  const siguiente = identidad()
  if (siguiente !== cuenta) { entradas.clear(); generacion++; cuenta = siguiente }
})
export function cacheConsultas<T>(nombre: string) {
  const clave = (filtro: string) => JSON.stringify([identidad(), nombre, filtro])
  return {
    leer(filtro: string): T | null {
      if (!identidad()) return null
        const k = clave(filtro), entrada = entradas.get(k)
      if (!entrada) return null
      if (entrada.vence <= Date.now()) { entradas.delete(k); return null }
      return entrada.valor as T
    },
    preparar() {
      const version = generacion
      return (filtro: string, valor: T): void => {
        if (!identidad() || version !== generacion) return
        const k = clave(filtro)
        entradas.delete(k)
        entradas.set(k, { valor, vence: Date.now() + 120000 })
        // Limita memoria incluso cuando se consultan muchos filtros o paginas.
        while (entradas.size > 40) entradas.delete(entradas.keys().next().value!)
      }
    },
  }
}
