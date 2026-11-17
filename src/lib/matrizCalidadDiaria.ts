import type { DiaCompletoCalidad } from './reporteDiarioCalidad'
import { prepararDiaCompletoCalidad } from './reporteDiarioCalidad'
import type { ResultadoCalidad } from './tiposCalidad'
import { formatearNumeroCalidad } from './formatoCalidad'

export const tituloCalidadFisico = 'PARÁMETROS DE IMPACTO DE CALIDAD DE AGUA'
export const nombresTurnoCalidad = { dia: 'Día', tarde: 'Tarde', noche: 'Noche' } as const
const horaRegistro = new Intl.DateTimeFormat('es-MX', {timeZone:'America/Mexico_City',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})
const normalizar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '')
// Solo ordena puntos reales. No agrega mediciones ni límites de la fotografía.
const ordenPuntos = [['AIMSU'], ['POZO'], ['PILAM2','PILADEM2'], ['PILACALDERAS'], ['PILAM4','PILADEM4'], ['PEMEX'], ['RETORNO','RETORNOTQE','RETORNOATQEALMACEN','RETORNOATANQUEALMACEN']]
const rangoPunto = (s: string) => { const n = ordenPuntos.findIndex(g => g.includes(normalizar(s))); return n < 0 ? ordenPuntos.length : n }
const rangoParametro = (s: string) => { const n = ['COLOR','TURBIDEZ','SST'].indexOf(normalizar(s)); return n < 0 ? 3 : n }
const claveColumna = (r: ResultadoCalidad) => JSON.stringify([r.punto_id,r.parametro_id,r.parametro.unidad,r.limite_min_aplicado,r.limite_max_aplicado])
export interface ColumnaCalidadDiaria {
  clave: string; puntoId: string; punto: string; parametro: string; unidad: string | null
  minimo: number | null; maximo: number | null
}
export function limiteColumnaCalidad(c: ColumnaCalidadDiaria): string {
  return c.minimo === null && c.maximo === null ? '—'
    : [c.minimo === null ? '' : '≥ ' + formatearNumeroCalidad(c.minimo), c.maximo === null ? '' : '≤ ' + formatearNumeroCalidad(c.maximo)].filter(Boolean).join(' · ')
}
export function matrizCalidadDiaria(dia: DiaCompletoCalidad) {
  const completo = prepararDiaCompletoCalidad(dia.solicitud, dia.turnos.flatMap(t => t.muestras))
  if (completo.totalMuestras !== dia.totalMuestras) throw new Error('El día de Calidad está incompleto.')
  const columnas = new Map<string, ColumnaCalidadDiaria>()
  for (const t of completo.turnos) for (const m of t.muestras) for (const r of m.lectura.resultados) {
    const clave = claveColumna(r)
    columnas.set(clave, { clave, puntoId:r.punto_id, punto:r.punto.nombre, parametro:r.parametro.nombre, unidad:r.parametro.unidad, minimo:r.limite_min_aplicado, maximo:r.limite_max_aplicado })
  }
  const ordenadas = [...columnas.values()].sort((a,b) => rangoPunto(a.punto)-rangoPunto(b.punto) || a.punto.localeCompare(b.punto,'es')
    || rangoParametro(a.parametro)-rangoParametro(b.parametro) || a.parametro.localeCompare(b.parametro,'es') || a.clave.localeCompare(b.clave))
  return { fecha:completo.solicitud.fechaOperativa, area:completo.solicitud.area, total:completo.totalMuestras, columnas:ordenadas,
    turnos:completo.turnos.map(t => ({ tipo:t.tipo, filas:t.muestras.map(m => {
      const valores = new Map(m.lectura.resultados.map(r => [claveColumna(r),r.valor]))
      return { id:m.lectura.id, turnoId:m.turno.id, hora:horaRegistro.format(new Date(m.lectura.capturado_en)), operador:m.operadorNombre, notas:m.lectura.notas,
        valores:ordenadas.map(c => valores.get(c.clave) ?? null) }
    }) })) }
}
export type MatrizCalidadDiaria = ReturnType<typeof matrizCalidadDiaria>
export function fragmentosTextoCalidad(texto: string): string[] {
  const partes:string[]=[];let parte='',ancho=0,lineas=0
  for(const c of texto){
    parte+=c
    if(c==='\n'||++ancho>=100){lineas++;ancho=0}
    if(lineas>=5){partes.push(parte);parte='';lineas=0}
  }
  if(parte||!partes.length)partes.push(parte)
  return partes
}
export function operadoresCalidad(turno: MatrizCalidadDiaria['turnos'][number]): string[] {
  return [...new Set(turno.filas.map(f=>f.operador))].flatMap(fragmentosTextoCalidad)
}
export function bloquesColumnasCalidad(m: MatrizCalidadDiaria) {
  // Cada bloque conserva los mismos horarios: continúa columnas, no duplica capturas.
  return Array.from({length:Math.max(1,Math.ceil(m.columnas.length/12))},(_,i) => ({ inicio:i*12, columnas:m.columnas.slice(i*12,i*12+12) }))
}
