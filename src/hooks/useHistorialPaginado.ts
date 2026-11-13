import { useEffect, useRef, useState } from 'react'

interface Lote<T> { registros: T[]; hayMas: boolean }
interface Estado<T> { clave: string; posibleMas: boolean; pagina: number; extras: T[]; hayMas: boolean; cargando: boolean; error: string | null }

export function useHistorialPaginado<T>(iniciales: readonly T[], clave: string, posibleMas: boolean, excluirTurnoId: string | null,
  cargar: (offset: number, signal: AbortSignal, excluirTurnoId: string | null) => Promise<Lote<T>>, tamano = 7) {
  const [guardado, setGuardado] = useState<Estado<T>>({ clave, posibleMas, pagina: 0, extras: [], hayMas: posibleMas, cargando: false, error: null })
  const activos = useRef<AbortController | null>(null)
  const vigente = guardado.clave === clave && guardado.posibleMas === posibleMas
  const estado = vigente ? guardado : { clave, posibleMas, pagina: 0, extras: [], hayMas: posibleMas, cargando: false, error: null }
  useEffect(() => {
    activos.current?.abort(); activos.current = null
    return () => activos.current?.abort()
  }, [clave, posibleMas])
  const registros = [...iniciales, ...estado.extras]
  const visibles = registros.slice(estado.pagina * tamano, (estado.pagina + 1) * tamano)
  function actualizar(cambio: (anterior: Estado<T>) => Estado<T>) {
    setGuardado(anterior => cambio(anterior.clave === clave && anterior.posibleMas === posibleMas
      ? anterior : { clave, posibleMas, pagina: 0, extras: [], hayMas: posibleMas, cargando: false, error: null }))
  }
  async function siguiente() {
    if (estado.cargando) return
    const paginaObjetivo = estado.pagina + 1, finNecesario = (paginaObjetivo + 1) * tamano
    let acumulados = registros, mas = estado.hayMas
    if (paginaObjetivo * tamano < acumulados.length) { actualizar(a => ({ ...a, pagina: paginaObjetivo, error: null })); return }
    if (!mas) return
    const control = new AbortController(); activos.current = control
    actualizar(a => ({ ...a, cargando: true, error: null }))
    try {
      while (acumulados.length < finNecesario && mas) {
        const lote = await cargar(acumulados.length, control.signal, excluirTurnoId)
        if (!lote.registros.length) { mas = false; break }
        acumulados = [...acumulados, ...lote.registros]; mas = lote.hayMas
      }
      if (!control.signal.aborted && activos.current === control) actualizar(a => ({ ...a,
        extras: acumulados.slice(iniciales.length), hayMas: mas,
        pagina: paginaObjetivo * tamano < acumulados.length ? paginaObjetivo : a.pagina,
      }))
    } catch (fallo) {
      if (!control.signal.aborted && activos.current === control) actualizar(a => ({ ...a, error: fallo instanceof Error ? fallo.message : 'No se pudo cargar la siguiente página.' }))
    } finally {
      if (activos.current === control) {
        activos.current = null
        if (!control.signal.aborted) actualizar(a => ({ ...a, cargando: false }))
      }
    }
  }
  function anterior() { actualizar(a => ({ ...a, error: null, pagina: Math.max(0, a.pagina - 1) })) }
  return { pagina: estado.pagina, visibles, hayAnterior: estado.pagina > 0,
    haySiguiente: (estado.pagina + 1) * tamano < registros.length || estado.hayMas,
    siguiente, anterior, cargando: estado.cargando, error: estado.error }
}
