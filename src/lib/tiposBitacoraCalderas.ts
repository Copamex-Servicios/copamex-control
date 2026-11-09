// Borrador visual por turno. No representa una captura persistida ni una cola offline.
export const equiposCalderas = [
  { id: 'caldera_2', nombre: 'Caldera 2' }, { id: 'caldera_3', nombre: 'Caldera 3' },
  { id: 'caldera_5', nombre: 'Caldera 5' }, { id: 'caldera_6', nombre: 'Caldera 6' },
  { id: 'sulzer_436', nombre: 'Sulzer 435' }, { id: 'sulzer_456', nombre: 'Sulzer 456' },
  { id: 'sulzer_469', nombre: 'Sulzer 469' }, { id: 'sulzer_470', nombre: 'Sulzer 470' },
] as const
export type EquipoCalderas = typeof equiposCalderas[number]['id']
export type EstadoCalderas = '' | 'Servicio' | 'Reserva' | 'Mantenimiento'
export type EstadoUFBitacora = '' | 'Servicio' | 'Alarmada (F/S)' | 'Lavado'
export type EstadoCompresor = '' | 'Servicio' | 'Preparado' | 'Mantenimiento'
export const pilasCalderas = [
  { id: 'pila_1_3', nombre: 'Pila 1 y 3', unidadPresion: 'bar', bombas: ['740', '741'] },
  { id: 'pila_2', nombre: 'Pila 2', unidadPresion: 'kg/cm²', bombas: ['185', '186', '187'] },
  { id: 'pila_calderas', nombre: 'Pila Calderas', unidadPresion: 'kg/cm²', bombas: ['406', '405'] },
  { id: 'pila_4', nombre: 'Pila 4', unidadPresion: 'kg/cm²', bombas: ['1034', '1035'] },
] as const
export type PilaCalderas = typeof pilasCalderas[number]['id']
export const equiposAguaCalderas = [
  { id: 'norte', nombre: 'Bomba Norte' }, { id: 'sur', nombre: 'Bomba Sur' },
  { id: 'pozo1', nombre: 'Pozo 1' }, { id: 'pozo2', nombre: 'Pozo 2' },
] as const
export type CampoCalderas = 'nivel_condensado' | 'presion_432' | 'presion_433' | 'presion_422' | 'presion_424'
  | 'flujo_osmosis' | 'flujo_uf' | 'nivel_rotoplas' | 'presion_aire' | 'nivel_agua_potable'
export interface BorradorBitacoraCalderas {
  reporteRelevante: string
  equipos: Record<EquipoCalderas, { estado: EstadoCalderas; presion: string }>
  mediciones: Record<CampoCalderas, string>
  pilas: Record<PilaCalderas, { nivel: string; bomba: string; presion: string }>
  compresores: Record<'1' | '2' | '3' | '4', EstadoCompresor>
  estadoUF: EstadoUFBitacora
  comentariosPilas: string
  comentariosUF: string
  servicioAgua: Record<typeof equiposAguaCalderas[number]['id'], boolean>
}
export function borradorBitacoraCalderas(): BorradorBitacoraCalderas {
  return {
    reporteRelevante: '',
    equipos: Object.fromEntries(equiposCalderas.map(e => [e.id, { estado: '', presion: '' }])) as BorradorBitacoraCalderas['equipos'],
    mediciones: { nivel_condensado: '', presion_432: '', presion_433: '', presion_422: '', presion_424: '',
      flujo_osmosis: '', flujo_uf: '', nivel_rotoplas: '', presion_aire: '', nivel_agua_potable: '' },
    pilas: Object.fromEntries(pilasCalderas.map(p => [p.id, { nivel: '', bomba: '', presion: '' }])) as BorradorBitacoraCalderas['pilas'],
    compresores: { '1': '', '2': '', '3': '', '4': '' }, estadoUF: '', comentariosUF: '', comentariosPilas: '',
    servicioAgua: { norte: false, sur: false, pozo1: false, pozo2: false },
  }
}
