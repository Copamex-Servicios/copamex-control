import { supabase } from './supabase'
import { useAuthStore } from '../stores/authStore'
import { esFechaOperativa } from './turnos'

type Valor = string | number | boolean | null
export type FilaAdmin = Record<string, Valor> & { id: string }
export type TablaAdmin = 'operadores' | 'avisos' | 'puntos_muestreo' | 'parametros_calidad' | 'maquinas' | 'catalogo_papeles' | 'programa_produccion' | 'eventos_calendario'
export interface CampoAdmin { clave: string; nombre: string; tipo: 'texto' | 'largo' | 'booleano' | 'entero' | 'fecha' | 'instante' | 'opcion' | 'referencia'; opcional?: boolean; referencia?: TablaAdmin; opciones?: readonly (readonly [string, string])[] }
export interface ConfigAdmin { tabla: TablaAdmin; nombre: string; singular: string; ayuda: string; campos: readonly CampoAdmin[]; columnas: string; metadata: boolean; autor: boolean }
const campo = (clave: string, nombre: string, tipo: CampoAdmin['tipo'] = 'texto', opcional = false): CampoAdmin => ({ clave, nombre, tipo, opcional })
const activo = campo('activo', 'Activo', 'booleano')
const referencia = (clave: string, nombre: string, tabla: TablaAdmin): CampoAdmin => ({ clave, nombre, tipo: 'referencia', referencia: tabla })
function config(tabla: TablaAdmin, nombre: string, singular: string, ayuda: string, campos: CampoAdmin[], metadata = false, autor = false): ConfigAdmin {
  return { tabla, nombre, singular, ayuda, campos, metadata, autor, columnas: ['id', ...campos.map(c => c.clave), ...(metadata ? ['creado_en'] : []), ...(autor ? ['creado_por'] : [])].join(',') }
}
export const seccionesAdmin: readonly ConfigAdmin[] = [
  config('operadores', 'Operadores', 'operador', 'Agrega operadores para las sugerencias al iniciar turno. Desactivar conserva su historial. Cambiar el nombre también cambia cómo aparece en consultas anteriores; para otra persona, crea otro operador.', [campo('nombre', 'Nombre completo'), campo('numero_empleado', 'Número de empleado', 'texto', true), activo], true),
  config('avisos', 'Avisos', 'aviso', 'Los avisos se muestran en el panel de las áreas. Para retirar uno, quita Permanente y asigna una fecha de fin pasada. Las horas se interpretan en México.', [campo('mensaje', 'Mensaje', 'largo'), campo('permanente', 'Permanente', 'booleano'), campo('inicio', 'Mostrar desde (México)', 'instante', true), campo('fin', 'Mostrar hasta (México)', 'instante', true)], true, true),
  config('puntos_muestreo', 'Puntos de muestreo', 'punto', 'Asigna un área solo cuando esté confirmada. Sin asignar permite usar el punto en ambas áreas. Cambiar nombres se refleja en las consultas anteriores.', [campo('nombre', 'Nombre'), { clave: 'area', nombre: 'Área', tipo: 'opcion', opcional: true, opciones: [['calderas', 'Calderas'], ['ptar', 'PTAR']] }, campo('orden', 'Orden en el formulario', 'entero'), activo]),
  config('parametros_calidad', 'Parámetros de Calidad', 'parámetro', 'Configura nombres y unidades confirmadas. Deja la unidad vacía si todavía no la conoces. Este catálogo no cambia los límites aplicados a las muestras.', [campo('nombre', 'Nombre'), campo('unidad', 'Unidad', 'texto', true), activo]),
  config('maquinas', 'Máquinas', 'máquina', 'El código debe ser único. Desactivar conserva los papeles y programas históricos.', [campo('codigo', 'Código'), campo('nombre', 'Nombre'), activo]),
  config('catalogo_papeles', 'Papeles', 'papel', 'Cada papel pertenece a una máquina. Los papeles inactivos se conservan para consultar el historial.', [referencia('maquina_id', 'Máquina', 'maquinas'), campo('nombre', 'Nombre del papel'), activo]),
  config('programa_produccion', 'Producción', 'programa', 'El programa activo de la fecha seleccionada se muestra en las áreas. El papel debe pertenecer a la máquina. Color y consumo objetivo se guardan como texto, según el catálogo existente.', [campo('fecha', 'Fecha', 'fecha'), referencia('maquina_id', 'Máquina', 'maquinas'), referencia('papel_id', 'Papel', 'catalogo_papeles'), campo('color_objetivo', 'Color objetivo', 'texto', true), campo('consumo_objetivo', 'Consumo objetivo', 'texto', true), activo], true, true),
  config('eventos_calendario', 'Eventos y paros', 'evento', 'Programa lavados, mantenimientos u otros eventos para que aparezcan en los paneles de las áreas.', [campo('fecha', 'Fecha', 'fecha'), campo('tipo', 'Tipo de evento'), { clave: 'area', nombre: 'Área', tipo: 'opcion', opciones: [['calderas', 'Calderas'], ['ptar', 'PTAR'], ['todas', 'Ambas áreas']] }, campo('horario', 'Horario', 'texto', true), campo('motivo', 'Descripción / motivo', 'largo', true)], true, true),
]
export function configuracionAdmin(tabla: TablaAdmin): ConfigAdmin {
  const c = seccionesAdmin.find(s => s.tabla === tabla)
  if (!c) throw new Error('Sección no válida.')
  return c
}
export interface FuenteAdmin { filas: FilaAdmin[]; error: boolean; limitada: boolean }
export type DatosAdmin = Record<TablaAdmin, FuenteAdmin>
export interface SolicitudAdmin { cuenta: string; tabla: TablaAdmin; id: string; valores: Record<string, Valor>; original: FilaAdmin | null }
const pendientes = new Map<string, SolicitudAdmin>()
export const pendienteAdmin = (cuenta: string) => pendientes.get(cuenta) ?? null
export function establecerPendienteAdmin(cuenta: string, solicitud: SolicitudAdmin | null): void { if (solicitud) pendientes.set(cuenta, solicitud); else pendientes.delete(cuenta) }
export class ErrorAdmin extends Error {
  readonly incierto: boolean
  constructor(mensaje: string, incierto = false) { super(mensaje); this.name = 'ErrorAdmin'; this.incierto = incierto }
}
export function exigirAdmin(cuenta: string): void {
  const a = useAuthStore.getState()
  if (a.estado !== 'autenticado' || !a.perfil || !['admin','calidad'].includes(a.perfil.rol) || a.perfil.activo !== true || a.perfil.id !== cuenta || a.sesion?.user.id !== cuenta) throw new ErrorAdmin('Se requiere una sesión activa de Administración o Calidad.')
}
function exigirSeccion(cuenta: string, tabla: TablaAdmin): void {
  exigirAdmin(cuenta)
  if (useAuthStore.getState().perfil?.rol === 'calidad' && !['avisos','programa_produccion','eventos_calendario'].includes(tabla)) throw new ErrorAdmin('Calidad no puede modificar esta sección.')
}
export async function resolverPapel(cuenta: string, maquina: string, nombre: string): Promise<FilaAdmin> {
  exigirSeccion(cuenta, 'programa_produccion')
  const { data, error } = await supabase.rpc('obtener_o_crear_papel', { p_maquina: maquina, p_nombre: nombre.toLocaleUpperCase('es-MX').trim() })
  exigirSeccion(cuenta, 'programa_produccion')
  if (error) throw new ErrorAdmin(error.code === '22023' ? error.message : 'No se pudo guardar la opción de papel. Reintenta con el mismo nombre.')
  return leerFilaAdmin(Array.isArray(data) ? data[0] : data, configuracionAdmin('catalogo_papeles'))
}
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(v)
const instante = (v: unknown): v is string => typeof v === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(v) && Number.isFinite(Date.parse(v))
export function leerFilaAdmin(v: unknown, c: ConfigAdmin): FilaAdmin {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ErrorAdmin('Respuesta no válida.')
  const r = v as Record<string, unknown>
  if (!uuid(r.id) || (c.metadata && !instante(r.creado_en)) || (c.autor && !uuid(r.creado_por))) throw new ErrorAdmin('No se pudo comprobar el registro.')
  const fila: FilaAdmin = { id: r.id }
  for (const f of c.campos) {
    const valor = r[f.clave]
    if (valor === null && f.opcional) { fila[f.clave] = null; continue }
    if (f.tipo === 'booleano' ? typeof valor !== 'boolean'
      : f.tipo === 'entero' ? typeof valor !== 'number' || !Number.isInteger(valor) || valor < -2147483648 || valor > 2147483647
        : f.tipo === 'fecha' ? !esFechaOperativa(valor)
          : f.tipo === 'instante' ? !instante(valor)
            : f.tipo === 'referencia' ? !uuid(valor)
              : typeof valor !== 'string' || (!f.opcional && !valor.trim())) throw new ErrorAdmin('No se pudo comprobar un campo del registro.')
    fila[f.clave] = valor as Valor
  }
  if (c.metadata) fila.creado_en = r.creado_en as string
  if (c.autor) fila.creado_por = r.creado_por as string
  return fila
}
export function fechaMexicoAdmin(iso: string): string {
  const p = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso))
  const n = (tipo: string) => p.find(e => e.type === tipo)?.value
  return `${n('year')}-${n('month')}-${n('day')}T${n('hour')}:${n('minute')}:${n('second')}`
}
export function instanteMexicoAdmin(local: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(local) || !esFechaOperativa(local.slice(0, 10))) throw new ErrorAdmin('Revisa la fecha y hora del aviso.')
  const objetivo = local.length === 16 ? `${local}:00` : local, ms = Date.parse(`${objetivo}Z`)
  if (!Number.isFinite(ms)) throw new ErrorAdmin('Revisa la fecha y hora del aviso.')
  let actual = ms
  for (let i = 0; i < 3; i++) actual += ms - Date.parse(`${fechaMexicoAdmin(new Date(actual).toISOString())}Z`)
  if (fechaMexicoAdmin(new Date(actual).toISOString()) !== objetivo) throw new ErrorAdmin('Esa fecha u hora no es válida en México.')
  return new Date(actual).toISOString()
}
export function borradorAdmin(c: ConfigAdmin, original: FilaAdmin | null): Record<string, string | boolean> {
  const valores: Record<string, string | boolean> = {}
  for (const f of c.campos) {
    const v = original?.[f.clave]
    valores[f.clave] = f.tipo === 'booleano' ? typeof v === 'boolean' ? v : f.clave === 'activo'
      : f.tipo === 'instante' && typeof v === 'string' ? fechaMexicoAdmin(v)
        : v !== null && v !== undefined ? String(v) : f.tipo === 'entero' ? '0' : f.tipo === 'fecha' ? fechaMexicoAdmin(new Date().toISOString()).slice(0, 10) : ''
  }
  if (c.tabla === 'eventos_calendario' && typeof valores.area === 'string') {
    const area = valores.area.toLowerCase(); valores.area = ['todos', 'todas'].includes(area) ? 'todas' : area
  }
  return valores
}
export function validarAdmin(c: ConfigAdmin, campos: Record<string, string | boolean>, datos: DatosAdmin, original: FilaAdmin | null): Record<string, Valor> {
  const valores: Record<string, Valor> = {}
  for (const f of c.campos) {
    const valor = campos[f.clave]
    if (f.tipo === 'booleano') { if (typeof valor !== 'boolean') throw new ErrorAdmin(`Revisa ${f.nombre}.`); valores[f.clave] = valor; continue }
    if (typeof valor !== 'string') throw new ErrorAdmin(`Revisa ${f.nombre}.`)
    const texto = valor.trim()
    if (!texto && f.opcional) { valores[f.clave] = null; continue }
    if (!texto) throw new ErrorAdmin(`Completa ${f.nombre}.`)
    if (texto.length > (f.tipo === 'largo' ? 10000 : 1000)) throw new ErrorAdmin(`${f.nombre} es demasiado largo.`)
    if (f.tipo === 'entero') {
      const n = Number(texto)
      if (!/^-?\d+$/.test(texto) || !Number.isInteger(n) || n < -2147483648 || n > 2147483647) throw new ErrorAdmin(`Escribe un entero válido en ${f.nombre}.`)
      valores[f.clave] = n
    } else if (f.tipo === 'fecha') {
      if (!esFechaOperativa(texto)) throw new ErrorAdmin(`Revisa ${f.nombre}.`)
      valores[f.clave] = texto
    } else if (f.tipo === 'instante') valores[f.clave] = instanteMexicoAdmin(texto)
    else if (f.tipo === 'opcion') {
      if (!f.opciones?.some(([v]) => v === texto)) throw new ErrorAdmin(`Selecciona ${f.nombre}.`)
      valores[f.clave] = texto
    } else if (f.tipo === 'referencia' && f.referencia) {
      const fuente = datos[f.referencia], fila = fuente.filas.find(r => r.id === texto)
      if (fuente.error || !uuid(texto) || !fila || (fila.activo === false && original?.[f.clave] !== texto)) throw new ErrorAdmin(`Selecciona una opción activa de ${f.nombre}. Si falta, actualiza el catálogo.`)
      valores[f.clave] = texto
    } else valores[f.clave] = texto
  }
  if (c.tabla === 'avisos') {
    if (valores.permanente === true) { valores.inicio = null; valores.fin = null }
    else if (!valores.fin) throw new ErrorAdmin('Define el fin del aviso temporal o marca Permanente.')
    if (typeof valores.inicio === 'string' && typeof valores.fin === 'string' && Date.parse(valores.fin) <= Date.parse(valores.inicio)) throw new ErrorAdmin('El fin del aviso debe ser posterior al inicio.')
  }
  if (c.tabla === 'programa_produccion') {
    const papel = datos.catalogo_papeles.filas.find(r => r.id === valores.papel_id)
    if (!papel || papel.maquina_id !== valores.maquina_id) throw new ErrorAdmin('El papel debe pertenecer a la máquina seleccionada.')
  }
  return valores
}
export async function consultarAdministracion(cuenta: string, signal: AbortSignal): Promise<DatosAdmin> {
  exigirAdmin(cuenta); signal.throwIfAborted()
  const resultados = await Promise.allSettled(seccionesAdmin.map(async c => {
    if (useAuthStore.getState().perfil?.rol === 'calidad' && !['avisos','programa_produccion','eventos_calendario','maquinas','catalogo_papeles'].includes(c.tabla)) return { filas: [], error: false, limitada: false }
    const filas: FilaAdmin[] = [], ids = new Set<string>()
    for (let offset = 0; offset < 1000; offset += 200) {
      const r = await supabase.from(c.tabla).select(c.columnas).order(c.metadata ? 'creado_en' : 'id', { ascending: !c.metadata }).order('id').range(offset, offset + 199).abortSignal(signal)
      if (r.error || !Array.isArray(r.data)) throw new ErrorAdmin('No se pudo consultar esta sección.')
      for (const v of r.data) { const fila = leerFilaAdmin(v, c); if (ids.has(fila.id)) throw new ErrorAdmin('El catálogo cambió durante la consulta. Actualiza.'); ids.add(fila.id); filas.push(fila) }
      if (r.data.length < 200) return { filas, error: false, limitada: false }
    }
    return { filas, error: false, limitada: true }
  }))
  signal.throwIfAborted(); exigirAdmin(cuenta)
  return Object.fromEntries(seccionesAdmin.map((c, i) => {
    const r = resultados[i]; return [c.tabla, r.status === 'fulfilled' ? r.value : { filas: [], error: true, limitada: false }]
  })) as DatosAdmin
}
function mismaFila(fila: FilaAdmin, esperado: Record<string, Valor>): boolean {
  return Object.entries(esperado).every(([k, v]) => v === fila[k] || (typeof v === 'string' && typeof fila[k] === 'string' && ['inicio', 'fin'].includes(k) && instante(v) && instante(fila[k]) && Date.parse(v) === Date.parse(fila[k])))
}
async function consultarRegistro(s: SolicitudAdmin, c: ConfigAdmin, signal: AbortSignal): Promise<FilaAdmin | null> {
  exigirSeccion(s.cuenta, s.tabla)
  const r = await supabase.from(s.tabla).select(c.columnas).eq('id', s.id).abortSignal(signal).maybeSingle()
  if (r.error) throw new ErrorAdmin('No se pudo comprobar si el cambio quedó guardado. Usa Comprobar / reintentar.', true)
  exigirAdmin(s.cuenta)
  try { return r.data === null ? null : leerFilaAdmin(r.data, c) }
  catch { throw new ErrorAdmin('No se pudo comprobar el registro. Usa Comprobar / reintentar.', true) }
}
async function guardar(s: SolicitudAdmin, signal: AbortSignal): Promise<FilaAdmin> {
  exigirSeccion(s.cuenta, s.tabla)
  const c = configuracionAdmin(s.tabla)
  if (!uuid(s.id) || (s.original && s.original.id !== s.id) || Object.keys(s.valores).length !== c.campos.length || c.campos.some(f => !(f.clave in s.valores))) throw new ErrorAdmin('Solicitud no válida.')
  // Primero comprobar el UUID/original: confirma reintentos sin duplicar altas ni sobrescribir cambios ajenos.
  const actual = await consultarRegistro(s, c, signal)
  if (actual && mismaFila(actual, s.valores) && (!c.autor || actual.creado_por === (s.original?.creado_por ?? s.cuenta))) return actual
  if (s.original ? !actual || !mismaFila(actual, s.original) : actual !== null) throw new ErrorAdmin('Otro administrador cambió el registro. Actualiza y vuelve a abrirlo.')
  exigirAdmin(s.cuenta)
  let respuesta
  try {
    if (s.original) {
      let q = supabase.from(s.tabla).update(s.valores).eq('id', s.id)
      // Comparar todos los campos originales en la misma escritura (incluidos NULL).
      for (const [k, v] of Object.entries(s.original)) if (k !== 'id') q = v === null ? q.is(k, null) : q.eq(k, v)
      respuesta = await q.select(c.columnas).abortSignal(signal).maybeSingle()
    } else respuesta = await supabase.from(s.tabla).insert({ id: s.id, ...s.valores, ...(c.autor ? { creado_por: s.cuenta } : {}) }).select(c.columnas).abortSignal(signal).single()
  } catch { throw new ErrorAdmin('No llegó la confirmación. Usa Comprobar / reintentar antes de crear otro registro.', true) }
  exigirAdmin(s.cuenta)
  if (respuesta.error) {
    const codigo = respuesta.error.code
    if (codigo === '23505') {
      const guardado = await consultarRegistro(s, c, signal)
      if (guardado && mismaFila(guardado, s.valores) && (!c.autor || guardado.creado_por === s.cuenta)) return guardado
      throw new ErrorAdmin('Ya existe ese código o esa combinación de máquina y papel. Revisa el catálogo.')
    }
    if (codigo === '42501') throw new ErrorAdmin('La base de datos rechazó el cambio. Revisa que tu cuenta sea administrador activo y tenga los permisos del bloque 022.')
    if (['23503', '23514', '22023', '22007', '22P02'].includes(codigo)) throw new ErrorAdmin('Revisa los datos y las referencias del formulario. La base de datos no aceptó el cambio.')
    throw new ErrorAdmin('No se confirmó el guardado. Usa Comprobar / reintentar.', true)
  }
  if (respuesta.data === null) throw new ErrorAdmin('El registro cambió mientras lo editabas. Actualiza y vuelve a abrirlo.')
  let fila: FilaAdmin
  try { fila = leerFilaAdmin(respuesta.data, c) }
  catch { throw new ErrorAdmin('No se pudieron comprobar los valores guardados. Usa Comprobar / reintentar.', true) }
  if (!mismaFila(fila, s.valores)) throw new ErrorAdmin('No se pudieron comprobar los valores guardados. Usa Comprobar / reintentar.', true)
  return fila
}
export async function guardarAdministracion(s: SolicitudAdmin): Promise<FilaAdmin> {
  exigirAdmin(s.cuenta)
  const controller = new AbortController()
  const cancelar = useAuthStore.subscribe(() => {
    try { exigirAdmin(s.cuenta) } catch { controller.abort() }
  })
  try { return await guardar(s, controller.signal) }
  finally { cancelar() }
}
