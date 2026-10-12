export function formatearNumeroPTAR(numero: number): string {
  const texto = String(numero)
  if (!/e/i.test(texto)) return texto
  const negativo = texto.startsWith('-')
  const [mantisa, exponente] = texto.replace(/^-/, '').toLowerCase().split('e')
  const [entera, fraccion = ''] = mantisa.split('.')
  const digitos = entera + fraccion, posicion = entera.length + Number(exponente)
  const decimal = posicion <= 0 ? `0.${'0'.repeat(-posicion)}${digitos}`
    : posicion >= digitos.length ? digitos + '0'.repeat(posicion - digitos.length)
      : `${digitos.slice(0, posicion)}.${digitos.slice(posicion)}`
  return negativo ? `-${decimal}` : decimal
}
export function fechaHoraPTAR(fecha: string): string {
  return new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(fecha))
}
