// Borrador visual del reporte técnico: no es una captura persistida ni una cola offline.
export const medicionesBitacoraPTAR = [
  { campo: 'flujo_clarificador', nombre: 'Flujo de entrada al clarificador primario', unidad: 'L/s', seccion: 0 },
  { campo: 'nivel_tanque_11', nombre: 'Nivel del tanque 11', unidad: '%', seccion: 0 },
  { campo: 'nivel_tanque_300', nombre: 'Nivel del tanque 300', unidad: '%', seccion: 0 },
  { campo: 'torque_clarificador', nombre: 'Torque del clarificador', unidad: 'LBS', seccion: 0 },
  { campo: 'setpoint_b13', nombre: 'Setpoint de válvula neumática al colector de la B-13', unidad: '%', seccion: 0 },
  { campo: 'flujo_entrada_ptar', nombre: 'Flujo de entrada a la PTAR', unidad: 'L/s', seccion: 2 },
  { campo: 'flujo_daf_chino', nombre: 'Flujo del DAF Chino', unidad: 'L/s', seccion: 2 },
  { campo: 'nivel_daf_chino', nombre: 'Nivel del DAF Chino', unidad: 'm', seccion: 2 },
  { campo: 'flujo_daf_huber', nombre: 'Flujo del DAF Huber', unidad: 'm³/h', seccion: 2 },
  { campo: 'flujo_reactor_2', nombre: 'Flujo al Reactor 2', unidad: 'L/s', seccion: 2 },
  { campo: 'flujo_aimsu', nombre: 'Flujo general de AIMSU', unidad: 'L/s', seccion: 3 },
  { campo: 'presion_linea', nombre: 'Presión en línea', unidad: 'kg/cm²', seccion: 3 },
  { campo: 'nivel_almacen', nombre: 'Nivel del tanque de almacén', unidad: 'm³', seccion: 3 },
] as const
export type CampoBitacoraPTAR = typeof medicionesBitacoraPTAR[number]['campo']
export const bombasBitacoraPTAR = ['9', '13', '9310'] as const
export const prensasBitacoraPTAR = ['Essity', 'Nalco'] as const
export type ModoBombaPTAR = '' | 'Automático (A)' | 'Manual (M)'
export type EstadoPrensaPTAR = '' | 'Servicio' | 'Reserva' | 'Mantenimiento'
export type EstadoAgitadorPTAR = '' | 'Servicio' | 'Reserva' | 'Mantenimiento'
export const destinosDescargaPTAR = ['Tanque 11', 'Tanques 5 y 6'] as const
export type DestinoDescargaPTAR = '' | typeof destinosDescargaPTAR[number]
export interface BorradorBitacoraPTAR {
  reporteRelevante: string
  estadoAgitador: EstadoAgitadorPTAR
  destinoDescarga: DestinoDescargaPTAR
  mediciones: Record<CampoBitacoraPTAR, string>
  bombas: Record<typeof bombasBitacoraPTAR[number], ModoBombaPTAR>
  prensas: Record<typeof prensasBitacoraPTAR[number], EstadoPrensaPTAR>
  comentarioPrensas: string
}
export function borradorBitacoraPTAR(): BorradorBitacoraPTAR {
  return {
    reporteRelevante: '',
    mediciones: Object.fromEntries(medicionesBitacoraPTAR.map(m => [m.campo, ''])) as BorradorBitacoraPTAR['mediciones'],
    bombas: { '9': '', '13': '', '9310': '' },
    prensas: { Essity: '', Nalco: '' },
    estadoAgitador: '', destinoDescarga: '',
    comentarioPrensas: '',
  }
}
