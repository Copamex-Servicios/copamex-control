import { supabase } from './supabase'
import { useAuthStore } from '../stores/authStore'
import { leerRegistroCalidad, seleccionRegistroCalidad } from './calidad'
import { ordenarMuestrasCalidad } from './consultaMuestrasCalidad'
import { esFechaOperativa } from './turnos'
import type { RegistroCalidad } from './tiposCalidad'
import type { AreaOperativa, TipoTurno } from './tiposTurno'

// Contrato independiente de los filtros, selección y páginas de la pantalla.
export interface SolicitudDiaCompletoCalidad {
  alcance: 'dia-completo'
  fechaOperativa: string
  area: AreaOperativa
}
export interface TurnoDiarioCalidad {
  tipo: TipoTurno
  // Cada registro conserva su turno_id real, operador y resultados históricos completos.
  muestras: readonly RegistroCalidad[]
}
export interface DiaCompletoCalidad {
  solicitud: Readonly<SolicitudDiaCompletoCalidad>
  turnos: readonly TurnoDiarioCalidad[]
  totalMuestras: number
}
export const opcionDiaCompletoCalidad = { alcance: 'dia-completo', etiqueta: 'Exportar día completo' } as const
const loteDiario = 200
const tiposTurno = ['dia', 'tarde', 'noche'] as const
const cambioConsulta = () => new Error('Las muestras del día cambiaron o la consulta está incompleta. Consulta nuevamente antes de exportar.')

function validarSolicitud(s: SolicitudDiaCompletoCalidad): void {
  if (s.alcance !== 'dia-completo' || !esFechaOperativa(s.fechaOperativa)
    || !['calderas', 'ptar'].includes(s.area)) throw new Error('Selecciona una fecha operativa válida y una sola área de Calidad.')
}
function cuentaConsulta(): string {
  const { estado, perfil, sesion } = useAuthStore.getState()
  if (estado !== 'autenticado' || !perfil?.activo || perfil.id !== sesion?.user.id
    || !['admin', 'calidad', 'calderas', 'ptar'].includes(perfil.rol)) throw new Error('Se requiere una cuenta activa autorizada para consultar Calidad.')
  return JSON.stringify([perfil.id, perfil.rol])
}
export function prepararDiaCompletoCalidad(solicitud: SolicitudDiaCompletoCalidad, registros: readonly RegistroCalidad[]): DiaCompletoCalidad {
  validarSolicitud(solicitud)
  const muestras = ordenarMuestrasCalidad(registros)
  if (muestras.some(m => m.turno.fecha_operativa !== solicitud.fechaOperativa || m.turno.area !== solicitud.area
    || m.lectura.turno_id !== m.turno.id || !tiposTurno.includes(m.turno.turno))) throw new Error('Una muestra no corresponde al día, área o turno solicitado.')
  return {
    solicitud: { ...solicitud },
    turnos: tiposTurno.map(tipo => ({ tipo, muestras: muestras.filter(m => m.turno.turno === tipo) })),
    totalMuestras: muestras.length,
  }
}

// Solo SELECT con la sesión actual y RLS existente. No invoca RPC ni exportadores.
// No usa las 20 filas del historial: recorre páginas propias y valida su totalidad.
export async function consultarDiaCompletoCalidad(solicitud: SolicitudDiaCompletoCalidad, signal: AbortSignal): Promise<DiaCompletoCalidad> {
  validarSolicitud(solicitud)
  const s = { ...solicitud }, cuenta = cuentaConsulta()
  const comprobar = () => {
    signal.throwIfAborted()
    if (cuentaConsulta() !== cuenta) throw new Error('La cuenta cambió. Consulta nuevamente Calidad.')
  }
  const consulta = (soloConteo = false) => supabase.from('muestras_calidad')
    .select(seleccionRegistroCalidad, { count: 'exact', head: soloConteo })
    .is('eliminado_en', null).eq('turno.fecha_operativa', s.fechaOperativa).eq('turno.area', s.area)
  const registros: RegistroCalidad[] = [], ids = new Set<string>()
  let total: number | null = null
  for (let offset = 0; ; offset += loteDiario) {
    comprobar()
    const r = await consulta().order('capturado_en', { ascending: true }).order('id', { ascending: true })
      .range(offset, offset + loteDiario - 1).abortSignal(signal)
    comprobar()
    if (r.error) throw new Error('No se pudieron consultar todas las muestras del día. Reintenta.')
    if (r.count === null || !Number.isSafeInteger(r.count) || r.count < 0
      || (total !== null && total !== r.count) || !Array.isArray(r.data)
      || r.data.length !== Math.max(0, Math.min(loteDiario, r.count - offset))) throw cambioConsulta()
    total = r.count
    for (const fila of r.data) {
      const registro = leerRegistroCalidad(fila)
      if (ids.has(registro.lectura.id)) throw cambioConsulta()
      ids.add(registro.lectura.id); registros.push(registro)
    }
    if (registros.length === total) break
  }
  // Detecta altas/bajas que ocurran después de la última página.
  const final = await consulta(true).abortSignal(signal)
  comprobar()
  if (final.error || final.count !== total) throw cambioConsulta()
  return prepararDiaCompletoCalidad(s, registros)
}
