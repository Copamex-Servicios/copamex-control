import test, {before,after} from 'node:test'
import assert from 'node:assert/strict'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import {textoLimitesResultadoCalidad,textoEvaluacionCalidad} from '../src/lib/formatoCalidad.ts'
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
let server,Formulario,Guardada,Encabezado,Seguimiento,PanelLimites,administracion
const punto={id:id(1),nombre:'Pila M-4',area:'calderas',activo:true,orden:1}
const parametros=[
 {id:id(2),nombre:'Color',unidad:null,activo:true,areas_captura:['calderas'],puntos_permitidos:null,evaluar_limites:true},
 {id:id(3),nombre:'SST',unidad:null,activo:true,areas_captura:['calderas'],puntos_permitidos:[id(1)],evaluar_limites:false},
]
const registro={operadorNombre:'OPERADOR UNO · OPERADOR DOS',turno:{area:'calderas',fecha_operativa:'2026-11-12'},lectura:{
 id:id(5),capturado_en:'2026-11-12T15:17:47Z',notas:null,resultados:[
  {id:id(6),punto_id:id(1),parametro_id:id(3),punto,parametro:parametros[1],valor:2,
   limite_min_aplicado:null,limite_max_aplicado:null,fuera_norma:null},
 ]}}
before(async()=>{
 server=await createServer({configFile:false,envDir:false,cacheDir:'.tmp/vite-tests/presentacion-calidad',
  optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false},
  plugins:[{name:'presentacion-calidad-simulada',enforce:'pre',
   resolveId(n){
    if(n.endsWith('/useAuth'))return '\0auth-presentacion'
    if(n.includes('useSeguimientoCalidad'))return '\0seguimiento-presentacion'
    if(n.endsWith('/PanelTurno'))return '\0turno-presentacion'
    if(n.endsWith('/InformacionDelDia'))return '\0informacion-presentacion'
    if(n.includes('useLimitesCalidad'))return '\0limites-presentacion'
    if(/(^|\/)supabase(?:\.ts)?$/.test(n)&&!n.startsWith('@'))return '\0sin-supabase-presentacion'
   },
   load(n){
    if(n==='\0auth-presentacion')return 'export const useAuth=()=>({perfil:{rol:"admin"}})'
    if(n==='\0seguimiento-presentacion')return 'export const useSeguimientoCalidad=()=>globalThis.__seguimientoPresentacion'
    if(n==='\0turno-presentacion')return 'import {createElement} from "react";export const PanelTurno=()=>createElement("section",null,"Gestión del turno")'
    if(n==='\0informacion-presentacion')return 'export const InformacionDelDia=()=>null'
    if(n==='\0limites-presentacion')return 'export const useLimitesCalidad=()=>globalThis.__limitesPresentacion'
    if(n==='\0sin-supabase-presentacion')return 'export const supabase={}'
   },
  }]})
 Formulario=(await server.ssrLoadModule('/src/components/calidad/FormularioCalidad.tsx')).FormularioCalidad
 Guardada=(await server.ssrLoadModule('/src/components/calidad/LecturaCalidadGuardada.tsx')).LecturaCalidadGuardada
 Encabezado=(await server.ssrLoadModule('/src/components/operativo/EncabezadoOperativo.tsx')).EncabezadoOperativo
 Seguimiento=(await server.ssrLoadModule('/src/components/calidad/SeguimientoColorM4.tsx')).SeguimientoColorM4
 PanelLimites=(await server.ssrLoadModule('/src/components/administracion/PanelLimitesCalidad.tsx')).PanelLimitesCalidad
 administracion=await server.ssrLoadModule('/src/lib/administracion.ts')
})
after(async()=>{await server?.close();delete globalThis.__limitesPresentacion;delete globalThis.__seguimientoPresentacion})
test('los parámetros sin evaluación no tienen columna en límites y su configuración no se edita desde el catálogo',()=>{
 globalThis.__limitesPresentacion={cuenta:id(90),limites:[],cargando:false,error:null,actualizar(){}}
 const datos={
  puntos_muestreo:{filas:[punto],error:false,limitada:false},
  parametros_calidad:{filas:parametros,error:false,limitada:false},
 }
 const html=renderToStaticMarkup(createElement(PanelLimites,{datos}))
 assert.match(html,/Límite de Color/)
 assert.doesNotMatch(html,/Límite de SST|Límite máximo de SST/)
 const config=administracion.configuracionAdmin('parametros_calidad')
 assert.ok(config.columnas.includes('evaluar_limites'))
 assert.equal(config.campos.some(c=>c.clave==='evaluar_limites'),false)
 assert.equal(administracion.leerFilaAdmin(parametros[1],config).evaluar_limites,false)
})
test('la captura adicional del operador usa un diálogo sin repetir título, estado ni instrucciones del seguimiento',()=>{
 globalThis.__seguimientoPresentacion={seguimiento:{id:id(80),creado_por:id(81),instruccion:'TOMAR EL COLOR DE M4 CADA HORA'},error:null,cargando:false,actualizar(){}}
 const html=renderToStaticMarkup(createElement(Seguimiento,{cuenta:id(90),habilitado:true,muestraHabitual:true}))
 assert.match(html,/aria-haspopup="dialog"/)
 assert.match(html,/<dialog[^>]*class="co-color-m4-dialogo"/)
 assert.doesNotMatch(html,/Seguimiento de color M4|TOMAR EL COLOR DE M4 CADA HORA|>Activo</)
 assert.doesNotMatch(html,/<dialog[^>]* open/)
})
test('el encabezado permite mostrar Gestión del turno solo al entrar a Bitácora',()=>{
 const props={area:'calderas',fecha:'2026-11-12',informacion:{}}
 assert.match(renderToStaticMarkup(createElement(Encabezado,{...props,mostrarTurno:true})),/Gestión del turno/)
 assert.doesNotMatch(renderToStaticMarkup(createElement(Encabezado,{...props,mostrarTurno:false})),/Gestión del turno/)
})
test('la actualización periódica conserva la presentación del formulario y sus etiquetas de límite',()=>{
 globalThis.__limitesPresentacion={disponible:true,cargando:false,error:null,
  limites:[{punto_id:id(1),parametro_id:id(2),limite_min:null,limite_max:250}]}
 const props={area:'calderas',catalogos:{puntos:[punto],parametros},deshabilitado:false,alGuardar:async()=>true}
 const antes=renderToStaticMarkup(createElement(Formulario,props))
 globalThis.__limitesPresentacion.cargando=true
 const durante=renderToStaticMarkup(createElement(Formulario,props))
 assert.equal(durante,antes)
 assert.match(durante,/Color ≤ 250/)
 assert.doesNotMatch(durante,/Consultando límite/)
})
test('SST no muestra mensajes de evaluación ni insignias sin límites',()=>{
 globalThis.__limitesPresentacion={disponible:true,cargando:false,error:null,limites:[]}
 const original={...registro.lectura}
 const html=renderToStaticMarkup(createElement(Formulario,{area:'calderas',catalogos:{puntos:[punto],parametros},original,deshabilitado:false,alGuardar:async()=>true}))
 assert.match(html,/value="2"/)
 assert.doesNotMatch(html,/Sin límite|no se evalúa|Límite original/)
 const tabla=renderToStaticMarkup(createElement(Guardada,{registro,historial:true,compacta:true}))
 assert.doesNotMatch(tabla,/Sin límites|sin-limites/)
 assert.match(tabla,/>—</)
 assert.equal(textoLimitesResultadoCalidad(null,null),'—')
 assert.equal(textoEvaluacionCalidad(null),'—')
 assert.equal(textoLimitesResultadoCalidad(0,250),'≥ 0 · ≤ 250')
 assert.equal(textoEvaluacionCalidad(true),'Fuera de norma')
})
test('las lecturas adicionales se agregan al final de la misma tabla con su hora',()=>{
 const adicional=structuredClone(registro)
 adicional.lectura.id=id(99);adicional.lectura.seguimientoId=id(90);adicional.lectura.turno_id=id(10)
 adicional.turno.id=id(10);adicional.lectura.capturado_en='2026-11-12T17:30:00Z'
 adicional.lectura.resultados[0].id=id(100);adicional.lectura.resultados[0].valor=30
 const normal=structuredClone(registro)
 normal.turno.id=id(10);normal.lectura.turno_id=id(10)
 const html=renderToStaticMarkup(createElement(Guardada,{registro:normal,adicionales:[adicional],historial:true,compacta:true}))
 assert.equal((html.match(/<table /g)??[]).length,1)
 assert.match(html,/Todos \(2\)/)
 assert.match(html,/Adicional ·/)
 assert.match(html,/2026-11-12T17:30:00Z/)
 assert.ok(html.indexOf('>2</td>')<html.indexOf('>30</td>'))
 assert.doesNotMatch(html,/<details/)
})
