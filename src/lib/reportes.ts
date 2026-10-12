import { supabase } from './supabase'
import { useAuthStore } from '../stores/authStore'
import { capturasPlanta, consultarPlanta, modulosPlanta, nombresModulo, validarFiltrosPlanta } from './planta'
import type { CapturaPlanta, DatosPlanta, FiltrosPlanta, ModuloPlanta } from './planta'
import { medicionesPTAR } from './tiposPTAR'

export interface CambioReporte { id: string; creado_en: string; usuario: string | null; accion: string; tabla: string; registro_id: string; antes: Record<string, unknown> | null; despues: Record<string, unknown> | null }
export interface ConsultaReporte { filtros: FiltrosPlanta; anterior: FiltrosPlanta; actual: DatosPlanta; previo: DatosPlanta; inicioConsulta: string; finConsulta: string; cambios: CambioReporte[]; auditoria: 'no-solicitada' | 'completa' | 'incompleta' | 'error'; cuenta: string }
export interface DiarioReporte { fecha: string; turnos: number; capturas: number; pozo1: string | null; pozo2: string | null; alimentado: string | null; aceptado: string | null; rechazo: string | null; rendimiento: number | null; evaluados: number; fuera: number; sinLimites: number }
export interface GrupoCalidad { clave: string; punto: string; parametro: string; unidad: string | null; n: number; evaluados: number; fuera: number; sinLimites: number; minimo: number; maximo: number; ultimo: number; limiteMinUltimo: number | null; limiteMaxUltimo: number | null; capturas: Extract<CapturaPlanta, { modulo: 'calidad' }>[] }
export interface ResumenReporte { capturas: CapturaPlanta[]; diario: DiarioReporte[]; cerrados: number; abiertos: number; pozo1: string | null; pozo2: string | null; totalPozos: string | null; alimentado: string | null; aceptado: string | null; rechazo: string | null; rendimiento: number | null; ufBalanceNegativo: number; evaluados: number; fuera: number; sinLimites: number; calidad: GrupoCalidad[]; ptar: { campo: string; parametro: string; punto: string; n: number; minimo: number | null; maximo: number | null; promedio: number | null; ultimo: number | null }[] }
export function periodoAnterior(f: FiltrosPlanta): FiltrosPlanta {
  validarFiltrosPlanta(f)
  const dias = (Date.parse(f.hasta) - Date.parse(f.desde)) / 86400000 + 1
  const hasta = new Date(Date.parse(f.desde) - 86400000).toISOString().slice(0, 10)
  const desde = new Date(Date.parse(f.desde) - dias * 86400000).toISOString().slice(0, 10)
  return { ...f, desde, hasta }
}
export function problemasReporte(d: DatosPlanta): string[] {
  return [ ...(d.turnos.error ? ['Turnos: error'] : d.turnos.incompleta ? ['Turnos: consulta limitada'] : []), ...modulosPlanta.flatMap(m => d.fuentes[m].error ? [`${nombresModulo[m]}: error`] : d.fuentes[m].incompleta ? [`${nombresModulo[m]}: consulta limitada`] : []) ]
}
function exigirCuenta(cuenta: string): void {
  const a = useAuthStore.getState()
  if (a.estado !== 'autenticado' || a.perfil?.activo !== true || a.perfil.id !== cuenta || a.sesion?.user.id !== cuenta || a.perfil.rol !== 'admin') throw new Error('Reportes está disponible solo para administradores activos.')
}
const tablasAudit: Record<ModuloPlanta, string> = { bitacora: 'public.bitacora', pozos: 'public.lecturas_pozos', uf: 'public.lecturas_uf', calidad: 'public.muestras_calidad', ptar: 'public.lecturas_ptar' }
async function cambiosReporte(cuenta: string, d: DatosPlanta, signal: AbortSignal): Promise<{ cambios: CambioReporte[]; estado: ConsultaReporte['auditoria'] }> {
  exigirCuenta(cuenta)
  const registros = new Set(d.turnos.elementos.map(t => `public.turnos_operativos:${t.turno.id}`))
  for (const e of capturasPlanta(d)) {
    registros.add(`${tablasAudit[e.modulo]}:${e.registro.lectura.id}`)
    if (e.modulo === 'calidad') for (const r of e.registro.lectura.resultados) registros.add(`public.resultados_calidad:${r.id}`)
  }
  const ids = [...new Set([...registros].map(k => k.split(':')[1]))], cambios: CambioReporte[] = [], vistos = new Set<string>()
  try {
    for (let inicio = 0; inicio < ids.length; inicio += 60) {
      for (let offset = 0; offset < 5000; offset += 200) {
        signal.throwIfAborted(); exigirCuenta(cuenta)
        const r = await supabase.from('auditoria').select('id,creado_en,usuario,accion,tabla,registro_id,antes,despues')
          .in('registro_id', ids.slice(inicio, inicio + 60)).in('tabla', ['public.turnos_operativos', ...Object.values(tablasAudit), 'public.resultados_calidad'])
          .order('creado_en').order('id').range(offset, offset + 199).abortSignal(signal)
        if (r.error || !Array.isArray(r.data)) throw new Error('No se pudo leer la auditoría.')
        for (const v of r.data) {
          if (!v || typeof v !== 'object') throw new Error('Auditoría no válida.')
          const x = v as Record<string, unknown>, id = String(x.id)
          if (!/^\d+$/.test(id) || (typeof x.id === 'number' && !Number.isSafeInteger(x.id)) || typeof x.creado_en !== 'string' || !Number.isFinite(Date.parse(x.creado_en)) || typeof x.tabla !== 'string' || typeof x.registro_id !== 'string'
            || !registros.has(`${x.tabla}:${x.registro_id}`) || !['INSERT', 'UPDATE', 'DELETE'].includes(String(x.accion)) || (x.usuario !== null && typeof x.usuario !== 'string')
            || [x.antes, x.despues].some(o => o !== null && (typeof o !== 'object' || Array.isArray(o))) || vistos.has(id)) throw new Error('Auditoría no válida o duplicada.')
          vistos.add(id); cambios.push({ id, creado_en: x.creado_en, usuario: x.usuario as string | null, tabla: x.tabla, registro_id: x.registro_id, accion: x.accion as string, antes: x.antes as Record<string, unknown> | null, despues: x.despues as Record<string, unknown> | null })
          if (cambios.length >= 5000) return { cambios, estado: 'incompleta' }
        }
        if (r.data.length < 200) break
      }
    }
    cambios.sort((a, b) => Date.parse(a.creado_en) - Date.parse(b.creado_en))
    const esperados = new Map<string, object>(d.turnos.elementos.map(t => [`public.turnos_operativos:${t.turno.id}`, t.turno]))
    for (const e of capturasPlanta(d)) { esperados.set(`${tablasAudit[e.modulo]}:${e.registro.lectura.id}`, e.registro.lectura); if (e.modulo === 'calidad') for (const v of e.registro.lectura.resultados) esperados.set(`public.resultados_calidad:${v.id}`, v) }
    const ultimos = new Map<string, CambioReporte>(); for (const c of cambios) ultimos.set(`${c.tabla}:${c.registro_id}`, c)
    for (const [clave, esperado] of esperados) {
      const ultimo = ultimos.get(clave); if (!ultimo) continue
      if (!ultimo.despues) return { cambios, estado: 'error' }
      for (const [campo, valor] of Object.entries(esperado)) {
        if (valor !== null && typeof valor === 'object') continue
        const historico = ultimo.despues[campo]
        const mismoInstante = typeof valor === 'string' && typeof historico === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(valor) && Date.parse(valor) === Date.parse(historico)
        if (valor !== historico && !mismoInstante) return { cambios, estado: 'error' }
      }
    }
    return { cambios, estado: 'completa' }
  } catch { if (signal.aborted) signal.throwIfAborted(); return { cambios: [], estado: 'error' } }
}
export async function consultarReporte(cuenta: string, filtros: FiltrosPlanta, auditoria: boolean, signal: AbortSignal): Promise<ConsultaReporte> {
  exigirCuenta(cuenta); validarFiltrosPlanta(filtros); signal.throwIfAborted()
  const anterior = periodoAnterior(filtros), inicioConsulta = new Date().toISOString()
  const [actual, previo] = await Promise.all([consultarPlanta(filtros, signal), consultarPlanta(anterior, signal)])
  signal.throwIfAborted(); exigirCuenta(cuenta)
  const cambios = auditoria ? await cambiosReporte(cuenta, actual, signal) : { cambios: [], estado: 'no-solicitada' as const }
  signal.throwIfAborted(); exigirCuenta(cuenta)
  return { cuenta, filtros: { ...filtros }, anterior, actual, previo, inicioConsulta, finConsulta: new Date().toISOString(), cambios: cambios.cambios, auditoria: cambios.estado }
}
export function resumirReporte(d: DatosPlanta, f: FiltrosPlanta): ResumenReporte {
  const capturas = capturasPlanta(d), pozos = capturas.filter(e => e.modulo === 'pozos'), uf = capturas.filter(e => e.modulo === 'uf'), calidad = capturas.filter(e => e.modulo === 'calidad'), ptar = capturas.filter(e => e.modulo === 'ptar')
  const suma = (a: number[]) => a.length ? sumarDecimalReporte(a) : null
  const pozo1 = suma(pozos.map(e => e.registro.lectura.consumo_pozo1)), pozo2 = suma(pozos.map(e => e.registro.lectura.consumo_pozo2))
  const alimentado = suma(uf.map(e => e.registro.lectura.alimentado)), aceptado = suma(uf.map(e => e.registro.lectura.aceptado)), rechazo = suma(uf.map(e => e.registro.lectura.rechazo))
  const ratio = (entrada: string | null, salida: string | null) => entrada !== null && salida !== null && Number(entrada) !== 0 ? Number(salida) / Number(entrada) * 100 : null
  const grupos = new Map<string, GrupoCalidad>(); let evaluados = 0, fuera = 0, sinLimites = 0
  for (const e of calidad) for (const r of e.registro.lectura.resultados) {
    const clave = `${r.punto_id}:${r.parametro_id}:${r.parametro.unidad ?? ''}`
    let g = grupos.get(clave)
    if (!g) { g = { clave, punto: r.punto.nombre, parametro: r.parametro.nombre, unidad: r.parametro.unidad, n: 0, evaluados: 0, fuera: 0, sinLimites: 0, minimo: r.valor, maximo: r.valor, ultimo: r.valor, limiteMinUltimo: r.limite_min_aplicado, limiteMaxUltimo: r.limite_max_aplicado, capturas: [] }; grupos.set(clave, g) }
    g.n++; g.minimo = Math.min(g.minimo, r.valor); g.maximo = Math.max(g.maximo, r.valor)
    if (!g.capturas.some(c => c.registro.lectura.id === e.registro.lectura.id)) g.capturas.push(e)
    if (r.fuera_norma === null) { g.sinLimites++; sinLimites++ } else { g.evaluados++; evaluados++; if (r.fuera_norma) { g.fuera++; fuera++ } }
  }
  const diario: DiarioReporte[] = []
  for (let fecha = Date.parse(f.desde); fecha <= Date.parse(f.hasta); fecha += 86400000) {
    const dia = new Date(fecha).toISOString().slice(0, 10), c = capturas.filter(e => e.registro.turno.fecha_operativa === dia)
    const p = c.filter(e => e.modulo === 'pozos'), u = c.filter(e => e.modulo === 'uf'), q = c.filter(e => e.modulo === 'calidad').flatMap(e => e.registro.lectura.resultados)
    const a = suma(u.map(e => e.registro.lectura.alimentado)), acep = suma(u.map(e => e.registro.lectura.aceptado))
    diario.push({ fecha: dia, turnos: d.turnos.elementos.filter(t => t.turno.fecha_operativa === dia).length, capturas: c.length, pozo1: suma(p.map(e => e.registro.lectura.consumo_pozo1)), pozo2: suma(p.map(e => e.registro.lectura.consumo_pozo2)), alimentado: a, aceptado: acep, rechazo: suma(u.map(e => e.registro.lectura.rechazo)), rendimiento: ratio(a, acep), evaluados: q.filter(r => r.fuera_norma !== null).length, fuera: q.filter(r => r.fuera_norma === true).length, sinLimites: q.filter(r => r.fuera_norma === null).length })
  }
  return { capturas, diario, cerrados: d.turnos.elementos.filter(t => t.turno.finalizado_en !== null).length, abiertos: d.turnos.elementos.filter(t => t.turno.finalizado_en === null).length,
    pozo1, pozo2, totalPozos: suma(pozos.flatMap(e => [e.registro.lectura.consumo_pozo1, e.registro.lectura.consumo_pozo2])), alimentado, aceptado, rechazo, rendimiento: ratio(alimentado, aceptado), ufBalanceNegativo: uf.filter(e => e.registro.lectura.rechazo < 0).length,
    evaluados, fuera, sinLimites, calidad: [...grupos.values()].sort((a, b) => b.fuera - a.fuera || a.punto.localeCompare(b.punto) || a.parametro.localeCompare(b.parametro)),
    ptar: medicionesPTAR.map(m => { const valores = ptar.map(e => e.registro.lectura[m.campo]).filter((v): v is number => v !== null); return { ...m, n: valores.length, minimo: valores.length ? Math.min(...valores) : null, maximo: valores.length ? Math.max(...valores) : null, promedio: valores.length ? valores.reduce((s, n) => s + n, 0) / valores.length : null, ultimo: valores[0] ?? null } }),
  }
}
export function puedeExportarReporte(r: ConsultaReporte): boolean {
  return problemasReporte(r.actual).length === 0 && !['error', 'incompleta'].includes(r.auditoria)
}
export function variacionReporte(actual: string | number | null, previo: string | number | null, puntos = false): string {
  if (actual === null || previo === null) return 'Comparación no disponible: faltan lecturas.'
  const a = Number(actual), p = Number(previo), diferencia = a - p
  const f = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2, signDisplay: 'exceptZero' })
  return puntos ? `${f.format(diferencia)} puntos porcentuales` : p === 0 ? `Cambio absoluto: ${f.format(diferencia)}. Base anterior cero.` : `${f.format(diferencia)} (${f.format(diferencia / Math.abs(p) * 100)}%) vs. período anterior`
}
export function sumarDecimalReporte(numeros: number[]): string {
  const partes = numeros.map(n => { const [mantisa, exponente = '0'] = String(n).toLowerCase().split('e'), [entera, fraccion = ''] = mantisa.split('.'); return { n: BigInt(entera + fraccion), escala: fraccion.length - Number(exponente) } })
  const escala = Math.max(0, ...partes.map(p => p.escala)), total = partes.reduce((s, p) => s + p.n * 10n ** BigInt(escala - p.escala), 0n)
  const texto = (total < 0n ? -total : total).toString().padStart(escala + 1, '0')
  const decimal = escala ? `${texto.slice(0, -escala)}.${texto.slice(-escala)}`.replace(/0+$/, '').replace(/\.$/, '') : texto
  return total < 0n ? `-${decimal}` : decimal
}
