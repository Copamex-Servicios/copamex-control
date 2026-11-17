import { exigirBitacora, recuperarMesAdministrativo } from './bitacoraAdministrativa'
import type { AreaBitacora } from './bitacoraAdministrativa'
import type { PlantillaRelevantes } from './docxBitacoraAdministrativa'
import { descargarArchivo } from './exportarTecnicoDiario'

export async function prepararWordBitacora(mes: string, area: AreaBitacora | 'todas', signal: AbortSignal) {
  const contexto = exigirBitacora(true)
  signal.throwIfAborted()
  const [reporte, respuesta, respuestaPlantilla, generador] = await Promise.all([
    recuperarMesAdministrativo(mes, area, signal),
    fetch(new URL('../assets/plantillas/logo-relevantes.png', import.meta.url), { signal }),
    fetch(new URL('../assets/plantillas/relevantes.json', import.meta.url), { signal }),
    import('./docxBitacoraAdministrativa'),
  ])
  if (!respuesta.ok) throw new Error('No se pudo cargar el logo COPAMEX. Reintenta.')
  if (!respuestaPlantilla.ok) throw new Error('No se pudo cargar la plantilla de Word. Reintenta.')
  const logo = new Uint8Array(await respuesta.arrayBuffer())
  const plantilla = await respuestaPlantilla.json() as PlantillaRelevantes
  signal.throwIfAborted()
  if (exigirBitacora(true).clave !== contexto.clave) throw new Error('La cuenta cambió durante la exportación.')
  const bytes = generador.crearDocxBitacoraAdministrativa(reporte, logo, plantilla)
  const buffer = new ArrayBuffer(bytes.byteLength); new Uint8Array(buffer).set(bytes)
  return { blob: new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    nombre: `Relevantes ${mes}_${area}.docx`, cuenta: contexto.clave }
}
export function descargarWordBitacora(archivo: Awaited<ReturnType<typeof prepararWordBitacora>>) {
  if (exigirBitacora(true).clave !== archivo.cuenta) throw new Error('La cuenta cambió antes de descargar el documento.')
  descargarArchivo(archivo.blob, archivo.nombre)
}
