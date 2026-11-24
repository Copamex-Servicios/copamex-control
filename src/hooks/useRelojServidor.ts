import { useCallback, useSyncExternalStore } from 'react'
import { useAuthStore } from '../stores/authStore'
import { supabase } from '../lib/supabase'
import { esFechaOperativa } from '../lib/turnos'
import type { AreaOperativa } from '../lib/tiposTurno'

type EstadoReloj = 'cargando' | 'listo' | 'error'

interface VistaReloj {
  fecha: string | null
  hora: string | null
  estado: EstadoReloj
}

interface IdentidadReloj {
  cuentaId: string
  area: AreaOperativa
  clave: string
}

interface FuenteReloj extends IdentidadReloj {
  vista: VistaReloj
  suscriptores: Set<() => void>
  activa: boolean
  revision: number
  control: AbortController | null
  siguiente: number | null
  regreso: number | null
  detener: number | null
  alEnfocar: () => void
  alCambiarVisibilidad: () => void
}

const VISTA_CARGANDO: VistaReloj = Object.freeze({ fecha: null, hora: null, estado: 'cargando' })
const fuentes = new Map<string, FuenteReloj>()

function identidadActiva(auth: ReturnType<typeof useAuthStore.getState>): IdentidadReloj | null {
  const { estado, sesion, perfil } = auth
  if (estado !== 'autenticado' || !sesion || !perfil || perfil.activo !== true
    || perfil.id !== sesion.user.id || (perfil.rol !== 'calderas' && perfil.rol !== 'ptar')) return null
  const area = perfil.rol as AreaOperativa
  return { cuentaId: perfil.id, area, clave: `${perfil.id}:${area}` }
}

function identidadSigueVigente(fuente: FuenteReloj): boolean {
  const actual = identidadActiva(useAuthStore.getState())
  return actual?.clave === fuente.clave
}

function publicar(fuente: FuenteReloj, vista: VistaReloj): void {
  fuente.vista = vista
  fuente.suscriptores.forEach(avisar => avisar())
}

function cancelar(fuente: FuenteReloj): void {
  fuente.revision += 1
  fuente.control?.abort()
  fuente.control = null
  if (fuente.siguiente !== null) window.clearTimeout(fuente.siguiente)
  if (fuente.regreso !== null) window.clearTimeout(fuente.regreso)
  fuente.siguiente = null
  fuente.regreso = null
}

async function consultar(fuente: FuenteReloj): Promise<void> {
  if (!fuente.activa || !fuente.suscriptores.size || document.visibilityState !== 'visible'
    || fuente.control !== null || !identidadSigueVigente(fuente)) return
  if (fuente.siguiente !== null) window.clearTimeout(fuente.siguiente)
  fuente.siguiente = null

  const revision = ++fuente.revision
  const peticion = new AbortController()
  fuente.control = peticion
  if (fuente.vista.estado !== 'listo') publicar(fuente, VISTA_CARGANDO)
  let limite: number | null = null
  let alCancelar: (() => void) | null = null
  let excedioTiempo = false
  const espera = new Promise<never>((_resolver, rechazar) => {
    alCancelar = () => rechazar(new Error('Consulta cancelada'))
    peticion.signal.addEventListener('abort', alCancelar, { once: true })
    limite = window.setTimeout(() => {
      excedioTiempo = true
      rechazar(new Error('Consulta sin respuesta'))
      peticion.abort()
    }, 15000)
  })
  const esActual = () => fuente.activa && revision === fuente.revision
    && identidadSigueVigente(fuente)

  try {
    const { data, error } = await Promise.race([
      Promise.resolve(supabase.rpc('consultar_reloj_operativo').abortSignal(peticion.signal)),
      espera,
    ])
    if (!esActual()) return
    if (error || !data || typeof data !== 'object' || Array.isArray(data)
      || !esFechaOperativa(data.fecha) || typeof data.hora !== 'string'
      || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(data.hora)) {
      throw new Error('Respuesta de reloj inválida')
    }
    const [anio, mes, dia] = data.fecha.split('-')
    publicar(fuente, { fecha: `${dia}/${mes}/${anio}`, hora: data.hora, estado: 'listo' })
  } catch {
    if (esActual() && (!peticion.signal.aborted || excedioTiempo)) {
      publicar(fuente, { fecha: null, hora: null, estado: 'error' })
    }
  } finally {
    if (limite !== null) window.clearTimeout(limite)
    if (alCancelar) peticion.signal.removeEventListener('abort', alCancelar)
    if (esActual()) {
      fuente.control = null
      if (document.visibilityState === 'visible' && fuente.suscriptores.size) {
        fuente.siguiente = window.setTimeout(() => {
          fuente.siguiente = null
          void consultar(fuente)
        }, 60000)
      }
    }
  }
}

function programarRegreso(fuente: FuenteReloj): void {
  if (document.visibilityState !== 'visible' || fuente.regreso !== null) return
  if (fuente.siguiente !== null) window.clearTimeout(fuente.siguiente)
  fuente.siguiente = null
  // focus y visibilitychange suelen ocurrir juntos; una consulta basta para ambos.
  fuente.regreso = window.setTimeout(() => {
    fuente.regreso = null
    if (document.visibilityState === 'visible') void consultar(fuente)
  }, 50)
}

function crearFuente(identidad: IdentidadReloj): FuenteReloj {
  const fuente: FuenteReloj = {
    ...identidad,
    vista: VISTA_CARGANDO,
    suscriptores: new Set(),
    activa: false,
    revision: 0,
    control: null,
    siguiente: null,
    regreso: null,
    detener: null,
    alEnfocar: () => programarRegreso(fuente),
    alCambiarVisibilidad: () => {
      if (document.visibilityState === 'hidden') cancelar(fuente)
      else programarRegreso(fuente)
    },
  }
  return fuente
}

function obtenerFuente(clave: string): FuenteReloj | null {
  return fuentes.get(clave) ?? null
}

function iniciar(fuente: FuenteReloj): void {
  if (fuente.activa) return
  fuente.activa = true
  window.addEventListener('focus', fuente.alEnfocar)
  document.addEventListener('visibilitychange', fuente.alCambiarVisibilidad)
  void consultar(fuente)
}

function suscribir(clave: string, avisar: () => void): () => void {
  const identidad = identidadActiva(useAuthStore.getState())
  if (!identidad || identidad.clave !== clave) return () => {}
  const fuente = fuentes.get(clave) ?? crearFuente(identidad)
  fuentes.set(clave, fuente)
  if (fuente.detener !== null) window.clearTimeout(fuente.detener)
  fuente.detener = null
  fuente.suscriptores.add(avisar)
  iniciar(fuente)
  return () => {
    fuente.suscriptores.delete(avisar)
    if (fuente.suscriptores.size || fuente.detener !== null) return
    // El breve aplazamiento evita reiniciar la RPC durante el ciclo de efectos de StrictMode.
    fuente.detener = window.setTimeout(() => {
      fuente.detener = null
      if (fuente.suscriptores.size) return
      fuente.activa = false
      cancelar(fuente)
      window.removeEventListener('focus', fuente.alEnfocar)
      document.removeEventListener('visibilitychange', fuente.alCambiarVisibilidad)
      if (fuentes.get(clave) === fuente) fuentes.delete(clave)
    }, 0)
  }
}

export function useRelojServidor(): VistaReloj {
  const identidad = identidadActiva(useAuthStore())
  const clave = identidad?.clave ?? null
  const escuchar = useCallback((avisar: () => void) => clave ? suscribir(clave, avisar) : () => {}, [clave])
  const leer = useCallback(() => clave ? obtenerFuente(clave)?.vista ?? VISTA_CARGANDO : VISTA_CARGANDO, [clave])
  const vista = useSyncExternalStore(escuchar, leer, leer)
  if (!identidad) return VISTA_CARGANDO
  return vista
}
