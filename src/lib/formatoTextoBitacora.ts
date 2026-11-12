/** Presentación exclusiva de Word. No modifica ni resume la actividad guardada. */
const nombres = ['PTAR', 'UF', 'DAF', 'AIMSU', 'COPAMEX', 'COINSA', 'PEMEX', 'SST', 'DQO', 'DBO',
  'PLC', 'HMI', 'MCC', 'VFD', 'UV', 'RO', 'PSI', 'GPM', 'LBS', 'HP',
  'Essity', 'Nalco', 'Sulzer', 'Huber', 'Rotoplas', 'México']
const unidades = ['m/min', 'm³/h', 'm3/h', 'kg/cm²', 'kg/cm2', 'L/s', 'L/min', 'mL', 'kWh', 'kW', 'MW', 'mA', 'pH', 'Hz', '°C', 'bar']
const abreviaturas = ['Ing.', 'Lic.', 'Dr.', 'Dra.', 'Sr.', 'Sra.', 'etc.', 'aprox.', 'núm.']
const escapar = (v: string) => v.replaceAll('.', '\\.')
const canonicos = new Map([...nombres, ...unidades, ...abreviaturas].map(v => [v.toLocaleLowerCase('es-MX'), v]))
const reconocidos = new RegExp('(?<![\\p{L}\\p{N}_])(?:' + [...canonicos.values()].sort((a, b) => b.length - a.length).map(escapar).join('|') + ')(?![\\p{L}\\p{N}_])', 'giu')
export function formatoTextoBitacora(texto: string): string {
  let marca = '\uE000'
  while (texto.includes(marca)) marca += '\uE000'
  const protegidos: string[] = []
  const proteger = (valor: string) => marca + (protegidos.push(valor) - 1) + '\uE001'
  let fuente = texto.replace(/https?:\/\/[^\s<>]+|[\w.+-]+@[\w.-]+\.[\p{L}]{2,}/giu, v =>
    v.endsWith('.') ? proteger(v.slice(0, -1)) + '.' : proteger(v))
  fuente = fuente.replace(reconocidos, v => proteger(canonicos.get(v.toLocaleLowerCase('es-MX'))!))
  fuente = fuente.replace(/(?<![\p{L}\p{N}_])[\p{L}]{1,8}(?:[-_]\d[\p{L}\p{N}._-]*|\d[\p{L}\p{N}._-]*)(?![\p{L}\p{N}_])/gu, v => v.endsWith('.') ? proteger(v.slice(0, -1).toLocaleUpperCase('es-MX')) + '.' : proteger(v.toLocaleUpperCase('es-MX')))
  fuente = fuente.toLocaleLowerCase('es-MX')
  let salida = '', inicio = false
  for (let i = 0; i < fuente.length; i++) {
    if (fuente.startsWith(marca, i)) {
      const fin = fuente.indexOf('\uE001', i + marca.length)
      salida += protegidos[Number(fuente.slice(i + marca.length, fin))]
      i = fin; inicio = false; continue
    }
    const c = fuente[i]
    if (/\p{L}/u.test(c)) { salida += inicio ? c.toLocaleUpperCase('es-MX') : c; inicio = false }
    else {
      salida += c
      if (c === '.' && !( /\d/.test(fuente[i - 1] ?? '') && /\d/.test(fuente[i + 1] ?? ''))) inicio = true
      else if (c === '!' || c === '?') inicio = true
      else if (/\d/.test(c)) inicio = false
    }
  }
  return salida
}