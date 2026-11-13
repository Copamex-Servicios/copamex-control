import type { RegistroCalidad } from './tiposCalidad'

export function hojasRegistroCalidad(muestras: readonly RegistroCalidad[], ultimaHabitual: RegistroCalidad | null, adicionales: readonly RegistroCalidad[]) {
  const habituales = muestras.filter(m => !m.lectura.seguimientoId)
  if (ultimaHabitual && !habituales.some(m=>m.lectura.id===ultimaHabitual.lectura.id)) habituales.push(ultimaHabitual)
  habituales.sort((a,b)=>Date.parse(a.lectura.capturado_en)-Date.parse(b.lectura.capturado_en) || a.lectura.id.localeCompare(b.lectura.id))
  const ultima = habituales.at(-1)?.lectura.id
  return (habituales.length ? habituales : [...adicionales]).map(registro=>({
    registro, adicionales:registro.lectura.id===ultima ? adicionales : [],
  }))
}

/** Composición visual: los resultados originales nunca se sustituyen ni se modifican. */
export function resultadosHojaCalidad(registro: RegistroCalidad, adicionales: readonly RegistroCalidad[] = []) {
  if (adicionales.some(m => m.lectura.turno_id !== registro.lectura.turno_id || m.turno.id !== registro.turno.id
    || !m.lectura.seguimientoId)) throw new Error('Las lecturas adicionales deben pertenecer al mismo turno.')
  const filas = [registro, ...[...adicionales].sort((a,b) =>
    Date.parse(a.lectura.capturado_en)-Date.parse(b.lectura.capturado_en) || a.lectura.id.localeCompare(b.lectura.id))]
    .flatMap(m => m.lectura.resultados.map(resultado => ({
      resultado, adicional:!!m.lectura.seguimientoId, capturadoEn:m.lectura.capturado_en,
    })))
  if (new Set(filas.map(f => f.resultado.id)).size !== filas.length) throw new Error('Hay resultados repetidos en la hoja de Calidad.')
  return filas
}
