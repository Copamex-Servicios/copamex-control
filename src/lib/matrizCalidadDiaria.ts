import type { DiaCompletoCalidad } from './reporteDiarioCalidad'
import { prepararDiaCompletoCalidad } from './reporteDiarioCalidad'
import type { ResultadoCalidad } from './tiposCalidad'
import { formatearNumeroCalidad } from './formatoCalidad'
import { compararPuntoParametroCalidad } from './hojaRegistroCalidad'

export const tituloCalidadFisico = 'PARÁMETROS DE IMPACTO DE CALIDAD DE AGUA'
export const nombresTurnoCalidad = { dia: 'Día', tarde: 'Tarde', noche: 'Noche' } as const
const fechaHoraRegistro = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'})
function partesFechaHora(instantanea: string) {
  const partes = fechaHoraRegistro.formatToParts(new Date(instantanea))
  const obtener = (tipo: Intl.DateTimeFormatPartTypes) => partes.find(parte => parte.type === tipo)?.value ?? '00'
  const fecha = obtener('year') + '-' + obtener('month') + '-' + obtener('day')
  const hora = obtener('hour') + ':00'
  return {fecha, dia:obtener('day'), hora, clave:fecha + 'T' + hora}
}
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
  const ordenadas = [...columnas.values()].sort((a,b) => compararPuntoParametroCalidad(a,b) || a.clave.localeCompare(b.clave))
  const indices = new Map<string,number>(ordenadas.map((columna,indice) => [columna.clave,indice] as const))
  const turnos = completo.turnos.map(t => {
    const porHora = new Map<string,{id:string;turnoId:string;fechaLocal:string;dia:string;hora:string;operadores:Set<string>;comentarios:Set<string>;valores:number[][]}>()
    for (const muestra of t.muestras) {
      const tiempo = partesFechaHora(muestra.lectura.capturado_en)
      let fila = porHora.get(tiempo.clave)
      if (!fila) {
        fila = {id:muestra.turno.id + ':' + tiempo.clave,turnoId:muestra.turno.id,fechaLocal:tiempo.fecha,dia:tiempo.dia,hora:tiempo.hora,operadores:new Set(),comentarios:new Set(),valores:ordenadas.map(() => [])}
        porHora.set(tiempo.clave,fila)
      }
      fila.operadores.add(muestra.operadorNombre)
      const nota = muestra.lectura.notas?.trim()
      if (nota) fila.comentarios.add(`${muestra.operadorNombre}: ${nota}`)
      for (const resultado of muestra.lectura.resultados) {
        const indice = indices.get(claveColumna(resultado))
        if (indice === undefined) throw new Error('No se pudo ubicar un resultado en la hoja de Calidad.')
        fila.valores[indice].push(resultado.valor)
      }
    }
    return {
      tipo:t.tipo,
      operadores:[...new Set(t.muestras.map(m => m.operadorNombre))],
      filas:[...porHora.values()].sort((a,b) => a.fechaLocal.localeCompare(b.fechaLocal) || a.hora.localeCompare(b.hora)).map(f => ({
        id:f.id,turnoId:f.turnoId,fechaLocal:f.fechaLocal,dia:f.dia,hora:f.hora,operador:[...f.operadores].join(' · '),
        notas:f.comentarios.size ? [...f.comentarios].join('\n') : null,
        valores:f.valores.map(v => v.length === 0 ? null : v.length === 1 ? v[0] : v.map(formatearNumeroCalidad).join(' / ')),
      })),
    }
  })
  return {fecha:completo.solicitud.fechaOperativa,area:completo.solicitud.area,total:completo.totalMuestras,columnas:ordenadas,turnos}

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
  return turno.operadores.flatMap(fragmentosTextoCalidad)
}
export function bloquesColumnasCalidad(m: MatrizCalidadDiaria) {
  // Cada bloque conserva los mismos horarios: continúa columnas, no duplica capturas.
  return Array.from({length:Math.max(1,Math.ceil(m.columnas.length/12))},(_,i) => ({ inicio:i*12, columnas:m.columnas.slice(i*12,i*12+12) }))
}
