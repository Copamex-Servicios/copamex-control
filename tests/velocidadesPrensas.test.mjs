// Regresiones locales, Supabase simulado: sin conexiones ni escrituras remotas.
import test, {before, after} from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'vite'
import {borradorBitacoraPTAR, medicionesBitacoraPTAR, normalizarVelocidadesPrensas} from '../src/lib/tiposBitacoraPTAR.ts'
let server, servicio, revision, store
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
function borrador(){
 const b=borradorBitacoraPTAR();b.reporteRelevante='Turno en orden';for(const m of medicionesBitacoraPTAR)b.mediciones[m.campo]='1'
 b.estadoAgitador='Servicio';b.destinoDescarga='Tanque 11';b.horasDescarga={tanque11:'5',tanques56:'3'}
 b.bombas={'9':'Automático (A)','13':'Manual (M)','9310':'Automático (A)'};b.prensas={Essity:'Mantenimiento',Nalco:'Servicio'};return b
}
function snapshot(){const b=borrador();return {registro:{id:id(2),turno_id:id(3),creado_por:id(1),version_formato:1,revision:0,creado_en:'2026-11-06T14:00:00Z',reporte_relevante:b.reporteRelevante,...Object.fromEntries(medicionesBitacoraPTAR.map(m=>[m.campo,1])),estado_agitador_9300:'Servicio',destino_descarga_daf:'Tanque 11',horas_descarga_tanque_11:5,horas_descarga_tanques_5_6:3,modo_bomba_9:'A',modo_bomba_13:'M',modo_bomba_9310:'A',estado_prensa_essity:'Mantenimiento',estado_prensa_nalco:'Servicio',comentario_prensas:null}}}
before(async()=>{
 server=await createServer({configFile:false,envDir:false,cacheDir:'.tmp/vite-tests/velocidades-prensas',server:{middlewareMode:true,hmr:false},plugins:[{name:'sin-remoto',enforce:'pre',resolveId(n){if(/(^|\/)supabase(?:\.ts)?$/.test(n)&&!n.startsWith('@'))return '\0supabase-velocidades'},load(n){if(n==='\0supabase-velocidades')return 'export const supabase={}'}}]})
 servicio=await server.ssrLoadModule('/src/lib/bitacoraTecnicaPTAR.ts');revision=await server.ssrLoadModule('/src/lib/revisionTecnica.ts');store=(await server.ssrLoadModule('/src/stores/authStore.ts')).useAuthStore
 store.setState({estado:'autenticado',perfil:{id:id(1),nombre:'Admin de prueba',rol:'admin',activo:true},sesion:{user:{id:id(1)}}})
})
after(async()=>{await server?.close()})
test('velocidades independientes: decimales, cero explícito y ausencia sin inferir estados',()=>{
 assert.equal(normalizarVelocidadesPrensas(),undefined);assert.equal(normalizarVelocidadesPrensas({Essity:'',Nalco:''}),undefined)
 assert.deepEqual(normalizarVelocidadesPrensas({Essity:' 42.5 ',Nalco:'0.0'}),{Essity:'42.5',Nalco:'0.0'})
 assert.deepEqual(normalizarVelocidadesPrensas({Essity:'0',Nalco:''}),{Essity:'0',Nalco:null})
 for(const v of ['-1','NaN','Infinity','1e999','abc','0x10'])assert.throws(()=>normalizarVelocidadesPrensas({Essity:v,Nalco:''}),/velocidad válida/)
})
test('guardado conserva estructura anterior sin velocidad y precisión decimal sin conversiones',()=>{
 const b=borrador();assert.equal('velocidadesPrensas' in servicio.prepararDatosPTAR(b),false)
 b.velocidadesPrensas={Essity:'42.500000000000000001',Nalco:'0'};const d=servicio.prepararDatosPTAR(b)
 assert.deepEqual(d.velocidadesPrensas,b.velocidadesPrensas);assert.deepEqual(d.prensas,b.prensas)
})
test('históricos sin columnas no inventan velocidades; lectura conserva ambos valores incluyendo cero',()=>{
 const s=snapshot();assert.deepEqual(servicio.leerReportePTAR(s,id(3)).borrador.velocidadesPrensas,{Essity:'',Nalco:''})
 s.registro.velocidad_prensa_essity='42.5';s.registro.velocidad_prensa_nalco=0
 assert.deepEqual(servicio.leerReportePTAR(s,id(3)).borrador.velocidadesPrensas,{Essity:'42.5',Nalco:'0'})
})
test('corrección administrativa incluye cambios y borrado explícito con revisión existente',()=>{
 const reporte=servicio.leerReportePTAR(snapshot(),id(3));reporte.borrador.velocidadesPrensas={Essity:'42.5',Nalco:'0'}
 const detalle={area:'ptar',reporte,fila:{id:id(2),area:'ptar',turno:'dia',turnoId:id(3),fechaOperativa:'2026-11-06',revision:0,creadoEn:reporte.creadoEn,operador:'Prueba'}}
 const b=structuredClone(reporte.borrador);b.velocidadesPrensas={Essity:'',Nalco:''}
 const s=revision.prepararCorreccionTecnica(id(1),detalle,b,'Corregir velocidades')
 assert.equal(s.rpc,'corregir_bitacora_ptar_admin_v2');assert.deepEqual(s.datos.velocidadesPrensas,{Essity:null,Nalco:null})
 b.velocidadesPrensas={Essity:'12.5',Nalco:'0'};assert.deepEqual(revision.prepararCorreccionTecnica(id(1),detalle,b,'Corrección').datos.velocidadesPrensas,{Essity:12.5,Nalco:0})
 b.velocidadesPrensas={Essity:'-1',Nalco:''};assert.throws(()=>revision.prepararCorreccionTecnica(id(1),detalle,b,'Corrección'),/velocidad válida/)
})
