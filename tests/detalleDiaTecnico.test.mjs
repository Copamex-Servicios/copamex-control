import test,{before,after} from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'vite'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
let server,Contenido
before(async()=>{
 server=await createServer({configFile:false,envDir:false,cacheDir:'.tmp/vite-tests/detalle-dia-tecnico',
  optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false},
  plugins:[{name:'detalle-tecnico-simulado',enforce:'pre',
   resolveId(n){if(/(^|\/)supabase(?:\.ts)?$/.test(n)&&!n.startsWith('@'))return '\0detalle-tecnico-supabase'},
   load(n){if(n==='\0detalle-tecnico-supabase')return 'export const supabase={}'},
  }]})
 Contenido=(await server.ssrLoadModule('/src/components/administracion/ConsolidadoReportesTecnicos.tsx')).ContenidoDia
})
after(async()=>{await server?.close()})
test('detalle compacto muestra tres turnos sin seleccionar y conserva las acciones de ver y corregir',()=>{
 const dia={fecha:'2026-11-12',calderas:{tarde:{id:'reporte',turnoId:'turno',area:'calderas',
  fechaOperativa:'2026-11-12',turno:'tarde',operador:'OPERADORES DE PRUEBA',revision:1}},ptar:{}}
 const html=renderToStaticMarkup(createElement(Contenido,{cuenta:'cuenta',dia,
  filtros:{desde:'2026-11-12',hasta:'2026-11-12',area:'todas',turno:'tarde'},corregir(){}}))
 assert.match(html,/Detalle del día/)
 assert.doesNotMatch(html,/type="checkbox"|No seleccionado|Seleccionar/)
 assert.match(html,/>Día</);assert.match(html,/>Tarde</);assert.match(html,/>Noche</)
 assert.equal((html.match(/No hay captura registrada/g)??[]).length,2)
 assert.match(html,/>Registrado</)
 assert.match(html,/Ver reporte del turno Tarde/)
 assert.match(html,/Corrección administrativa del turno Tarde/)
 assert.equal((html.match(/<svg /g)??[]).length,2)
})
