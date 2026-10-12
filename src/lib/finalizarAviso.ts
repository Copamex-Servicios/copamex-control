import { supabase } from './supabase'
import { configuracionAdmin, exigirAdmin, leerFilaAdmin } from './administracion'
import type { FilaAdmin } from './administracion'
import { useAuthStore } from '../stores/authStore'

export async function finalizarAviso(cuenta: string, original: FilaAdmin): Promise<FilaAdmin> {
  exigirAdmin(cuenta)
  const controller = new AbortController()
  const cancelar = useAuthStore.subscribe(() => { try { exigirAdmin(cuenta) } catch { controller.abort() } })
  try {
    const { data, error } = await supabase.rpc('finalizar_aviso',{ p_id:original.id, p_original:original }).abortSignal(controller.signal)
    exigirAdmin(cuenta)
    if (error) {
      if (error.code === 'PGRST202' || error.code === '42883') throw new Error('Falta habilitar Finalizar aviso en Supabase. Ejecuta completo 20261005003800_finalizar_aviso.sql y vuelve a intentar.')
      if (error.code === 'PGRST301' || error.code === 'PGRST302') throw new Error('La sesión venció. Cierra sesión y vuelve a entrar.')
      if (!error.code) throw new Error('No llegó la respuesta de Supabase. Revisa la conexión y reintenta el mismo cierre.')
      throw new Error(`No se pudo finalizar el aviso (${error.code}): ${error.message}`)
    }
    return leerFilaAdmin(Array.isArray(data) ? data[0] : data, configuracionAdmin('avisos'))
  } finally { cancelar() }
}
