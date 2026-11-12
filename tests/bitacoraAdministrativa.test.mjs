// Supabase simulado: no se consulta ni modifica ningún entorno remoto.
import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const cuenta = id(1), otra = id(2), signal = () => new AbortController().signal
const fila = (n, area = 'ptar', mes = '2026-11') => ({ id: id(100 + n), area, actividad: `Actividad ${n}`,
  fecha: `${mes}-05`, creado_en: `${mes}-05T12:00:${String(n % 60).padStart(2, '0')}+00:00`,
  actualizado_en: `${mes}-05T12:00:59+00:00`, revision: 0 })
let server, store, servicio, ui, llamadas, responder
const memoria = new Map(), storageAnterior = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
function sesion(rol = 'admin', usuario = cuenta, activo = true) {
  store.setState({ estado: 'autenticado', perfil: { id: usuario, nombre: 'Prueba', rol, activo }, sesion: { user: { id: usuario } } })
}
before(async () => {
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: k => memoria.get(k) ?? null, setItem: (k,v) => memoria.set(k,v), removeItem: k => memoria.delete(k),
  } })
  globalThis.__baSupabase = { rpc(nombre, parametros) { llamadas.push({ nombre, parametros }); return {
    abortSignal: async s => { s.throwIfAborted(); return responder(nombre, parametros) },
  } } }
  server = await createServer({ configFile: false, envDir: false, cacheDir: '.tmp/vite-tests/bitacora-administrativa',
    server: { middlewareMode: true, hmr: false }, plugins: [{ name: 'ba-sin-remoto', enforce: 'pre',
      resolveId(n) {
        if (/(^|\/)supabase(?:\.ts)?$/.test(n) && !n.startsWith('@')) return '\0ba-supabase'
        if (n.endsWith('/hooks/useAuth')) return '\0ba-auth'
      },
      load(n) {
        if (n === '\0ba-supabase') return 'export const supabase = globalThis.__baSupabase'
        if (n === '\0ba-auth') return 'export const useAuth = () => globalThis.__baAuth.getState()'
      },
    }, react()] })
  store = (await server.ssrLoadModule('/src/stores/authStore.ts')).useAuthStore
  globalThis.__baAuth = store
  servicio = await server.ssrLoadModule('/src/lib/bitacoraAdministrativa.ts')
  ui = await server.ssrLoadModule('/src/components/bitacoraAdministrativa/BitacoraAdministrativa.tsx')
})
after(async () => {
  await server?.close(); delete globalThis.__baSupabase; delete globalThis.__baAuth
  if (storageAnterior) Object.defineProperty(globalThis, 'sessionStorage', storageAnterior)
  else delete globalThis.sessionStorage
})
beforeEach(() => {
  store.setState({ estado: 'sin-sesion', perfil: null, sesion: null }); memoria.clear(); sesion(); llamadas = []
  responder = (_n,p) => ({ data: { filas: [], mas: false, mes: p.p_mes ?? '2026-11', ahora: '2026-11-05T12:00:00Z', version: null }, error: null })
})
test('valida área, texto y mes antes de consultar o escribir', async () => {
  for (const [a,t] of [['otra','Texto'],['ptar','  '],['ptar','x'.repeat(10001)]]) assert.throws(() => servicio.prepararActividad(a,t,null))
  for (const mes of ['2026-13','0000-01','2026-1']) await assert.rejects(servicio.consultarPaginaBitacora({mes,area:'todas'},null,signal()))
  assert.equal(llamadas.length,0)
})
test('prepara la actividad administrativa en mayúsculas', () => {
  sesion('admin')
  const solicitud = servicio.prepararActividad('ptar', ' cambio de tela ÁREA ', null)
  assert.equal(solicitud.actividad, 'CAMBIO DE TELA ÁREA')
})
test('los cuatro roles consultan; únicamente Administración crea y ve Obra Civil', async () => {
  for (const rol of ['calderas','ptar','calidad','admin']) {
    sesion(rol)
    await servicio.consultarPaginaBitacora({mes:'2026-11',area:'todas'},null,signal())
    if (rol !== 'admin') {
      assert.throws(() => servicio.prepararActividad('ptar','Prueba',null))
      await assert.rejects(servicio.consultarPaginaBitacora({mes:'2026-11',area:'obra_civil'},null,signal()))
    }
  }
  assert.equal(llamadas.length,4)
})
test('rechaza registros civiles inesperados y perfiles inactivos o sin sesión', async () => {
  sesion('calidad'); responder = () => ({ data:{filas:[fila(1,'obra_civil')],mas:false,mes:'2026-11',ahora:'2026-11-05T12:00:00Z',version:null},error:null })
  await assert.rejects(servicio.consultarPaginaBitacora({mes:'2026-11',area:'todas'},null,signal()),/autorizada/)
  sesion('admin',cuenta,false); assert.throws(()=>servicio.exigirBitacora())
  store.setState({estado:'sin-sesion',perfil:null,sesion:null}); assert.throws(()=>servicio.exigirBitacora())
})
test('preserva la solicitud tras error de red y rechaza el doble envío en curso', async () => {
  const s=servicio.prepararActividad('ptar',' Actividad relevante ',null)
  assert.ok(memoria.get(`copamex:bitacora-administrativa:pendiente:${cuenta}`).includes(s.solicitud))
  let soltar
  responder = () => new Promise(resolve=>{soltar=resolve})
  const primero=servicio.guardarActividad(s)
  await assert.rejects(servicio.guardarActividad(s),/en curso/)
  soltar({data:null,error:{code:'NETWORK'}})
  await assert.rejects(primero)
  assert.equal(servicio.pendienteBitacora().solicitud,s.solicitud)
  responder=(_n,p)=>({data:{...fila(1),id:p.p_id,area:p.p_area,actividad:p.p_actividad},error:null})
  const confirmado=await servicio.guardarActividad(s)
  assert.equal(confirmado.actividad,'ACTIVIDAD RELEVANTE'); assert.equal(servicio.pendienteBitacora(),null)
  assert.equal(llamadas.length,2); assert.equal(llamadas[0].parametros.p_solicitud,llamadas[1].parametros.p_solicitud)
})
test('recupera un pendiente de sessionStorage con los mismos identificadores', () => {
  const s={cuenta,solicitud:id(20),id:id(21),area:'calderas',actividad:'Pendiente recuperado',revision:null}
  memoria.set(`copamex:bitacora-administrativa:pendiente:${cuenta}`,JSON.stringify(s))
  assert.deepEqual(servicio.pendienteBitacora(),s)
})
test('permite una actividad independiente por área el mismo día; valida confirmación y fecha del servidor', async () => {
  const ids=[]
  responder=(_n,p)=>({data:{...fila(1),id:p.p_id,area:p.p_area,actividad:p.p_actividad},error:null})
  for(let i=0;i<3;i++){
    const s=servicio.prepararActividad(['ptar','calderas','obra_civil'][i],`Actividad ${i}`,null);ids.push(s.id)
    const r=await servicio.guardarActividad(s);assert.equal(r.fecha,'2026-11-05')
    assert.equal('p_fecha' in llamadas.at(-1).parametros,false)
  }
  assert.equal(new Set(ids).size,3)
})
test('corrección exige revisión original y un conflicto no deja un reintento incierto', async () => {
  const s=servicio.prepararActividad('calderas','Corrección',fila(1))
  responder=()=>({data:null,error:{code:'40001'}})
  await assert.rejects(servicio.guardarActividad(s),/cambió/)
  assert.equal(llamadas[0].parametros.p_revision,0);assert.equal(servicio.pendienteBitacora(),null)
})
test('descarta respuestas y pendientes al cambiar de cuenta', async () => {
  const s=servicio.prepararActividad('ptar','Cambio de sesión',null)
  responder=(_n,p)=>{sesion('admin',otra);return {data:{...fila(1),id:p.p_id,actividad:p.p_actividad},error:null}}
  await assert.rejects(servicio.guardarActividad(s),/cuenta cambió/)
  assert.equal(memoria.size,0)
})
test('prepara todas las páginas del mes, agrupadas por área sin duplicar; incluye cambio de año', async () => {
  for(const mes of ['2026-12','2027-01']){
    const filas=Array.from({length:58},(_,i)=>fila(58-i,['ptar','calderas','obra_civil'][i%3],mes))
    responder=(_n,p)=>{
      assert.equal(p.p_mes,mes)
      const inicio=p.p_antes_id ? filas.findIndex(f=>f.id===p.p_antes_id)+1:0
      return {data:{filas:filas.slice(inicio,inicio+25),mas:inicio+25<filas.length,mes,ahora:`${mes}-05T12:00:59Z`,version:`${mes}-05T12:00:59Z`},error:null}
    }
    const r=await servicio.recuperarMesAdministrativo(mes,'todas',signal())
    assert.equal(r.areas.flatMap(a=>a.actividades).length,58)
    for(const a of r.areas) assert.ok(a.actividades.every(f=>f.area===a.area))
  }
  assert.equal(llamadas.length,6)
})
test('no presenta exportación completa si la página está truncada o los datos cambian', async () => {
  responder=()=>({data:{filas:[fila(1)],mas:true,mes:'2026-11',ahora:'2026-11-05T12:00:00Z',version:null},error:null})
  await assert.rejects(servicio.recuperarMesAdministrativo('2026-11','todas',signal()),/incompleta/)
  const filas=Array.from({length:26},(_,i)=>fila(26-i))
  responder=(_n,p)=>({data:{filas:p.p_antes?filas.slice(25):filas.slice(0,25),mas:!p.p_antes,mes:'2026-11',ahora:'2026-11-05T12:00:00Z',version:p.p_antes?'2026-11-05T12:01:00Z':'2026-11-05T12:00:00Z'},error:null})
  await assert.rejects(servicio.recuperarMesAdministrativo('2026-11','todas',signal()),/cambiaron/)
})
test('solo Admin obtiene captura; las interfaces operativas no muestran creación, corrección ni Obra Civil', () => {
  for(const rol of ['calderas','ptar','calidad']){
    sesion(rol)
    assert.equal(renderToStaticMarkup(createElement(ui.PanelBitacoraAdministrativa)),'')
    const html=renderToStaticMarkup(createElement(ui.NovedadesAdministracion))
    if(rol==='calidad') assert.equal(html,'')
    else assert.ok(html.includes('Novedades de Administración'))
    assert.ok(!/Obra Civil|Guardar|Corregir/.test(html))
  }
  sesion();const html=renderToStaticMarkup(createElement(ui.PanelBitacoraAdministrativa))
  assert.ok(html.includes('Obra Civil'));assert.ok(html.includes('Actividad relevante'))
})
test('migración independiente: RLS, auditoría existente, privilegios mínimos, hora y reintentos en servidor', () => {
  const sql=readFileSync(new URL('../supabase/migrations/20261105000100_bitacora_administrativa.sql',import.meta.url),'utf8')
  assert.match(sql,/enable row level security/);assert.match(sql,/private\.registrar_auditoria\(\)/)
  assert.match(sql,/and area in \('calderas','ptar'\)/)
  assert.match(sql,/grant select\(id, area, actividad, fecha, creado_en, actualizado_en, revision\)/)
  assert.match(sql,/clock_timestamp\(\)/);assert.match(sql,/America\/Mexico_City/)
  assert.match(sql,/pg_advisory_xact_lock/);assert.match(sql,/where id=p_id and revision=p_revision/)
  assert.ok(!/grant (insert|update|delete|all) .*authenticated/i.test(sql))
})

test('disponibilidad diaria usa fecha del servidor en México y consulta por área sin depender del historial visible', async () => {
  const f = {...fila(1),fecha:'2026-11-05'}
  responder = (_n,p) => ({data:{filas:p.p_area==='ptar'?[f]:[],mas:false,mes:'2026-11',ahora:'2026-11-06T05:59:59Z',version:null},error:null})
  const ayerMexico = await servicio.consultarRegistroDiario('ptar',signal())
  assert.equal(ayerMexico.fecha,'2026-11-05');assert.equal(ayerMexico.registro.id,f.id)
  assert.equal(llamadas[0].parametros.p_recientes,true);assert.equal(llamadas[0].parametros.p_area,'ptar')
  const otraArea = await servicio.consultarRegistroDiario('calderas',signal());assert.equal(otraArea.registro,null)
  responder = () => ({data:{filas:[f],mas:false,mes:'2026-11',ahora:'2026-11-06T06:00:00Z',version:null},error:null})
  assert.equal((await servicio.consultarRegistroDiario('ptar',signal())).registro,null)
  sesion('ptar');await assert.rejects(servicio.consultarRegistroDiario('ptar',signal()),/permiso/)
})
test('rechazo diario libera el pendiente y explica usar Corregir; conserva el reintento cuando no hay confirmación', async () => {
  const s = servicio.prepararActividad('ptar','No sobrescribir',null)
  responder = () => ({data:null,error:{code:'23505',message:servicio.mensajeRegistroDiario}})
  await assert.rejects(servicio.guardarActividad(s),/Usa Corregir en el historial/)
  assert.equal(servicio.pendienteBitacora(),null)
})
