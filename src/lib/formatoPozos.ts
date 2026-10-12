// Presentar volúmenes en m³ sin redondear decimales pequeños a cero.
export function formatearVolumenPozos(numero: number): string {
  const texto = String(numero)
  if (!/e/i.test(texto)) return `${texto} m³`
  const negativo = texto.startsWith('-')
  const [mantisa, exponente] = texto.replace(/^-/, '').toLowerCase().split('e')
  const [entera, fraccion = ''] = mantisa.split('.')
  const digitos = entera + fraccion
  const posicion = entera.length + Number(exponente)
  const decimal = posicion <= 0 ? `0.${'0'.repeat(-posicion)}${digitos}`
    : posicion >= digitos.length ? digitos + '0'.repeat(posicion - digitos.length)
      : `${digitos.slice(0, posicion)}.${digitos.slice(posicion)}`
  return `${negativo ? '-' : ''}${decimal} m³`
}
