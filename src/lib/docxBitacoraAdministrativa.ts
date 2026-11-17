import { crearPaqueteOffice } from './paqueteOffice'
import { formatoTextoBitacora } from './formatoTextoBitacora'
import type { recuperarMesAdministrativo } from './bitacoraAdministrativa'
export type MesAdministrativo = Awaited<ReturnType<typeof recuperarMesAdministrativo>>
export interface PlantillaRelevantes {
  area: string; calderas: string; actividad: string; vacio: string
  despuesArea: string; despuesCalderas: string; separador: string
  partes: { ruta: string; binario: boolean; contenido: string }[]
}
// Plantilla obtenida de «formato de relevantes.doc», sin registros de ejemplo.
const xml = (s: string) => Array.from(s).filter(c => {
  const n = c.codePointAt(0)!
  return n === 9 || n === 10 || n === 13 || (n >= 32 && n <= 0xd7ff) || (n >= 0xe000 && n <= 0xfffd) || n >= 0x10000
}).join('').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const marcador = /<w:p(?:\s[^>]*)?>\s*<w:r(?:\s[^>]*)?>\s*<w:t[^>]*>\{\{CONTENIDO\}\}<\/w:t>\s*<\/w:r>\s*<\/w:p>/
function actividadConVineta(dia: string, actividad: string, plantilla: PlantillaRelevantes) {
  const texto = xml('El día ' + dia + ', ' + formatoTextoBitacora(actividad))
    .replace(/\r\n|\r|\n/g, '</w:t><w:br/><w:t xml:space="preserve">')
  return plantilla.actividad.replace('{{ACTIVIDAD}}', () => texto)
}
export function crearDocxBitacoraAdministrativa(reporte: MesAdministrativo, logo: Uint8Array, plantilla: PlantillaRelevantes): Uint8Array {
  if (!/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(reporte.mes)) throw new Error('Mes de documento inválido.')
  if (logo.length < 24 || new DataView(logo.buffer, logo.byteOffset).getUint32(0) !== 0x89504e47) throw new Error('No se pudo incorporar el logo COPAMEX.')
  const ids = new Set<string>(), areas = new Set<string>()
  const mes = new Intl.DateTimeFormat('es-MX', { month: 'long', timeZone: 'UTC' }).format(new Date(`${reporte.mes}-01T12:00:00Z`))
  const nombreMes = mes.charAt(0).toUpperCase() + mes.slice(1)
  const secciones = reporte.areas.map((area, indice) => {
    if (!['ptar', 'calderas', 'obra_civil'].includes(area.area) || areas.has(area.area)) throw new Error('Área de documento inválida.')
    areas.add(area.area)
    const titulo = area.area === 'calderas' ? 'Calderas y compresores' : area.nombre
    const encabezado = (indice ? plantilla.separador : '') + (area.area === 'calderas' ? plantilla.calderas : plantilla.area).replace('{{AREA}}', () => xml(titulo)) + (area.area === 'calderas' ? plantilla.despuesCalderas : plantilla.despuesArea)
    if (!area.actividades.length) return encabezado + plantilla.vacio
    return encabezado + area.actividades.map(f => {
      if (ids.has(f.id) || f.area !== area.area || !f.fecha.startsWith(reporte.mes + '-') || !f.actividad.trim()) throw new Error('Actividades repetidas o fuera del mes seleccionado.')
      ids.add(f.id)
      return actividadConVineta(f.fecha.slice(8, 10), f.actividad, plantilla)
    }).join('')
  }).join('')
  return crearPaqueteOffice(plantilla.partes.map(p => {
    if (p.ruta === 'word/media/image1.png') return [p.ruta, logo]
    if (p.binario) return [p.ruta, Uint8Array.from(atob(p.contenido), c => c.charCodeAt(0))]
    let contenido = p.contenido
    if (p.ruta === 'word/document.xml') {
      contenido = contenido.replaceAll('{{MES}}', xml(nombreMes)).replace(marcador, () => secciones)
    } else if (p.ruta === 'word/header1.xml') {
      contenido = contenido.replaceAll('{{MES_ANIO}}', xml('COINSA ' + nombreMes + '-' + reporte.mes.slice(0, 4)))
    } else if (p.ruta === 'word/settings.xml' && !contenido.includes('<w:doNotExpandShiftReturn')) {
      contenido = contenido.replace('<w:compat>', '<w:compat><w:doNotExpandShiftReturn/>')
    }
    return [p.ruta, contenido]
  }))
}
