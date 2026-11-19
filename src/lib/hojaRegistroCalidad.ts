import type { RegistroCalidad } from './tiposCalidad'

const normalizarOrden = (texto: string) => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const ordenPuntos = [['AIMSU'], ['PILAM2', 'PILADEM2'], ['PILACALDERAS'], ['POZO'], ['PILAM4', 'PILADEM4'], ['PEMEX'], ['RETORNO', 'RETORNOTQE', 'RETORNOATQEALMACEN', 'RETORNOATANQUEALMACEN']]
const rangoPunto = (punto: string) => {
  const normalizado = normalizarOrden(punto)
  const indice = ordenPuntos.findIndex(grupo => grupo.includes(normalizado))
  return indice < 0 ? ordenPuntos.length : indice
}
const rangoParametro = (parametro: string) => {
  const indice = ['COLOR', 'TURBIDEZ', 'SST'].indexOf(normalizarOrden(parametro))
  return indice < 0 ? 3 : indice
}

export function compararPuntoParametroCalidad(a: { punto: string; parametro: string }, b: { punto: string; parametro: string }) {
  return rangoPunto(a.punto) - rangoPunto(b.punto)
    || a.punto.localeCompare(b.punto, 'es')
    || rangoParametro(a.parametro) - rangoParametro(b.parametro)
    || a.parametro.localeCompare(b.parametro, 'es')
}

export function hojasRegistroCalidad(muestras: readonly RegistroCalidad[], ultimaHabitual: RegistroCalidad | null, adicionales: readonly RegistroCalidad[]) {
  const habituales = muestras.filter(m => !m.lectura.esAdicional)
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
    || !m.lectura.esAdicional)) throw new Error('Las lecturas adicionales deben pertenecer al mismo turno.')
  const filas = [registro, ...[...adicionales].sort((a,b) =>
    Date.parse(a.lectura.capturado_en)-Date.parse(b.lectura.capturado_en) || a.lectura.id.localeCompare(b.lectura.id))]
    .flatMap(m => m.lectura.resultados.map(resultado => ({
      resultado, adicional:!!m.lectura.esAdicional, capturadoEn:m.lectura.capturado_en,
    })))
  if (new Set(filas.map(f => f.resultado.id)).size !== filas.length) throw new Error('Hay resultados repetidos en la hoja de Calidad.')
  return filas.sort((a, b) => compararPuntoParametroCalidad(
    { punto: a.resultado.punto.nombre, parametro: a.resultado.parametro.nombre },
    { punto: b.resultado.punto.nombre, parametro: b.resultado.parametro.nombre },
  ) || Date.parse(a.capturadoEn) - Date.parse(b.capturadoEn) || a.resultado.id.localeCompare(b.resultado.id))
}
