// Contenedor ZIP sin compresión para documentos Office pequeños o medianos.
// Independiente de los exportadores existentes; no instala librerías.
export function crearPaqueteOffice(archivos: readonly [string, string | Uint8Array][]): Uint8Array {
  const enc = new TextEncoder(), partes: Uint8Array[] = [], centrales: Uint8Array[] = []
  let offset = 0
  const nombres = new Set<string>()
  for (const [ruta, contenido] of archivos) {
    if (!ruta || nombres.has(ruta) || ruta.includes('..') || ruta.startsWith('/')) throw new Error('Ruta de documento inválida.')
    nombres.add(ruta)
    const nombre = enc.encode(ruta), datos = typeof contenido === 'string' ? enc.encode(contenido) : contenido
    let crc = 0xffffffff
    for (const b of datos) { crc ^= b; for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
    crc = (crc ^ 0xffffffff) >>> 0
    const h = new Uint8Array(30 + nombre.length), v = new DataView(h.buffer)
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true)
    v.setUint16(12, 33, true); v.setUint32(14, crc, true); v.setUint32(18, datos.length, true); v.setUint32(22, datos.length, true)
    v.setUint16(26, nombre.length, true); h.set(nombre, 30)
    const c = new Uint8Array(46 + nombre.length), d = new DataView(c.buffer)
    d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x0800, true)
    d.setUint16(14, 33, true); d.setUint32(16, crc, true); d.setUint32(20, datos.length, true); d.setUint32(24, datos.length, true)
    d.setUint16(28, nombre.length, true); d.setUint32(42, offset, true); c.set(nombre, 46)
    partes.push(h, datos); centrales.push(c); offset += h.length + datos.length
  }
  const size = centrales.reduce((n, c) => n + c.length, 0), fin = new Uint8Array(22), f = new DataView(fin.buffer)
  if (archivos.length > 65535 || offset + size > 0xffffffff) throw new Error('El documento excede el tamaño admitido.')
  f.setUint32(0, 0x06054b50, true); f.setUint16(8, archivos.length, true); f.setUint16(10, archivos.length, true)
  f.setUint32(12, size, true); f.setUint32(16, offset, true)
  const salida = new Uint8Array(offset + size + fin.length)
  let i = 0
  for (const parte of [...partes, ...centrales, fin]) { salida.set(parte, i); i += parte.length }
  return salida
}
