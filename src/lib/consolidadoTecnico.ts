import type { DetalleTecnicoAdmin, FilaTecnicaAdmin } from './revisionTecnica'
import type { AreaOperativa, TipoTurno } from './tiposTurno'
import type { CampoCalderas } from './tiposBitacoraCalderas'
import { equiposCalderas, equiposAguaCalderas, pilasCalderas } from './tiposBitacoraCalderas.ts'
import { medicionesBitacoraPTAR, bombasBitacoraPTAR, prensasBitacoraPTAR } from './tiposBitacoraPTAR.ts'
import { fechaHoraBitacora } from './formatoBitacora.ts'

export const turnosConsolidado = ['dia', 'tarde', 'noche'] as const
export const nombreTurnoTecnico: Record<TipoTurno, string> = { dia: 'Día', tarde: 'Tarde', noche: 'Noche' }
export const nombreAreaTecnica = (area: AreaOperativa) => area === 'calderas' ? 'Calderas' : 'PTAR'
export interface DiaTecnico { fecha: string; calderas: Partial<Record<TipoTurno, FilaTecnicaAdmin>>; ptar: Partial<Record<TipoTurno, FilaTecnicaAdmin>> }
export interface DatoTecnico { seccion: string; parametro: string; valor: string; unidad: string; tipo: 'medicion' | 'estado' | 'texto' }
export interface CeldaTecnicaComparativa {
  valor: string
  unidad: string
  estado: 'dato' | 'sin_registrar' | 'sin_reporte' | 'no_seleccionado' | 'no_capturado'
}
export interface FilaTecnicaComparativa {
  seccion: string
  parametro: string
  tipo: DatoTecnico['tipo']
  observacion: boolean
  unidad: string
  celdas: CeldaTecnicaComparativa[]
}
export interface MatrizTecnica {
  fecha: string
  area: AreaOperativa
  columnas: { turno: TipoTurno; operador: string; estado: 'seleccionado' | 'sin_reporte' | 'no_seleccionado'; revision: number | null; formato: number | null; captura: string; reporteId: string; turnoId: string; autorId: string }[]
  filas: FilaTecnicaComparativa[]
}

export function textoCeldaTecnica(celda: CeldaTecnicaComparativa, unidadPorTurno = false): string {
  const estados = { sin_registrar: 'Sin registrar', sin_reporte: 'Sin reporte', no_seleccionado: 'No seleccionado', no_capturado: 'No capturado en este formato' }
  const texto = celda.estado === 'dato' ? celda.valor : estados[celda.estado]
  return unidadPorTurno && celda.unidad ? `${texto} (${celda.unidad})` : texto
}

/** Disponibilidad y selección son independientes; nunca leer un vacío como cero. */
export function matrizTecnicoDiario(fecha: string, area: AreaOperativa, detalles: DetalleTecnicoAdmin[], disponibles: readonly TipoTurno[]): MatrizTecnica {
  validarConsolidado(fecha, area, detalles)
  if (detalles.some(d => !disponibles.includes(d.fila.turno))) throw new Error('La disponibilidad cambió. Vuelve a consultar.')
  const reportes = turnosConsolidado.map(turno => detalles.find(d => d.fila.turno === turno))
  const campos = reportes.map(d => d ? datosTecnico(d) : [])
  const clave = (d: DatoTecnico) => `${d.seccion}\0${d.parametro}`
  const filas = new Map<string, DatoTecnico>()
  for (const datos of campos) for (const dato of datos) filas.set(clave(dato), dato)
  return {
    fecha, area,
    columnas: turnosConsolidado.map((turno, i) => ({
      turno, operador: reportes[i]?.fila.operador ?? '',
      captura: reportes[i] ? fechaHoraBitacora(reportes[i].reporte.creadoEn) : '',
      reporteId: reportes[i]?.reporte.id ?? '', turnoId: reportes[i]?.reporte.turnoId ?? '', autorId: reportes[i]?.reporte.cuentaId ?? '',
      estado: reportes[i] ? 'seleccionado' : disponibles.includes(turno) ? 'no_seleccionado' : 'sin_reporte',
      revision: reportes[i]?.reporte.revision ?? null,
      formato: reportes[i] ? reportes[i].area === 'calderas' ? reportes[i].reporte.versionFormato : 1 : null,
    })),
    filas: [...filas.values()].map(dato => {
      const celdas: CeldaTecnicaComparativa[] = reportes.map((reporte, i) => {
        if (!reporte) return { valor: '', unidad: '', estado: disponibles.includes(turnosConsolidado[i]) ? 'no_seleccionado' : 'sin_reporte' }
        const original = campos[i].find(d => clave(d) === clave(dato))
        if (!original) return { valor: '', unidad: '', estado: 'no_capturado' }
        return { valor: original.valor, unidad: original.unidad, estado: original.valor === '' ? 'sin_registrar' : 'dato' }
      })
      const unidades = [...new Set(celdas.map(c => c.unidad).filter(Boolean))]
      return { seccion: dato.seccion, parametro: dato.parametro, tipo: dato.tipo,
        observacion: ['Reporte relevante', 'Comentarios relevantes de Ultrafiltración', 'Reporte relevante de fin de turno y motivo por el cual la prensa está parada'].includes(dato.parametro),
        unidad: unidades.length > 1 ? 'Según turno' : unidades[0] ?? '', celdas }
    }),
  }
}

/** No agrupar por creadoEn: el turno Noche conserva su fecha operativa. */
export function agruparTecnicos(desde: string, hasta: string, filas: FilaTecnicaAdmin[]): DiaTecnico[] {
  const dias = new Map<string, DiaTecnico>()
  const inicio = Date.parse(`${desde}T12:00:00Z`), fin = Date.parse(`${hasta}T12:00:00Z`)
  if (!Number.isFinite(inicio) || !Number.isFinite(fin) || fin < inicio || fin - inicio > 30 * 86400000
    || new Date(inicio).toISOString().slice(0, 10) !== desde || new Date(fin).toISOString().slice(0, 10) !== hasta) throw new Error('Consulta hasta 31 fechas operativas válidas.')
  for (let t = inicio; t <= fin; t += 86400000) {
    const fecha = new Date(t).toISOString().slice(0, 10)
    dias.set(fecha, { fecha, calderas: {}, ptar: {} })
  }
  const ids = new Set<string>()
  for (const fila of filas) {
    const dia = dias.get(fila.fechaOperativa), id = `${fila.area}:${fila.id}`
    if (!dia || ids.has(id) || dia[fila.area][fila.turno]) throw new Error('Los reportes contienen fechas o turnos duplicados. Actualiza antes de consolidar.')
    ids.add(id); dia[fila.area][fila.turno] = fila
  }
  return [...dias.values()].reverse()
}

export function seleccionarTecnicos(dia: DiaTecnico, area: AreaOperativa, turnos: readonly TipoTurno[]): FilaTecnicaAdmin[] {
  return turnosConsolidado.filter(t => turnos.includes(t)).flatMap(t => dia[area][t] ? [dia[area][t]!] : [])
}

export function validarConsolidado(fecha: string, area: AreaOperativa, detalles: DetalleTecnicoAdmin[]): void {
  if (!detalles.length) throw new Error('Selecciona al menos un turno con reporte.')
  const turnos = new Set<TipoTurno>()
  for (const d of detalles) {
    if (d.area !== area || d.fila.area !== area || d.fila.fechaOperativa !== fecha || turnos.has(d.fila.turno)
      || d.reporte.id !== d.fila.id || d.reporte.turnoId !== d.fila.turnoId || d.reporte.revision !== d.fila.revision) {
      throw new Error('La selección cambió o mezcla áreas, fechas o revisiones. Actualiza antes de exportar.')
    }
    turnos.add(d.fila.turno)
  }
}

/** Mismos campos, secciones y unidades de los detalles técnicos existentes. */
export function datosTecnico(detalle: DetalleTecnicoAdmin): DatoTecnico[] {
  const datos: DatoTecnico[] = []
  const agregar = (seccion: string, parametro: string, valor: string, unidad = '', tipo: DatoTecnico['tipo'] = 'medicion') => datos.push({ seccion, parametro, valor, unidad, tipo })
  const b = detalle.reporte.borrador
  agregar('Reporte relevante del turno', 'Reporte relevante', b.reporteRelevante, '', 'texto')
  if (detalle.area === 'calderas') {
    const r = detalle.reporte, c = r.borrador
    for (const e of equiposCalderas) {
      agregar('Calderas y bombas', e.nombre, c.equipos[e.id].estado, '', 'estado')
      if (e.id.startsWith('sulzer_')) agregar('Calderas y bombas', `${e.nombre} · Presión`, c.equipos[e.id].presion, r.unidadCondensado)
    }
    const mediciones: Record<CampoCalderas, [string, string, string]> = {
      nivel_condensado: ['Condensado y ósmosis', 'Nivel del tanque de condensado', '%'],
      presion_432: ['Condensado y ósmosis', 'Bomba de condensado 432 · Presión', r.unidadCondensado],
      presion_433: ['Condensado y ósmosis', 'Bomba de condensado 433 · Presión', r.unidadCondensado],
      presion_422: ['Condensado y ósmosis', 'Bomba de ósmosis 422 · Presión', 'PSI'],
      presion_424: ['Condensado y ósmosis', 'Bomba de ósmosis 424 · Presión', 'PSI'],
      flujo_osmosis: ['Condensado y ósmosis', 'Flujo de ósmosis', 'GPM'],
      flujo_uf: ['Ultrafiltración', 'Flujo de entrada', 'm³/h'],
      nivel_rotoplas: ['Ultrafiltración', 'Nivel del Rotoplas de entrada', '%'],
      presion_aire: ['Compresores', 'Presión general de aire', 'kg/cm²'],
      nivel_agua_potable: ['Agua potable y pozos', 'Nivel de tanques de agua potable', '%'],
    }
    for (const campo of Object.keys(mediciones) as CampoCalderas[]) {
      const [seccion, nombre, unidad] = mediciones[campo]
      agregar(seccion, nombre, c.mediciones[campo], unidad)
    }
    agregar('Ultrafiltración', 'Estado de la UF', c.estadoUF, '', 'estado')
    agregar('Ultrafiltración', 'Comentarios relevantes de Ultrafiltración', c.comentariosUF, '', 'texto')
    for (const n of ['1', '2', '3', '4'] as const) agregar('Compresores', `Compresor ${n}`, c.compresores[n], '', 'estado')
    for (const p of pilasCalderas) {
      agregar('Pilas de suministro', `${p.nombre} · Nivel`, c.pilas[p.id].nivel, '%')
      agregar('Pilas de suministro', `${p.nombre} · Bomba`, c.pilas[p.id].bomba, '', 'texto')
      agregar('Pilas de suministro', `${p.nombre} · Presión`, c.pilas[p.id].presion, 'kg/cm²')
    }
    // En formato 1 estas selecciones no se capturaban: no inferir estados.
    if (r.versionFormato === 2) for (const e of equiposAguaCalderas) agregar('Agua potable y pozos', e.nombre, c.servicioAgua[e.id] ? 'En servicio' : '', '', 'estado')
  } else {
    const p = detalle.reporte.borrador
    const secciones: Record<number, string> = { 0: 'Clarificador primario', 2: 'Flujos PTAR', 3: 'AIMSU y tanque de almacén' }
    for (const m of medicionesBitacoraPTAR) agregar(secciones[m.seccion], m.nombre, p.mediciones[m.campo], m.unidad)
    agregar('Clarificador primario', 'Agitador 9300', p.estadoAgitador, '', 'estado')
    agregar('DAF Chino y bombas', 'Descarga del DAF Chino', p.destinoDescarga, '', 'estado')
    for (const n of bombasBitacoraPTAR) agregar('DAF Chino y bombas', `Bomba ${n}`, p.bombas[n], '', 'estado')
    for (const n of prensasBitacoraPTAR) agregar('Prensas de fin de turno', `Prensa ${n}`, p.prensas[n], '', 'estado')
    agregar('Prensas de fin de turno', 'Reporte relevante de fin de turno y motivo por el cual la prensa está parada', p.comentarioPrensas, '', 'texto')
  }
  const orden = detalle.area === 'calderas'
    ? ['Reporte relevante del turno', 'Calderas y bombas', 'Condensado y ósmosis', 'Ultrafiltración', 'Compresores', 'Pilas de suministro', 'Agua potable y pozos']
    : ['Reporte relevante del turno', 'Clarificador primario', 'DAF Chino y bombas', 'Flujos PTAR', 'AIMSU y tanque de almacén', 'Prensas de fin de turno']
  return datos.sort((a, b) => orden.indexOf(a.seccion) - orden.indexOf(b.seccion))
}
