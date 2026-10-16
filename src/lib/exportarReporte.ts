import { crearXlsxReporte } from './xlsxReporte'
import type { CeldaReporte, HojaReporte } from './xlsxReporte'
import { puedeExportarReporte, problemasReporte, resumirReporte } from './reportes'
import type { ConsultaReporte } from './reportes'
import { nombresModulo, nombresTurno } from './planta'
import { fechaMexicoAdmin } from './administracion'
import { medicionesPTAR } from './tiposPTAR'
import { useAuthStore } from '../stores/authStore'
import { nombreAreaReporte, resumenEjecutivoReporte } from './resumenEjecutivoReporte'

const volumen = (v: string | null): CeldaReporte => v === null ? null : String(Number(v)) === v && Number.isFinite(Number(v)) ? Number(v) : v
const fecha = (s: string) => new Date(`${s}T00:00:00Z`)
const horaMexico = (s: string) => new Date(`${fechaMexicoAdmin(s)}Z`)
export function hojasReporte(r: ConsultaReporte): HojaReporte[] {
  const a = useAuthStore.getState()
  if (a.estado !== 'autenticado' || a.perfil?.activo !== true || a.perfil.rol !== 'admin' || a.perfil.id !== r.cuenta || a.sesion?.user.id !== r.cuenta) throw new Error('La sesión cambió. Reportes está disponible solo para administradores activos.')
  if (!puedeExportarReporte(r)) throw new Error('No se puede exportar como reporte completo una consulta con errores o registros limitados. Reduce el período o vuelve a consultar.')
  const s = resumirReporte(r.actual, r.filtros), previoCompleto = problemasReporte(r.previo).length === 0, p = previoCompleto ? resumirReporte(r.previo, r.anterior) : null
  const contexto = `${r.filtros.desde} al ${r.filtros.hasta}; área: ${r.filtros.area}; turno: ${r.filtros.turno}; consulta: ${fechaMexicoAdmin(r.inicioConsulta)} a ${fechaMexicoAdmin(r.finConsulta)} (México)`
  const h = (nombre: string, columnas: string[], filas: CeldaReporte[][]): HojaReporte => ({ nombre, titulo: `COPAMEX · ${nombre}`, contexto, columnas, filas })
  const resumen: CeldaReporte[][] = [
    ['Turnos cerrados', s.cerrados, p?.cerrados ?? null, 'turnos', 'Turnos guardados con fecha de cierre; no son turnos programados.'],
    ['Turnos abiertos', s.abiertos, p?.abiertos ?? null, 'turnos', 'Al momento de consultar.'],
    ['Capturas operativas', s.capturas.length, p?.capturas.length ?? null, 'registros', 'Bitácora, Pozos, UF, Calidad y PTAR.'],
    ['Consumo Pozo 1', volumen(s.pozo1), volumen(p?.pozo1 ?? null), 'm³', 'Suma de consumos de lecturas guardadas; sin lecturas queda vacío.'],
    ['Consumo Pozo 2', volumen(s.pozo2), volumen(p?.pozo2 ?? null), 'm³', 'Suma de consumos de lecturas guardadas.'],
    ['Consumo de ambos pozos', volumen(s.totalPozos), volumen(p?.totalPozos ?? null), 'm³', 'Pozo 1 + Pozo 2.'],
    ['UF alimentado', volumen(s.alimentado), volumen(p?.alimentado ?? null), 'm³', 'Suma de volúmenes alimentados.'],
    ['UF aceptado', volumen(s.aceptado), volumen(p?.aceptado ?? null), 'm³', 'Suma de volúmenes aceptados.'],
    ['UF rechazo', volumen(s.rechazo), volumen(p?.rechazo ?? null), 'm³', 'Alimentado menos aceptado; puede requerir revisión del balance.'],
    ['Rendimiento global UF', s.rendimiento, p?.rendimiento ?? null, '%', '100 × suma de aceptado / suma de alimentado. Sin alimentación queda vacío.'],
    ['Lecturas UF con rechazo negativo', s.ufBalanceNegativo, p?.ufBalanceNegativo ?? null, 'lecturas', 'Aceptación mayor a alimentación; revisar lecturas y notas.'],
    ['Calidad: resultados evaluados', s.evaluados, p?.evaluados ?? null, 'resultados', 'Tienen límites aplicados; cada punto/parámetro es un resultado.'],
    ['Calidad: resultados fuera de límite', s.fuera, p?.fuera ?? null, 'resultados', 'Evaluación registrada con los límites de esa captura.'],
    ['Calidad: proporción fuera de límite', s.evaluados ? s.fuera / s.evaluados * 100 : null, p?.evaluados ? p.fuera / p.evaluados * 100 : null, '%', '100 × fuera / evaluados; excluye resultados sin límites.'],
    ['Calidad: resultados sin límites', s.sinLimites, p?.sinLimites ?? null, 'resultados', 'No se clasifican como dentro ni fuera de límite.'],
    ['Período anterior', `${r.anterior.desde} al ${r.anterior.hasta}`, null, '', previoCompleto ? 'Misma duración, área y filtro de turno.' : 'Consulta anterior incompleta: comparación no disponible.'],
    ['Auditoría', r.auditoria, null, '', r.auditoria === 'no-solicitada' ? 'Exportación operativa; no incluye historial de cambios.' : 'Historial disponible para los registros seleccionados; se consultó después del detalle operativo. No es una transacción histórica de la base.'],
    ['Origen', 'Registros confirmados en Supabase', null, '', 'Se conservan UUID de captura/turno/operador/cuenta y fecha/hora originales. Nombres y unidades corresponden al catálogo consultado.'],
    ['Precisión en Excel', 'Valores con más de 15 cifras significativas se conservan como texto', null, '', 'Datos originales preservados; no se redondean identificadores ni valores grandes.'],
  ]
  resumen.push(['Población', 'Capturas vigentes (no anuladas)', null, '', 'El historial exportado corresponde a los registros incluidos; las capturas anuladas no forman parte de los indicadores.'])
  const capturasOrigen = [...s.capturas, ...(p?.capturas ?? [])]
  const periodo = (d: string) => d >= r.filtros.desde && d <= r.filtros.hasta ? 'Consultado' : 'Anterior'
  const baseCols = ['Período', 'UUID captura', 'UUID turno', 'Fecha operativa', 'Área', 'Turno', 'Operador (catálogo actual)', 'UUID operador', 'Captura México', 'Recepción México', 'Captura UTC original', 'Recepción UTC original', 'UUID cuenta de captura']
  const base = (e: typeof s.capturas[number]): CeldaReporte[] => { const t = e.registro.turno, l = e.registro.lectura; return [periodo(t.fecha_operativa), l.id, t.id, fecha(t.fecha_operativa), t.area, nombresTurno[t.turno], e.registro.operadorNombre, t.operador_id, horaMexico(l.capturado_en), horaMexico(l.recibido_en), l.capturado_en, l.recibido_en, l.creado_por] }
  const hojas = [h('Resumen', ['Indicador', 'Período consultado', 'Período anterior', 'Unidad', 'Definición / observación'], resumen),
    h('Diario', ['Fecha operativa', 'Turnos', 'Capturas', 'Pozo 1 m³', 'Pozo 2 m³', 'UF alimentado m³', 'UF aceptado m³', 'UF rechazo m³', 'Rendimiento UF %', 'Calidad evaluados', 'Fuera de límite', 'Sin límites'], s.diario.map(d => [fecha(d.fecha), d.turnos, d.capturas, volumen(d.pozo1), volumen(d.pozo2), volumen(d.alimentado), volumen(d.aceptado), volumen(d.rechazo), d.rendimiento, d.evaluados, d.fuera, d.sinLimites])),
    h('Turnos', ['Período', 'UUID turno', 'Fecha operativa', 'Área', 'Turno', 'Operador (catálogo actual)', 'UUID operador', 'Inicio México', 'Cierre México', 'Inicio UTC', 'Cierre UTC', 'UUID cuenta inicio', 'Estado', 'Bitácoras', 'Pozos', 'UF', 'Muestras Calidad', 'Lecturas PTAR', 'Notas de cierre'], [...r.actual.turnos.elementos, ...(p ? r.previo.turnos.elementos : [])].map(({ turno: t, operadorNombre }) => [periodo(t.fecha_operativa), t.id, fecha(t.fecha_operativa), t.area, nombresTurno[t.turno], operadorNombre, t.operador_id, horaMexico(t.iniciado_en), t.finalizado_en ? horaMexico(t.finalizado_en) : null, t.iniciado_en, t.finalizado_en, t.iniciado_por, t.finalizado_en ? 'Cerrado' : 'Abierto', ...(['bitacora', 'pozos', 'uf', 'calidad', 'ptar'] as const).map(m => capturasOrigen.filter(c => c.modulo === m && c.registro.turno.id === t.id).length), t.notas_cierre])),
    h('Pozos', [...baseCols, 'Pozo 1 inicial m³', 'Pozo 1 final m³', 'Consumo Pozo 1 m³', 'Pozo 2 inicial m³', 'Pozo 2 final m³', 'Consumo Pozo 2 m³', 'Notas'], capturasOrigen.filter(e => e.modulo === 'pozos').map(e => { const l = e.registro.lectura; return [...base(e), l.pozo1_ini, l.pozo1_fin, l.consumo_pozo1, l.pozo2_ini, l.pozo2_fin, l.consumo_pozo2, l.notas] })),
    h('UF', [...baseCols, 'Alimentación inicial m³', 'Alimentación final m³', 'Alimentado m³', 'Aceptación inicial m³', 'Aceptación final m³', 'Aceptado m³', 'Rechazo m³', 'Rendimiento captura %', 'Notas'], capturasOrigen.filter(e => e.modulo === 'uf').map(e => { const l = e.registro.lectura; return [...base(e), l.alim_ini, l.alim_fin, l.alimentado, l.acep_ini, l.acep_fin, l.aceptado, l.rechazo, l.rendimiento, l.notas] })),
    h('Calidad', [...baseCols, 'Hora muestra declarada', 'UUID resultado', 'UUID punto', 'Punto', 'UUID parámetro', 'Parámetro', 'Unidad', 'Valor', 'Límite mínimo aplicado', 'Límite máximo aplicado', 'Evaluación', 'Notas'], capturasOrigen.filter(e => e.modulo === 'calidad').flatMap(e => e.registro.lectura.resultados.map(v => [...base(e), e.registro.lectura.hora_muestra, v.id, v.punto_id, v.punto.nombre, v.parametro_id, v.parametro.nombre, v.parametro.unidad, v.valor, v.limite_min_aplicado, v.limite_max_aplicado, v.fuera_norma === null ? 'Sin límites' : v.fuera_norma ? 'Fuera de límite' : 'Dentro de límite', e.registro.lectura.notas]))),
    h('PTAR', [...baseCols, ...medicionesPTAR.map(m => `${m.parametro} ${m.punto} mg/L`), 'Notas'], capturasOrigen.filter(e => e.modulo === 'ptar').map(e => [...base(e), ...medicionesPTAR.map(m => e.registro.lectura[m.campo]), e.registro.lectura.notas])),
    h('Bitacora', [...baseCols, 'Texto completo'], capturasOrigen.filter(e => e.modulo === 'bitacora').map(e => [...base(e), e.registro.lectura.texto])),
  ]
  if (r.auditoria === 'completa') {
    const filas: CeldaReporte[][] = []
    for (const c of r.cambios) {
      const campos = [...new Set([...Object.keys(c.antes ?? {}), ...Object.keys(c.despues ?? {})])].filter(k => JSON.stringify(c.antes?.[k]) !== JSON.stringify(c.despues?.[k]))
      for (const k of campos) {
        const antes = JSON.stringify(c.antes?.[k] ?? null), despues = JSON.stringify(c.despues?.[k] ?? null), partes = Math.max(1, Math.ceil(Math.max(antes.length, despues.length) / 1500))
        for (let i = 0; i < partes; i++) filas.push([c.id, horaMexico(c.creado_en), c.creado_en, c.usuario, c.accion, c.tabla, c.registro_id, k, i + 1, partes, antes.slice(i * 1500, (i + 1) * 1500), despues.slice(i * 1500, (i + 1) * 1500)])
      }
    }
    hojas.push(h('Cambios', ['ID auditoría', 'Cambio México', 'Cambio UTC', 'UUID cuenta responsable', 'Acción', 'Tabla', 'UUID registro', 'Campo', 'Parte', 'Total partes', 'Antes (JSON original)', 'Después (JSON original)'], filas))
  }
  hojas.push(h('Graficas', ['Lectura de las gráficas', 'Alcance'], [
    ['Pozos: consumo diario de P1 y P2 (m³)', 'Período consultado; los días sin lectura se muestran como huecos, no como cero.'],
    ['UF: alimentación, aceptación y rechazo diario (m³)', 'Balance de volumen; no representa el rendimiento porcentual. Datos de la hoja Diario.'],
  ]))
  return hojas
}
// Vista operativa: una fila por captura; el Excel técnico conserva mediciones y auditoría.
export function hojasReporteOperativo(r: ConsultaReporte): HojaReporte[] {
  const s = resumenEjecutivoReporte(r)
  const contexto = `Período: ${r.filtros.desde} al ${r.filtros.hasta}; área: ${nombreAreaReporte(r.filtros.area)}; turno: ${r.filtros.turno === 'todos' ? 'Todos' : nombresTurno[r.filtros.turno]}; consulta: ${fechaMexicoAdmin(r.finConsulta)} (México)`
  const resumen: CeldaReporte[][] = []
  const agregarTotales = (grupo: string, turnos: number, capturas: number, tecnicos: number | null) => {
    resumen.push([grupo, 'Turnos registrados', turnos, 'turnos', 'Abiertos y cerrados en el período.'],
      [grupo, 'Capturas vigentes', capturas, 'capturas', 'Una captura por registro operativo; cada muestra de calidad cuenta una vez.'])
    if (tecnicos !== null) resumen.push([grupo, 'Reportes técnicos registrados', tecnicos, 'reportes', 'Bitácoras técnicas de Calderas y PTAR, separadas de las capturas operativas.'])
  }
  agregarTotales('Total', s.turnos, s.totalCapturas, s.totalTecnicos)
  for (const a of s.porArea) agregarTotales(nombreAreaReporte(a.area), a.turnos, a.capturas, a.tecnicos)
  for (const d of s.operacion) resumen.push([nombreAreaReporte(d.area), d.indicador, typeof d.valor === 'string' ? volumen(d.valor) : d.valor, d.unidad, null])
  for (const nota of s.notas) resumen.push(['Alcance', 'Indicador omitido', null, null, nota])
  resumen.push(['Alcance', 'Población', null, null, 'Capturas vigentes de Pozos, UF, Calidad y Proceso PTAR. Las observaciones antiguas de Bitácora no se consultan en este módulo.'],
    ['Alcance', 'Historial de cambios', r.auditoria === 'completa' ? 'Disponible en Trazabilidad' : 'No solicitado', null, 'Los indicadores usan los valores vigentes. El historial se consulta en Reportes → Trazabilidad; no se incluye en este archivo.'])
  return [
    { nombre: 'Resumen', titulo: 'COPAMEX · Resumen operativo', contexto, columnas: ['Grupo / área', 'Indicador', 'Valor', 'Unidad', 'Observaciones'], filas: resumen, congelar: true },
    { nombre: 'Diario', titulo: 'COPAMEX · Actividad por fecha, área y turno', contexto: contexto + '; fecha operativa del turno, incluso después de medianoche; vacío indica una medición o total técnico no disponible',
      columnas: ['Fecha operativa', 'Área', 'Turno', 'Turnos registrados', 'Capturas vigentes', 'Reportes técnicos', 'Lecturas Pozos', 'Lecturas UF', 'Muestras Calidad', 'Lecturas Proceso PTAR', 'Consumo Pozo 1 m³', 'Consumo Pozo 2 m³', 'UF alimentado m³', 'UF aceptado m³'],
      filas: s.diario.map(d => [fecha(d.fecha), nombreAreaReporte(d.area), nombresTurno[d.turno], d.turnos, d.capturas.length, d.tecnicos, d.porModulo.pozos, d.porModulo.uf, d.porModulo.calidad, d.porModulo.ptar, volumen(d.pozo1), volumen(d.pozo2), volumen(d.alimentado), volumen(d.aceptado)]), congelar: true },
    { nombre: 'Registros', titulo: 'COPAMEX · Capturas operativas vigentes', contexto: contexto + '; una fila por captura operativa; los reportes técnicos se contabilizan por separado en Resumen y Diario; detalle e historial disponibles en COPAMEX',
      columnas: ['Captura México (fecha y hora)', 'Fecha operativa', 'Área', 'Turno', 'Operador', 'Módulo', 'Estado del registro', 'Observaciones'],
      filas: s.capturas.map(e => { const { lectura: l, turno: t, operadorNombre } = e.registro; return [horaMexico(l.capturado_en), fecha(t.fecha_operativa), nombreAreaReporte(t.area), nombresTurno[t.turno], operadorNombre, e.modulo === 'ptar' ? 'Proceso PTAR' : e.modulo === 'calidad' ? 'Calidad de agua' : nombresModulo[e.modulo], l.eliminado_en === null ? 'Vigente' : 'Anulada', e.modulo === 'bitacora' ? e.registro.lectura.texto : e.registro.lectura.notas] }), congelar: true },
  ]
}
export function descargarReporte(r: ConsultaReporte, tecnico = false): void {
  const a = useAuthStore.getState()
  if (a.estado !== 'autenticado' || a.perfil?.activo !== true || a.perfil.id !== r.cuenta || a.sesion?.user.id !== r.cuenta || a.perfil.rol !== 'admin') throw new Error('La sesión cambió. Genera el reporte desde la cuenta actual.')
  const bytes = crearXlsxReporte(tecnico ? hojasReporte(r) : hojasReporteOperativo(r)), buffer = new ArrayBuffer(bytes.byteLength); new Uint8Array(buffer).set(bytes)
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const enlace = document.createElement('a'); enlace.href = url; enlace.download = `COPAMEX_${r.filtros.desde}_${r.filtros.hasta}_${r.filtros.area}_${r.filtros.turno}${tecnico ? '_tecnico' : ''}.xlsx`; enlace.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
