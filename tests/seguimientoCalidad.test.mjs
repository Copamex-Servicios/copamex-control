// Servicios simulados: no escribe ni consulta Supabase real.
import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const cuenta = id(1)
const perfil = (rol='admin',usuario=cuenta) => ({ estado:'autenticado',perfil:{ id:usuario,rol,activo:true },sesion:{ user:{id:usuario} } })
const signal = () => new AbortController().signal
let servidor,servicio,auth,llamadas,responder
before(async () => {
 globalThis.__seguimientoSimulado = { rpc(nombre,parametros) {
  llamadas.push({nombre,parametros})
  return { abortSignal: async s => { s.throwIfAborted(); return responder(nombre,parametros) } }
 } }
 const almacen = new Map()
 globalThis.sessionStorage = { getItem:k=>almacen.get(k)??null,setItem:(k,v)=>almacen.set(k,v),removeItem:k=>almacen.delete(k),clear:()=>almacen.clear() }
 servidor = await createServer({configFile:false,envDir:false,cacheDir:'.tmp/vite-tests/seguimiento-calidad',
  optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false},
  plugins:[{name:'seguimiento-simulado',enforce:'pre',
   resolveId(n) { if (/(^|\/)supabase(?:\.ts)?$/.test(n)&&!n.startsWith('@')) return '\0seguimiento-simulado' },
   load(n) { if(n==='\0seguimiento-simulado') return 'export const supabase=globalThis.__seguimientoSimulado' },
  }]})
 servicio=await servidor.ssrLoadModule('/src/lib/seguimientoCalidad.ts')
 auth=(await servidor.ssrLoadModule('/src/stores/authStore.ts')).useAuthStore
})
after(async()=>{await servidor?.close();delete globalThis.__seguimientoSimulado;delete globalThis.sessionStorage})
beforeEach(()=>{llamadas=[];responder=(_n,p)=>({data:p.p_id??null,error:null});auth.setState(perfil())})
test('activar y finalizar usan los endpoints administrativos y confirman el mismo UUID',async()=>{
 await servicio.ejecutarSeguimiento(cuenta,{id:id(10),operacion:'activar',instruccion:'TOMAR COLOR CADA DOS HORAS'},signal())
 assert.equal(llamadas[0].nombre,'activar_seguimiento_calidad')
 assert.equal(llamadas[0].parametros.p_tipo,'color_m4')
 await servicio.ejecutarSeguimiento(cuenta,{id:id(10),operacion:'finalizar'},signal())
 assert.equal(llamadas[1].nombre,'finalizar_seguimiento_calidad')
 assert.equal(servicio.pendienteSeguimiento(cuenta),null)
})
test('operador no activa ni finaliza; administración no captura en lugar del operador',async()=>{
 auth.setState(perfil('calderas'))
 for(const operacion of ['activar','finalizar']) await assert.rejects(servicio.ejecutarSeguimiento(cuenta,{id:id(11),operacion},signal()),/sesión/)
 auth.setState(perfil('admin'))
 await assert.rejects(servicio.ejecutarSeguimiento(cuenta,{id:id(11),operacion:'lectura',turno:id(2),seguimiento:id(3),valor:10},signal()),/sesión/)
 assert.equal(llamadas.length,0)
})
test('una respuesta perdida conserva la lectura y el reintento no usa valores nuevos',async()=>{
 auth.setState(perfil('calderas'))
 const original={id:id(20),operacion:'lectura',turno:id(2),seguimiento:id(3),valor:0}
 responder=()=>({data:null,error:{code:'',message:'Sin conexión'}})
 await assert.rejects(servicio.ejecutarSeguimiento(cuenta,original,signal()),e=>e.incierto)
 assert.deepEqual(servicio.pendienteSeguimiento(cuenta),original)
 responder=(_n,p)=>({data:p.p_id,error:null})
 await servicio.ejecutarSeguimiento(cuenta,{...original,id:id(21),valor:99},signal())
 assert.deepEqual(llamadas[0],llamadas[1])
 assert.equal(servicio.pendienteSeguimiento(cuenta),null)
})
test('rechazo definitivo limpia el reintento; otra cuenta no recibe solicitudes ajenas',async()=>{
 auth.setState(perfil('calderas'))
 responder=()=>({data:null,error:{code:'42501',message:'El seguimiento ya no está activo.'}})
 await assert.rejects(servicio.ejecutarSeguimiento(cuenta,{id:id(30),operacion:'lectura',turno:id(2),seguimiento:id(3),valor:50},signal()),e=>!e.incierto)
 assert.equal(servicio.pendienteSeguimiento(cuenta),null)
 assert.equal(servicio.pendienteSeguimiento(id(99)),null)
})
test('cambio de sesión durante la respuesta no confirma ni descarta la solicitud de la cuenta anterior',async()=>{
 responder=(_n,p)=>{auth.setState(perfil('admin',id(99)));return {data:p.p_id,error:null}}
 await assert.rejects(servicio.ejecutarSeguimiento(cuenta,{id:id(40),operacion:'activar',instruccion:'INSTRUCCIÓN'},signal()),/sesión/)
 assert.equal(servicio.pendienteSeguimiento(id(99)),null)
 assert.equal(servicio.pendienteSeguimiento(cuenta).id,id(40))
 auth.setState(perfil())
 responder=(_n,p)=>({data:p.p_id,error:null})
 await servicio.ejecutarSeguimiento(cuenta,servicio.pendienteSeguimiento(cuenta),signal())
})
test('consulta valida seguimiento, aviso e identificadores y rechaza respuestas ajenas',async()=>{
 const s={id:id(50),tipo:'color_m4',area:'calderas',punto_id:id(4),parametro_id:id(5),instruccion:'TOMAR COLOR',creado_por:cuenta}
 responder=()=>({data:s,error:null})
 assert.deepEqual(await servicio.consultarSeguimiento(cuenta,signal()),s)
 assert.throws(()=>servicio.leerSeguimiento({...s,punto_id:'m4'}),/comprobar/)
 responder=()=>{auth.setState(perfil('admin',id(99)));return {data:s,error:null}}
 await assert.rejects(servicio.consultarSeguimiento(cuenta,signal()),/sesión/)
})
