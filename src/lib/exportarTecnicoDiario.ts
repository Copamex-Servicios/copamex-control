import { matrizTecnicoDiario } from './consolidadoTecnico.ts'
import { crearXlsxTecnicoDiario } from './xlsxTecnicoDiario.ts'
import type { DetalleTecnicoAdmin } from './revisionTecnica'
import type { AreaOperativa, TipoTurno } from './tiposTurno'

function descargar(bytes: Uint8Array, tipo: string, nombre: string): void {
  const buffer = new ArrayBuffer(bytes.byteLength); new Uint8Array(buffer).set(bytes)
  const url = URL.createObjectURL(new Blob([buffer], { type: tipo }))
  const enlace = document.createElement('a'); enlace.href = url; enlace.download = nombre
  document.body.append(enlace); enlace.click(); enlace.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function descargarTecnicoDiario(fecha: string, area: AreaOperativa, detalles: DetalleTecnicoAdmin[], disponibles: readonly TipoTurno[]): void {
  const matriz = matrizTecnicoDiario(fecha, area, detalles, disponibles)
  descargar(crearXlsxTecnicoDiario(matriz), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `COPAMEX_${area}_${fecha}_consolidado.xlsx`)
}

let fuente: Promise<string> | null = null
async function fuentePdf(): Promise<string> {
  fuente ??= fetch(new URL('../assets/fuentes/DejaVuSans.ttf', import.meta.url)).then(async respuesta => {
    if (!respuesta.ok) throw new Error('No se pudo cargar la fuente del PDF. Vuelve a intentar.')
    const bytes = new Uint8Array(await respuesta.arrayBuffer())
    let contenido = ''
    for (let i = 0; i < bytes.length; i += 0x8000) contenido += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(contenido)
  }).catch(e => { fuente = null; throw e })
  return fuente
}

export async function descargarPdfTecnicoDiario(fecha: string, area: AreaOperativa, detalles: DetalleTecnicoAdmin[], disponibles: readonly TipoTurno[], autorizar: () => void): Promise<void> {
  autorizar()
  const matriz = matrizTecnicoDiario(fecha, area, detalles, disponibles)
  const [{ crearPdfTecnicoDiario }, fuenteBase64] = await Promise.all([import('./pdfTecnicoDiario.ts'), fuentePdf()])
  autorizar()
  const pdf = crearPdfTecnicoDiario(matriz, fuenteBase64)
  autorizar()
  descargar(new Uint8Array(pdf.output('arraybuffer')), 'application/pdf', `COPAMEX_${area}_${fecha}_consolidado.pdf`)
}
