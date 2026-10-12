import { useEffect, useRef, useState } from 'react'
import { useAuth } from './useAuth'
import { consultarAdministracion, establecerPendienteAdmin, exigirAdmin, guardarAdministracion, pendienteAdmin, ErrorAdmin } from '../lib/administracion'
import type { DatosAdmin, FilaAdmin, SolicitudAdmin, TablaAdmin } from '../lib/administracion'

export function useAdministracion() {
  const { estado, perfil, sesion } = useAuth()
  const cuenta = estado === 'autenticado' && perfil?.activo === true && ['admin','calidad'].includes(perfil.rol) && perfil.id === sesion?.user.id ? perfil.id : null
  const [vista, setVista] = useState<{ cuenta: string | null; datos: DatosAdmin | null; cargando: boolean; error: string | null; mensaje: string | null; guardando: boolean; pendiente: SolicitudAdmin | null }>({ cuenta: null, datos: null, cargando: false, error: null, mensaje: null, guardando: false, pendiente: null })
  const actualizarRef = useRef<() => void>(() => {})
  const escribiendo = useRef(false)
  useEffect(() => {
    if (!cuenta) return
    const controller = new AbortController()
    let vivo = true, cargando = false, otraConsulta = false
    async function cargar() {
      if (!vivo) return
      if (cargando) { otraConsulta = true; return }
      cargando = true
      setVista(v => v.cuenta === cuenta ? { ...v, cargando: true, error: v.pendiente ? v.error : null } : { cuenta, datos: null, cargando: true, error: null, mensaje: null, guardando: false, pendiente: pendienteAdmin(cuenta!) })
      try {
        const datos = await consultarAdministracion(cuenta!, controller.signal)
        if (vivo) setVista(v => ({ ...v, datos, cargando: false }))
      } catch { if (vivo) setVista(v => ({ ...v, cargando: false, error: 'No se pudo actualizar Administración. Revisa la conexión y vuelve a intentar.' })) }
      finally { cargando = false; if (otraConsulta && vivo) { otraConsulta = false; void cargar() } }
    }
    const actualizar = () => { void cargar() }
    actualizarRef.current = actualizar; void cargar()
    window.addEventListener('focus', actualizar)
    return () => { vivo = false; controller.abort(); actualizarRef.current = () => {}; window.removeEventListener('focus', actualizar) }
  }, [cuenta])

  async function enviar(s: SolicitudAdmin): Promise<FilaAdmin | null> {
    if (escribiendo.current || !cuenta || s.cuenta !== cuenta) return null
    exigirAdmin(cuenta)
    escribiendo.current = true
    establecerPendienteAdmin(cuenta, s)
    setVista(v => ({ ...v, guardando: true, pendiente: s, error: null, mensaje: null }))
    try {
      const fila = await guardarAdministracion(s)
      exigirAdmin(cuenta)
      establecerPendienteAdmin(cuenta, null)
      setVista(v => ({ ...v, guardando: false, pendiente: null, mensaje: 'Registro guardado y confirmado.', error: null }))
      actualizarRef.current()
      return fila
    } catch (e) {
      try { exigirAdmin(cuenta) } catch { return null }
      const incierto = !(e instanceof ErrorAdmin) || e.incierto
      if (!incierto) establecerPendienteAdmin(cuenta, null)
      setVista(v => ({ ...v, guardando: false, pendiente: incierto ? s : null, error: e instanceof Error ? e.message : 'No se confirmó el guardado. Usa Comprobar / reintentar.' }))
      return null
    } finally { escribiendo.current = false }
  }
  async function guardar(tabla: TablaAdmin, valores: SolicitudAdmin['valores'], original: FilaAdmin | null) {
    if (!cuenta || pendienteAdmin(cuenta)) return null
    return enviar(Object.freeze({ cuenta, tabla, id: original?.id ?? crypto.randomUUID(), valores: Object.freeze({ ...valores }), original: original ? Object.freeze({ ...original }) : null }))
  }
  const actual = cuenta && vista.cuenta === cuenta ? vista : { cuenta, datos: null, cargando: !!cuenta, error: null, mensaje: null, guardando: false, pendiente: cuenta ? pendienteAdmin(cuenta) : null }
  return { ...actual, guardar, actualizar: () => actualizarRef.current(), reintentar: async () => cuenta && pendienteAdmin(cuenta) ? enviar(pendienteAdmin(cuenta)!) : null }
}
