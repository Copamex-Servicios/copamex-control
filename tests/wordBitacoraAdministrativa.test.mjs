// Archivos y Supabase simulados. No consulta datos remotos.
import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { readFileSync } from 'node:fs'
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const logo=new Uint8Array(readFileSync(new URL('../src/assets/plantillas/logo-relevantes.png',import.meta.url)))
const fila=(n,area='ptar')=>({id:id(n),area,actividad:`Actividad ${n}`,fecha:'2026-11-05',creado_en:`2026-11-05T12:00:${String(n%60).padStart(2,'0')}Z`,actualizado_en:'2026-11-05T12:02:00Z',revision:0})
const reporte=()=>({mes:'2026-11',areas:[{area:'ptar',nombre:'PTAR',actividades:[fila(1),fila(2)]},{area:'calderas',nombre:'Calderas',actividades:[fila(3,'calderas')]},{area:'obra_civil',nombre:'Obra Civil',actividades:[]}]})
function unzip(bytes){
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),d=new TextDecoder(),files={}
 for(let p=0;v.getUint32(p,true)===0x04034b50;){
  const n=v.getUint16(p+26,true),e=v.getUint16(p+28,true),size=v.getUint32(p+18,true),start=p+30+n+e,data=bytes.slice(start,start+size)
  let crc=0xffffffff;for(const b of data){crc^=b;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}
  assert.equal((crc^0xffffffff)>>>0,v.getUint32(p+14,true),'CRC válido')
  files[d.decode(bytes.slice(p+30,p+30+n))]=data;p=start+size
 }
 return files
}
let server,crear,servicio,store,consultas,filas,fetchAnterior=globalThis.fetch,logoError=false
function sesion(rol='admin',cuenta=id(900)){store.setState({estado:'autenticado',perfil:{id:cuenta,nombre:'Prueba',rol,activo:true},sesion:{user:{id:cuenta}}})}
before(async()=>{
 globalThis.__wordBA={rpc(nombre,p){consultas.push({nombre,p});return {abortSignal:async signal=>{
  signal.throwIfAborted();assert.equal(nombre,'consultar_bitacora_administrativa')
  const elegidas=filas.filter(f=>p.p_area==='todas'||f.area===p.p_area)
  const start=p.p_antes_id?elegidas.findIndex(f=>f.id===p.p_antes_id)+1:0
  return {data:{filas:elegidas.slice(start,start+25),mas:start+25<elegidas.length,mes:p.p_mes,ahora:'2026-11-05T12:02:00Z',version:'2026-11-05T12:02:00Z'},error:null}
 }}}}
 server=await createServer({configFile:false,envDir:false,cacheDir:'.tmp/vite-tests/word-bitacora',server:{middlewareMode:true,hmr:false},plugins:[{name:'word-bitacora-sin-remoto',enforce:'pre',resolveId(n){if(/(^|\/)supabase(?:\.ts)?$/.test(n)&&!n.startsWith('@'))return '\0word-ba-supabase'},load(n){if(n==='\0word-ba-supabase')return 'export const supabase=globalThis.__wordBA'}}]})
 store=(await server.ssrLoadModule('/src/stores/authStore.ts')).useAuthStore
 crear=(await server.ssrLoadModule('/src/lib/docxBitacoraAdministrativa.ts')).crearDocxBitacoraAdministrativa
 servicio=await server.ssrLoadModule('/src/lib/exportarBitacoraAdministrativa.ts')
})
after(async()=>{await server?.close();globalThis.fetch=fetchAnterior;delete globalThis.__wordBA})
beforeEach(()=>{
 store.setState({estado:'sin-sesion',perfil:null,sesion:null});sesion();consultas=[];logoError=false
 filas=Array.from({length:58},(_,i)=>fila(58-i,['ptar','calderas','obra_civil'][i%3]))
 globalThis.fetch=async()=>new Response(logoError?null:logo,{status:logoError?404:200})
})
test('DOCX real editable: logo, mes, secciones y viñetas con solo el día',()=>{
 const files=unzip(crear(reporte(),logo)),xml=new TextDecoder().decode(files['word/document.xml'])
 assert.equal(Object.keys(files).length,19);assert.deepEqual(files['word/media/image1.png'],logo)
 for(const texto of ['RELEVANTES SERVICIOS-ENERGETICOS','Noviembre','Servicios y energéticos','PTAR','Calderas y compresores','Obra Civil','El día 05, actividad 1','Sin actividades.'])assert.ok(xml.replace(/<[^>]*>/g,'').includes(texto),texto)
 assert.ok(new TextDecoder().decode(files['word/header1.xml']).includes('COINSA Noviembre-2026'))
 assert.ok(!xml.includes('Bitácora administrativa'));assert.ok(!xml.includes('Lorem ipsum'))
 assert.equal((xml.match(/<w:tbl>/g)||[]).length,0);assert.equal((xml.match(/<w:numPr>/g)||[]).length,3);assert.ok(xml.includes('El día 05, actividad 1'));assert.ok(!xml.includes('05/11/2026'))
 assert.ok(new TextDecoder().decode(files['word/numbering.xml']).includes('w:numFmt w:val="bullet"'));
 assert.ok(!xml.includes('12:00'));assert.ok(!xml.includes('creado_por'));assert.ok(!xml.includes(id(1)))
 assert.ok(new TextDecoder().decode(files['word/styles.xml']).includes('w:styleId="Ttulo4"'))
 assert.ok(!new TextDecoder().decode(files['word/_rels/document.xml.rels']).includes('TargetMode="External"'))
})
test('conserva texto largo, saltos, acentos y caracteres XML sin insertar instrucciones',()=>{
 const r=reporte(),texto='Árbol & revisión <equipo> "A"\n\n'+'Texto extenso '.repeat(600)+'</w:t><w:instrText>PRUEBA</w:instrText>'
 r.areas[0].actividades[0].actividad=texto
 const xml=new TextDecoder().decode(unzip(crear(r,logo))['word/document.xml'])
 assert.ok(xml.includes('árbol &amp; revisión &lt;equipo&gt; &quot;a&quot;'));assert.ok(xml.includes('&lt;/w:t&gt;'))
 assert.ok(!xml.includes('<w:instrText>PRUEBA'));assert.equal((xml.match(/texto extenso /g)||[]).length,600)
 assert.ok(xml.includes('<w:t xml:space="preserve"></w:t>'))
})
test('rechaza datos repetidos, áreas mezcladas y registros de otro mes',()=>{
 const r=reporte();r.areas[0].actividades.push(r.areas[0].actividades[0]);assert.throws(()=>crear(r,logo),/repetidas/)
 const otro=reporte();otro.areas[0].actividades[0].area='calderas';assert.throws(()=>crear(otro,logo))
 const mes=reporte();mes.areas[0].actividades[0].fecha='2026-12-01';assert.throws(()=>crear(mes,logo))
 assert.throws(()=>crear(reporte(),new Uint8Array()),/logo/)
})
test('exporta las tres páginas del mes y todas las áreas sin depender de las 25 visibles',async()=>{
 const archivo=await servicio.prepararWordBitacora('2026-11','todas',new AbortController().signal)
 assert.equal(consultas.length,3);assert.ok(archivo.nombre.endsWith('.docx'));assert.ok(archivo.nombre.includes('2026-11'))
 assert.equal(archivo.blob.type,'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
 const xml=new TextDecoder().decode(unzip(new Uint8Array(await archivo.blob.arrayBuffer()))['word/document.xml'])
 assert.equal((xml.match(/>El día \d{2}, actividad \d+<\/w:t>/g)||[]).length,58)
})
test('respeta área seleccionada y documentos mensuales sin actividades',async()=>{
 const uno=await servicio.prepararWordBitacora('2026-11','ptar',new AbortController().signal)
 let xml=new TextDecoder().decode(unzip(new Uint8Array(await uno.blob.arrayBuffer()))['word/document.xml'])
 assert.ok(xml.includes('PTAR'));assert.ok(!xml.includes('Obra Civil'));assert.ok(!xml.includes('Calderas'))
 filas=[]
 const vacio=await servicio.prepararWordBitacora('2026-11','todas',new AbortController().signal)
 xml=new TextDecoder().decode(unzip(new Uint8Array(await vacio.blob.arrayBuffer()))['word/document.xml'])
 assert.equal((xml.match(/Sin actividades\./g)||[]).length,3)
})
test('solo Administración exporta; cancelación, error de logo y cambio de cuenta no descargan',async()=>{
 for(const rol of ['calderas','ptar','calidad']){sesion(rol);await assert.rejects(servicio.prepararWordBitacora('2026-11','todas',new AbortController().signal))}
 assert.equal(consultas.length,0);sesion();const c=new AbortController();c.abort()
 await assert.rejects(servicio.prepararWordBitacora('2026-11','todas',c.signal))
 logoError=true;await assert.rejects(servicio.prepararWordBitacora('2026-11','todas',new AbortController().signal),/logo/)
 logoError=false;const archivo=await servicio.prepararWordBitacora('2026-11','todas',new AbortController().signal)
 sesion('admin',id(901));assert.throws(()=>servicio.descargarWordBitacora(archivo),/cuenta cambió/)
})
