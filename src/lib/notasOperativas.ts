export function mayusculasNota(texto: string): string {
  return texto.toLocaleUpperCase('es-MX')
}

/** Solo para nuevas capturas/correcciones; no transformar históricos ni reintentos. */
export function normalizarNota(texto: string | null | undefined): string {
  return mayusculasNota(texto ?? '').trim() || 'NA'
}
