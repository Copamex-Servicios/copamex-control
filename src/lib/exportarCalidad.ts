import type { RegistroCalidad, ResultadoCalidad } from './tiposCalidad'
import { textoLimitesResultadoCalidad, textoEvaluacionCalidad } from './formatoCalidad.ts'
import { crearXlsxReporte } from './xlsxReporte.ts'
import type { HojaReporte } from './xlsxReporte'

export function hojaResultadosCalidad(resultados: readonly ResultadoCalidad[], detallePorResultado: ReadonlyMap<string,string> = new Map()): HojaReporte {
  return {
    nombre: 'Resultados', titulo: '', contexto: '', soloTabla: true,
    columnas: ['Punto', 'Parámetro', 'Valor', 'Límites', 'Evaluación'],
    filas: resultados.map(r => [
      r.punto.nombre,
      r.parametro.nombre + (r.parametro.unidad ? ` (${r.parametro.unidad})` : '')
        + (detallePorResultado.has(r.id) ? '\n' + detallePorResultado.get(r.id) : ''),
      r.valor,
      textoLimitesResultadoCalidad(r.limite_min_aplicado,r.limite_max_aplicado),
      textoEvaluacionCalidad(r.fuera_norma),
    ]),
  }
}

export function descargarResultadosCalidad(registro: RegistroCalidad, resultados: readonly ResultadoCalidad[], detallePorResultado?: ReadonlyMap<string,string>): void {
  const bytes = crearXlsxReporte([hojaResultadosCalidad(resultados,detallePorResultado)])
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  try {
    const enlace = document.createElement('a')
    enlace.href = url
    enlace.download = `Calidad_${registro.turno.area}_${registro.turno.fecha_operativa}_${registro.lectura.id}.xlsx`
    enlace.click()
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000) }
}
