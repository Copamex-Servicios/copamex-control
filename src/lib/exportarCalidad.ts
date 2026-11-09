import type { RegistroCalidad, ResultadoCalidad } from './tiposCalidad'
import { formatearNumeroCalidad as numero } from './formatoCalidad.ts'
import { crearXlsxReporte } from './xlsxReporte.ts'
import type { HojaReporte } from './xlsxReporte'

export function hojaResultadosCalidad(resultados: readonly ResultadoCalidad[]): HojaReporte {
  return {
    nombre: 'Resultados', titulo: '', contexto: '', soloTabla: true,
    columnas: ['Punto', 'Parámetro', 'Valor', 'Límites', 'Evaluación'],
    filas: resultados.map(r => [
      r.punto.nombre,
      r.parametro.nombre + (r.parametro.unidad ? ` (${r.parametro.unidad})` : ''),
      r.valor,
      r.limite_min_aplicado === null && r.limite_max_aplicado === null ? 'Sin límites'
        : [r.limite_min_aplicado !== null ? `≥ ${numero(r.limite_min_aplicado)}` : '', r.limite_max_aplicado !== null ? `≤ ${numero(r.limite_max_aplicado)}` : ''].filter(Boolean).join(' · '),
      r.fuera_norma === null ? 'Sin límites' : r.fuera_norma ? 'Fuera de norma' : 'Dentro de norma',
    ]),
  }
}

export function descargarResultadosCalidad(registro: RegistroCalidad, resultados: readonly ResultadoCalidad[]): void {
  const bytes = crearXlsxReporte([hojaResultadosCalidad(resultados)])
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
