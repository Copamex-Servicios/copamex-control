import { supabase } from './supabase'
import { useAuthStore } from '../stores/authStore'
import { configuracionAdmin, ErrorAdmin, exigirAdmin, leerFilaAdmin } from './administracion'
import type { FilaAdmin } from './administracion'

function exigirCalidad(cuenta: string): void {
  exigirAdmin(cuenta)
  if (useAuthStore.getState().perfil?.rol !== 'calidad') throw new ErrorAdmin('Solo Calidad puede agregar papeles desde esta opción.')
}

export const normalizarNombrePapel = (nombre: string): string => nombre.trim().replace(/\s+/g, ' ').toLocaleUpperCase('es-MX')

export async function consultarPapelesCalidad(cuenta: string, signal: AbortSignal): Promise<FilaAdmin[]> {
  exigirCalidad(cuenta)
  const filas: FilaAdmin[] = [], ids = new Set<string>()
  for (let offset = 0; ; offset += 200) {
    signal.throwIfAborted()
    const { data, error } = await supabase.from('catalogo_papeles').select('id,maquina_id,nombre,activo')
      .order('id').range(offset, offset + 199).abortSignal(signal)
    exigirCalidad(cuenta); signal.throwIfAborted()
    if (error || !Array.isArray(data)) throw new ErrorAdmin('No se pudo actualizar el catálogo de papeles. Reintenta al volver a esta ventana.')
    for (const valor of data) {
      const fila = leerFilaAdmin(valor, configuracionAdmin('catalogo_papeles'))
      if (ids.has(fila.id)) throw new ErrorAdmin('El catálogo cambió durante la consulta. Vuelve a actualizarlo.')
      ids.add(fila.id); filas.push(fila)
    }
    if (data.length < 200) return filas
  }
}

export async function guardarPapelCalidad(cuenta: string, maquina: string, nombre: string, catalogo: readonly FilaAdmin[]): Promise<{ papel: FilaAdmin; existente: boolean }> {
  exigirCalidad(cuenta)
  const normalizado = normalizarNombrePapel(nombre)
  if (!maquina) throw new ErrorAdmin('Selecciona una máquina.')
  if (!normalizado || normalizado.length > 200) throw new ErrorAdmin('Escribe un nombre de papel de 1 a 200 caracteres.')
  const coincidencias = catalogo.filter(p => p.maquina_id === maquina && normalizarNombrePapel(String(p.nombre)) === normalizado)
  const existente = coincidencias.find(p => p.activo === true) ?? coincidencias[0]
  if (existente) {
    if (existente.activo !== true) throw new ErrorAdmin('Este papel está inactivo. Solicita su activación a Administración.')
    return { papel: existente, existente: true }
  }
  // Sin alternativa de INSERT directo ni uso de la RPC anterior.
  const { data, error } = await Promise.resolve(supabase.rpc('obtener_o_crear_papel_calidad', { p_maquina: maquina, p_nombre: normalizado }))
    .catch(() => { throw new ErrorAdmin('No se confirmó el guardado del papel. Conserva el nombre y reintenta.') })
  exigirCalidad(cuenta)
  if (error) {
    if (['PGRST202','42883'].includes(error.code)) throw new ErrorAdmin('El alta de papeles aún no está habilitada en Supabase. Puedes seguir seleccionando papeles existentes.')
    if (error.code === '42501') throw new ErrorAdmin('Supabase no autorizó el alta de este papel. Comprueba tu sesión de Calidad.')
    throw new ErrorAdmin(error.code === '22023' ? error.message : 'No se confirmó el guardado del papel. Conserva el nombre y reintenta.')
  }
  const papel = leerFilaAdmin(Array.isArray(data) ? data[0] : data, configuracionAdmin('catalogo_papeles'))
  if (papel.maquina_id !== maquina || papel.activo !== true || normalizarNombrePapel(String(papel.nombre)) !== normalizado) throw new ErrorAdmin('No se pudo comprobar el papel guardado. Actualiza el catálogo antes de reintentar.')
  return { papel, existente: false }
}
