import test, {before,after} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createServer} from 'vite'
let server, matrizCalidadDiaria, prepararDiaCompletoCalidad, crearPdfCalidadDiaria, crearXlsxCalidadDiaria, exigirExportacionCalidad, auth
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const solicitud={alcance:'dia-completo',fechaOperativa:'2026-11-03',area:'calderas'}
const puntos=[['AIMSU',['Color','Turbidez']],['Pozo',['Color']],['Pila M-2',['Color','Turbidez','SST']],['Pila Calderas',['Color']],['Pila M-4',['Color','Turbidez','SST']],['PEMEX',['Color']],['Retorno a TQE almacen',['Color']]]
const idsPunto=['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000007']
function muestra(n,tipo='dia'){
  let indice=0
  const mid=id(100+n),tid=id(10+['dia','tarde','noche'].indexOf(tipo)), fecha=new Date(Date.parse('2026-11-04T05:50:00Z')+n*60000).toISOString()
  return {lectura:{id:mid,turno_id:tid,hora_muestra:'23:50:00',capturado_en:fecha,recibido_en:fecha,creado_por:id(1),notas:n===0?'Comentario original =1+1':null,eliminado_en:null,eliminado_por:null,
    resultados:puntos.flatMap(([nombre,parametros],p)=>parametros.map(parametro=>({id:id(1000+n*20+indice++),muestra_id:mid,punto_id:idsPunto[p],parametro_id:id(50+['Color','Turbidez','SST'].indexOf(parametro)),valor:n===0?0:n+0.25,
      limite_min_aplicado:null,limite_max_aplicado:parametro==='Color'?300:parametro==='Turbidez'?25:null,fuera_norma:parametro==='SST'?null:false,
      punto:{id:idsPunto[p],nombre,area:'calderas'},parametro:{id:id(50+['Color','Turbidez','SST'].indexOf(parametro)),nombre:parametro,unidad:parametro==='Color'?'Pt-Co':parametro==='Turbidez'?'NTU':'mg/L'}})))},
    turno:{id:tid,fecha_operativa:'2026-11-03',area:'calderas',turno:tipo,operador_id:id(4),operador_acompanante_id:null,iniciado_por:id(1),iniciado_en:'2026-11-03T12:00:00Z',finalizado_en:null,notas_cierre:null},operadorNombre:'Operador '+tipo}
}
const matriz=(muestras)=>matrizCalidadDiaria(prepararDiaCompletoCalidad(solicitud,muestras))
const siete=()=>['dia','dia','tarde','noche','noche','noche','noche'].map((t,n)=>muestra(n,t))
const fuente=fs.readFileSync(new URL('../src/assets/fuentes/DejaVuSans.ttf',import.meta.url)).toString('base64')
const logo=new Uint8Array(fs.readFileSync(new URL('../src/assets/cpx-logo-barra.png',import.meta.url)))
before(async()=>{
  globalThis.__formatoCalidadAuth={estado:'autenticado',perfil:{id:id(1),activo:true,rol:'calidad'},sesion:{user:{id:id(1)}}}
  server=await createServer({configFile:false,envDir:false,cacheDir:'.tmp/vite-tests/formatos-calidad',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false},plugins:[{name:'formatos-aislados',enforce:'pre',
    resolveId(n){if(/(^|\/)supabase(?:\.ts)?$/.test(n)&&!n.startsWith('@'))return '\0sin-base';if(/(^|\/)authStore(?:\.ts)?$/.test(n))return '\0auth-formato'},
    load(n){if(n==='\0sin-base')return 'export const supabase = {}';if(n==='\0auth-formato')return 'export const useAuthStore = {getState:()=>globalThis.__formatoCalidadAuth}'},
  }]})
  ;({matrizCalidadDiaria}=await server.ssrLoadModule('/src/lib/matrizCalidadDiaria.ts'))
  ;({prepararDiaCompletoCalidad}=await server.ssrLoadModule('/src/lib/reporteDiarioCalidad.ts'))
  ;({crearPdfCalidadDiaria}=await server.ssrLoadModule('/src/lib/pdfCalidadDiaria.ts'))
  ;({crearXlsxCalidadDiaria}=await server.ssrLoadModule('/src/lib/xlsxCalidadDiaria.ts'))
  ;({exigirExportacionCalidad}=await server.ssrLoadModule('/src/lib/exportarDiaCalidad.ts'))
  auth=globalThis.__formatoCalidadAuth
})
after(async()=>{await server?.close();delete globalThis.__formatoCalidadAuth})
function unzip(bytes){
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), d=new TextDecoder(), archivos={}
  for(let o=0;v.getUint32(o,true)===0x04034b50;){const n=v.getUint16(o+26,true),e=v.getUint16(o+28,true),size=v.getUint32(o+18,true),ini=o+30+n+e;archivos[d.decode(bytes.slice(o+30,o+30+n))]=d.decode(bytes.slice(ini,ini+size));o=ini+size}
  return archivos
}
function textosPdf(pdf){
  const mapa=pdf.getFont().metadata.toUnicode
  return pdf.internal.pages.slice(1).map(p=>[...p.join('\n').matchAll(/<([\da-f]+)>\s*Tj/gi)].map(m=>{
    let s='';for(let i=0;i<m[1].length;i+=4)s+=String.fromCodePoint(mapa[parseInt(m[1].slice(i,i+4),16)]??32);return s
  }).join(' '))
}
test('matriz fisica: agrupa por hora sin perder muestras, valores ni limites historicos',()=>{
  const m=matriz(siete())
  assert.equal(m.total,7);assert.deepEqual(m.turnos.map(t=>t.filas.length),[1,1,1]);assert.equal(m.columnas.length,12)
  assert.deepEqual([...new Set(m.columnas.map(c=>c.punto))],['AIMSU','Pila M-2','Pila Calderas','Pozo','Pila M-4','PEMEX','Retorno a TQE almacen'])
  assert.equal(m.turnos.flatMap(t=>t.filas).flatMap(f=>f.valores).reduce((n,v)=>n+(v===null?0:String(v).split(' / ').length),0),84)
  assert.equal(m.turnos[0].filas[0].valores[0],'0 / 1.25')
  assert.equal(m.columnas.find(c=>c.parametro==='Turbidez').maximo,25)
  const cambiadas=siete();cambiadas[1].lectura.resultados[0].limite_max_aplicado=400
  const historica=matriz(cambiadas)
  assert.equal(historica.columnas.length,13);assert.equal(historica.turnos[0].filas[0].valores.filter(v=>v!==null).length,13)
})
test('XLSX editable: matriz, números, límites, comentarios, operadores y encabezados fijos',()=>{
  const xml=unzip(crearXlsxCalidadDiaria(matriz(siete()))), hoja=xml['xl/worksheets/sheet1.xml']
  for(const s of ['AIMSU','TURBIDEZ','≤ 25','COMENTARIOS','OPERADORES','Operador noche','Comentario original =1+1','landscape','fitToHeight="0"'])assert.ok(hoja.includes(s),s)
  assert.ok(hoja.includes('0 / 1.25'),'los dos valores de la misma hora se conservan en una celda')
  assert.match(hoja,/>TURBIDEZ</)
  assert.doesNotMatch(hoja,/<f>/)
  assert.ok(hoja.includes('topLeftCell="C4"') && hoja.includes('state="frozen"'))
  assert.match(xml['xl/workbook.xml'],/Print_Titles/)
  assert.ok(hoja.includes('<mergeCell ref="B2:B3"/>'))
})
test('PDF imprimible: matriz horizontal, datos historicos y turnos incompletos',()=>{
  const pdf=crearPdfCalidadDiaria(matriz([muestra(0),muestra(30,'noche')]),fuente)
  assert.ok(pdf.internal.pageSize.getWidth()>pdf.internal.pageSize.getHeight())
  const texto=textosPdf(pdf).join(' ').replace(/\s+/g,' ')
  for(const s of ['AIMSU','Turbidez','≤ 25','Sin muestras','COMENTARIOS','OPERADORES','Comentario original =1+1','00:00','03/11/2026'])assert.ok(texto.includes(s),s)
  assert.ok(!texto.includes('04/11/2026'))
  assert.ok(!texto.includes('Registros:'))
  assert.ok(!texto.includes('Bloque'))
  assert.equal(new TextDecoder().decode(new Uint8Array(pdf.output('arraybuffer')).slice(0,5)),'%PDF-')
})
test('mas de veinte muestras, columnas nuevas y observaciones extensas no se omiten',()=>{
  const muestras=Array.from({length:45},(_,n)=>muestra(n,'noche'))
  muestras[0].lectura.notas='Observacion larga\n'.repeat(140)+'FIN-OBSERVACION'
  const m=matriz(muestras), libro=unzip(crearXlsxCalidadDiaria(m))
  assert.ok(libro['xl/worksheets/sheet1.xml'].includes('FIN-OBSERVACION'))
  assert.equal(m.total,45);assert.equal(m.turnos[2].filas.length,2)
  assert.equal(m.turnos[2].filas.flatMap(f=>f.valores).reduce((n,v)=>n+(v===null?0:String(v).split(' / ').length),0),45*12)
  const pdf=crearPdfCalidadDiaria(m,fuente)
  assert.ok(pdf.getNumberOfPages()>1);assert.ok(textosPdf(pdf).join(' ').includes('FIN-OBSERVACION'))
  for(const pagina of textosPdf(pdf))assert.ok(pagina.includes('COPAMEX'))
  const vacio=matriz([]);assert.ok(textosPdf(crearPdfCalidadDiaria(vacio,fuente)).join(' ').includes('Sin muestras'))
})
test('los puntos adicionales se conservan y las areas se validan',()=>{
  const registro=muestra(0);registro.lectura.resultados[0].punto.nombre='Punto historico adicional'
  assert.ok(matriz([registro]).columnas.some(c=>c.punto==='Punto historico adicional'))
  assert.throws(()=>prepararDiaCompletoCalidad({...solicitud,area:'ptar'},[registro]),/no corresponde/)
})
test('limites historicos conservan todas las medidas en la matriz, Excel y PDF',()=>{
  const registros=[muestra(0),muestra(1)]
  registros[1].lectura.resultados[0].limite_max_aplicado=400
  const m=matriz(registros), libro=unzip(crearXlsxCalidadDiaria(m))
  assert.equal(m.columnas.length,13)
  const hojas=Object.entries(libro).filter(([n])=>/^xl\/worksheets\/sheet\d+\.xml$/.test(n))
  assert.equal(hojas.length,1)
  assert.equal(m.total,2);assert.equal(m.turnos[0].filas.length,1)
  assert.equal(m.turnos[0].filas[0].valores.filter(v=>v!==null).length,13)
  assert.equal([...hojas[0][1].matchAll(/0 \/ 1\.25/g)].length,12)
  const texto=textosPdf(crearPdfCalidadDiaria(m,fuente)).join(' ').replace(/\s+/g,' ')
  assert.ok(!texto.includes('Bloque'));assert.ok(texto.includes('≤ 400'))
})
test('logo real en PDF; exportación Excel conserva hora agrupada, fecha y operadores',()=>{
  const m=matriz([muestra(0),muestra(30,'noche')])
  assert.equal(m.turnos[0].filas[0].hora,'23:00')
  assert.equal(m.turnos[2].filas[0].hora,'00:00')
  const pdf=crearPdfCalidadDiaria(m,fuente,logo),texto=textosPdf(pdf).join(' ').replace(/\s+/g,' ')
  assert.match(pdf.output(),/\/Subtype \/Image/)
  assert.ok(texto.includes('Fecha operativa: 03/11/2026'))
  assert.ok(!/Bloque|Registros:|04\/11\/2026|Día: 03\/11/.test(texto))
  const hojas=unzip(crearXlsxCalidadDiaria(m)),hoja=hojas['xl/worksheets/sheet1.xml']
  assert.doesNotMatch(hoja,/<drawing/)
  assert.ok(!Object.keys(hojas).some(nombre=>nombre.startsWith('xl/media/')||nombre.startsWith('xl/drawings/')))
  assert.ok(hoja.includes('nov-26'))
  assert.doesNotMatch(hoja,/Fecha operativa:|Registros:|Bloque|04\/11\/2026|<t[^>]*>TURNO DÍA/)
})
test('la aplicacion restringe exportacion a Calidad y Administracion',()=>{
  for(const rol of ['calidad','admin','calderas','ptar']){
    auth.perfil.rol=rol
    if(['admin','calidad'].includes(rol))assert.ok(exigirExportacionCalidad())
    else assert.throws(()=>exigirExportacionCalidad(),/disponible/)
  }
})
