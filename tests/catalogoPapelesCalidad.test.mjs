// Supabase sustituido por un doble: estas pruebas no conectan con servicios reales.
import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const cuenta = '00000000-0000-4000-8000-000000000001'
const maquina = '00000000-0000-4000-8000-000000000002'
const papel = { id:'00000000-0000-4000-8000-000000000003', maquina_id:maquina, nombre:'KRAFT', activo:true }
let servidor, servicio, store, administracion, FormularioAdmin
let llamadas, pagina, respuestaRpc
const doble = {
  rpc:async (nombre, parametros) => { llamadas.push({ nombre,parametros }); return respuestaRpc() },
  from:tabla => {
    assert.equal(tabla, 'catalogo_papeles')
    let inicio
    const consulta = {
      select:campos => { assert.equal(campos,'id,maquina_id,nombre,activo'); return consulta },
      order:campo => { assert.equal(campo,'id'); return consulta },
      range:(desde, hasta) => { assert.equal(hasta-desde,199); inicio=desde; return consulta },
      abortSignal:async signal => { signal.throwIfAborted(); return pagina(inicio) },
    }
    return consulta
  },
}
before(async () => {
  globalThis.__papelesSupabasePrueba = doble
  servidor = await createServer({ configFile:false, envDir:false, optimizeDeps:{ noDiscovery:true }, server:{ middlewareMode:true }, plugins:[{
    name:'supabase-simulado', enforce:'pre',
    resolveId(id) {
      if (/(^|\/)supabase(?:\.ts)?$/.test(id) && !id.startsWith('@')) return '\0supabase-simulado'
      if (id.endsWith('/hooks/useAuth')) return '\0sesion-renderizada'
    },
    load(id) {
      if (id === '\0supabase-simulado') return 'export const supabase = globalThis.__papelesSupabasePrueba'
      if (id === '\0sesion-renderizada') return 'export const useAuth = () => globalThis.__papelesAuthPrueba.getState()'
    },
  },react()] })
  servicio = await servidor.ssrLoadModule('/src/lib/catalogoPapelesCalidad.ts')
  store = (await servidor.ssrLoadModule('/src/stores/authStore.ts')).useAuthStore
  globalThis.__papelesAuthPrueba = store
  administracion = await servidor.ssrLoadModule('/src/lib/administracion.ts')
  FormularioAdmin = (await servidor.ssrLoadModule('/src/components/administracion/FormularioAdmin.tsx')).FormularioAdmin
})
after(async () => { await servidor?.close(); delete globalThis.__papelesSupabasePrueba; delete globalThis.__papelesAuthPrueba })
function autenticar(rol = 'calidad', activo = true) {
  store.setState({ estado:'autenticado', perfil:{ id:cuenta,nombre:'Perfil de prueba',rol,activo }, sesion:{ user:{ id:cuenta } } })
}
beforeEach(() => {
  llamadas=[]; pagina=() => ({ data:[papel],error:null }); respuestaRpc=() => ({ data:papel,error:null }); autenticar()
})

test('normaliza mayúsculas y espacios; rechaza nombre vacío o demasiado largo sin escribir', async () => {
  assert.equal(servicio.normalizarNombrePapel('  kraft\t blanco  '),'KRAFT BLANCO')
  for (const nombre of ['', ' \t\n ', 'A'.repeat(201)]) await assert.rejects(servicio.guardarPapelCalidad(cuenta,maquina,nombre,[]), /1 a 200/)
  assert.equal(llamadas.length,0)
})
test('selecciona el duplicado existente de la misma máquina sin invocar ninguna RPC', async () => {
  const resultado = await servicio.guardarPapelCalidad(cuenta,maquina,'  kraFT ',[papel])
  assert.equal(resultado.papel.id,papel.id); assert.equal(resultado.existente,true); assert.equal(llamadas.length,0)
  await assert.rejects(servicio.guardarPapelCalidad(cuenta,maquina,'KRAFT',[{ ...papel,activo:false }]), /inactivo/)
})
test('solo llama la RPC nueva y comprueba la respuesta real antes de confirmar', async () => {
  const resultado = await servicio.guardarPapelCalidad(cuenta,maquina,' kraft ',[])
  assert.equal(resultado.papel.id,papel.id)
  assert.deepEqual(llamadas,[{ nombre:'obtener_o_crear_papel_calidad', parametros:{ p_maquina:maquina,p_nombre:'KRAFT' } }])
  respuestaRpc=() => ({ data:{ ...papel,maquina_id:cuenta },error:null })
  await assert.rejects(servicio.guardarPapelCalidad(cuenta,maquina,'KRAFT',[]), /comprobar/)
})
test('RPC ausente, RLS, conexión y respuesta inválida fallan sin fallback ni éxito simulado', async () => {
  for (const codigo of ['PGRST202','42883','42501','23505']) {
    respuestaRpc=() => ({ data:null,error:{ code:codigo } })
    await assert.rejects(servicio.guardarPapelCalidad(cuenta,maquina,'KRAFT',[]), /no está habilitada|no autorizó|No se confirmó/)
  }
  respuestaRpc=() => { throw new Error('Conexión interrumpida') }
  await assert.rejects(servicio.guardarPapelCalidad(cuenta,maquina,'KRAFT',[]), /No se confirmó/)
  respuestaRpc=() => ({ data:null,error:null })
  await assert.rejects(servicio.guardarPapelCalidad(cuenta,maquina,'KRAFT',[]), /Respuesta no válida/)
  assert.ok(llamadas.every(c => c.nombre === 'obtener_o_crear_papel_calidad'))
})
test('bloquea otros roles, perfil inactivo y cambio de sesión durante la solicitud', async () => {
  for (const rol of ['admin','calderas','ptar']) {
    autenticar(rol)
    await assert.rejects(servicio.guardarPapelCalidad(cuenta,maquina,'KRAFT',[]))
  }
  autenticar('calidad',false)
  await assert.rejects(servicio.guardarPapelCalidad(cuenta,maquina,'KRAFT',[]))
  assert.equal(llamadas.length,0)
  autenticar()
  respuestaRpc=() => { autenticar('admin'); return { data:papel,error:null } }
  await assert.rejects(servicio.guardarPapelCalidad(cuenta,maquina,'KRAFT',[]), /Solo Calidad/)
})
test('recarga todas las páginas del catálogo; no limita a 1000 y no oculta errores', async () => {
  const inicios=[]
  pagina=inicio => {
    inicios.push(inicio)
    return { data:inicio < 1200 ? Array.from({ length:200 },(_,i) => ({ ...papel,id:`00000000-0000-4000-8000-${String(inicio+i).padStart(12,'0')}` })) : [],error:null }
  }
  assert.equal((await servicio.consultarPapelesCalidad(cuenta,new AbortController().signal)).length,1200)
  assert.deepEqual(inicios,[0,200,400,600,800,1000,1200])
  pagina=() => ({ data:null,error:{ code:'42501' } })
  await assert.rejects(servicio.consultarPapelesCalidad(cuenta,new AbortController().signal), /actualizar el catálogo/)
})
test('el formulario muestra agregar solo en Producción de Calidad y conserva las demás vistas', () => {
  const datos = Object.fromEntries(administracion.seccionesAdmin.map(c => [c.tabla,{ filas:[],error:false,limitada:false }]))
  datos.catalogo_papeles.filas=[papel]
  const render = tabla => renderToStaticMarkup(createElement(FormularioAdmin,{ config:administracion.configuracionAdmin(tabla),datos,original:null,bloqueado:false,guardar:async () => true,cancelar() {} }))
  assert.match(render('programa_produccion'), /\+ AGREGAR OTRO\.\.\./)
  assert.doesNotMatch(render('eventos_calendario'), /AGREGAR OTRO/)
  autenticar('admin')
  assert.doesNotMatch(render('programa_produccion'), /AGREGAR OTRO/)
  assert.match(render('programa_produccion'), /opciones-papel-produccion/)
})
