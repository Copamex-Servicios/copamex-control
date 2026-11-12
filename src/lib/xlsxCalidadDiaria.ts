import { crearXlsxReporte, columnaExcel } from './xlsxReporte'
import { bloquesColumnasCalidad, fragmentosTextoCalidad, limiteColumnaCalidad, nombresTurnoCalidad, operadoresCalidad, tituloCalidadFisico } from './matrizCalidadDiaria'
import type { MatrizCalidadDiaria } from './matrizCalidadDiaria'

const xml = (s: string) => Array.from(s).filter(c => c.charCodeAt(0)>=32 || '\n\t\r'.includes(c)).join('').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
// Reutiliza el paquete nativo existente; sus exportadores y estilos no se alteran.
function sustituirXml(base: Uint8Array, reemplazos: Record<string,string|Uint8Array>): Uint8Array {
  const enc = new TextEncoder(), dec = new TextDecoder(), v = new DataView(base.buffer,base.byteOffset,base.byteLength)
  const archivos: {nombre:Uint8Array;datos:Uint8Array}[] = []
  const incluidos=new Set<string>()
  for (let o=0; v.getUint32(o,true)===0x04034b50;) {
    if (v.getUint16(o+8,true)!==0) throw new Error('Paquete Excel no compatible.')
    const n=v.getUint16(o+26,true), e=v.getUint16(o+28,true), size=v.getUint32(o+18,true), ini=o+30+n+e
    const nombre=base.slice(o+30,o+30+n), ruta=dec.decode(nombre)
    const reemplazo=reemplazos[ruta]
    archivos.push({nombre,datos:reemplazo===undefined?base.slice(ini,ini+size):typeof reemplazo==='string'?enc.encode(reemplazo):reemplazo})
    incluidos.add(ruta);o=ini+size
  }
  for(const [ruta,datos] of Object.entries(reemplazos))if(!incluidos.has(ruta))archivos.push({nombre:enc.encode(ruta),datos:typeof datos==='string'?enc.encode(datos):datos})
  const partes:Uint8Array[]=[], centros:Uint8Array[]=[]; let offset=0
  for (const {nombre,datos} of archivos) {
    let crc=0xffffffff
    for (const b of datos) { crc^=b; for(let j=0;j<8;j++) crc=(crc>>>1)^((crc&1)?0xedb88320:0) }
    crc=(crc^0xffffffff)>>>0
    const h=new Uint8Array(30+nombre.length), a=new DataView(h.buffer)
    a.setUint32(0,0x04034b50,true);a.setUint16(4,20,true);a.setUint16(6,0x0800,true);a.setUint16(12,33,true);a.setUint32(14,crc,true);a.setUint32(18,datos.length,true);a.setUint32(22,datos.length,true);a.setUint16(26,nombre.length,true);h.set(nombre,30)
    const c=new Uint8Array(46+nombre.length), d=new DataView(c.buffer)
    d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x0800,true);d.setUint16(14,33,true);d.setUint32(16,crc,true);d.setUint32(20,datos.length,true);d.setUint32(24,datos.length,true);d.setUint16(28,nombre.length,true);d.setUint32(42,offset,true);c.set(nombre,46)
    partes.push(h,datos);centros.push(c);offset+=h.length+datos.length
  }
  const size=centros.reduce((s,c)=>s+c.length,0), fin=new Uint8Array(22), f=new DataView(fin.buffer)
  f.setUint32(0,0x06054b50,true);f.setUint16(8,archivos.length,true);f.setUint16(10,archivos.length,true);f.setUint32(12,size,true);f.setUint32(16,offset,true)
  const salida=new Uint8Array(offset+size+22);let i=0
  for(const p of [...partes,...centros,fin]){salida.set(p,i);i+=p.length}
  return salida
}
const estilos = `<styleSheet xmlns="${ns}"><fonts count="3"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="14"/><name val="Arial"/></font><font><b/><sz val="9"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF0F2F5"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

export function crearXlsxCalidadDiaria(m: MatrizCalidadDiaria, logo?: Uint8Array): Uint8Array {
  const bloques=bloquesColumnasCalidad(m), reemplazos:Record<string,string|Uint8Array>={'xl/styles.xml':estilos}
  const hojas=bloques.map((b,indice)=>{
    const ultima=columnaExcel(Math.max(1,b.columnas.length)), ancho=Math.max(2,b.columnas.length+1), filas:string[]=[], uniones:string[]=[]
    let fila=0
    const agregar=(valores:(string|number|null)[],estilo=0,alto=26)=>{
      fila++
      filas.push(`<row r="${fila}" ht="${alto}" customHeight="1">${Array.from({length:ancho},(_,c)=>{
        const valor=valores[c]??null, ref=columnaExcel(c)+fila
        if(valor===null)return `<c r="${ref}" s="${estilo}"/>`
        if(typeof valor==='number'){
          if(String(valor).replace(/[eE].*$/,'').replace(/[^0-9]/g,'').replace(/^0+/,'').length>15)
            return `<c r="${ref}" s="${estilo}" t="inlineStr"><is><t>${valor}</t></is></c>`
          return `<c r="${ref}" s="${estilo}"><v>${valor}</v></c>`
        }
        if(valor.length>32767)throw new Error('Un texto supera la capacidad de una celda de Excel.')
        return `<c r="${ref}" s="${estilo}" t="inlineStr"><is><t xml:space="preserve">${xml(valor)}</t></is></c>`
      }).join('')}</row>`)
    }
    const banda=(texto:string,estilo=3)=>{for(const p of fragmentosTextoCalidad(texto)){agregar([p],estilo,Math.max(26,Math.max(p.split('\n').length,Math.ceil(p.length/100))*14+12));uniones.push(`A${fila}:${ultima}${fila}`)}}
    if(logo){
      agregar([null,tituloCalidadFisico],1,40)
      if(ancho>2)uniones.push(`B1:${ultima}1`)
    }else banda('COPAMEX · '+tituloCalidadFisico,1)
    banda(`${m.area==='calderas'?'Calderas':'PTAR'} · Fecha operativa: ${m.fecha.split('-').reverse().join('/')} · ${m.total} muestras`)
    agregar(['Hora de registro',...b.columnas.map(c=>c.punto)],2,32)
    // Agrupa las columnas del mismo punto, igual que el encabezado físico.
    for(let i=0;i<b.columnas.length;){let j=i+1;while(j<b.columnas.length&&b.columnas[j].puntoId===b.columnas[i].puntoId)j++;if(j>i+1)uniones.push(`${columnaExcel(i+1)}3:${columnaExcel(j)}3`);i=j}
    agregar(['',...b.columnas.map(c=>c.parametro+(c.unidad?' ('+c.unidad+')':''))],2,32)
    agregar(['Límites históricos',...b.columnas.map(limiteColumnaCalidad)],2,32)
    for(const t of m.turnos){
      if(!t.filas.length)banda(nombresTurnoCalidad[t.tipo]+': Sin muestras',0)
      for(const f of t.filas)agregar([f.hora,...f.valores.slice(b.inicio,b.inicio+b.columnas.length)])
    }
    for(const t of m.turnos){
      banda('COMENTARIOS · TURNO '+nombresTurnoCalidad[t.tipo].toUpperCase(),2)
      const notas=t.filas.filter(f=>f.notas)
      if(!notas.length)banda(t.filas.length?'Sin comentarios registrados.':'Sin muestras',0)
      for(const f of notas)banda(f.hora+' · '+f.operador+' · '+f.notas,0)
      banda('OPERADORES · TURNO '+nombresTurnoCalidad[t.tipo].toUpperCase(),2)
      if(!t.filas.length)banda('Sin muestras',0)
      for(const operador of operadoresCalidad(t))banda(operador,0)
    }
    banda('F-TA-03 · Celdas vacías: sin resultado registrado para esa columna. Hora de registro, no hora de toma inferida. Más de 15 cifras significativas: texto para conservar precisión.',0)
    reemplazos[`xl/worksheets/sheet${indice+1}.xml`]=`<worksheet xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${ultima}${fila}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="26"/><cols><col min="1" max="1" width="25" customWidth="1"/><col min="2" max="${ancho}" width="16" customWidth="1"/></cols><sheetData>${filas.join('')}</sheetData><mergeCells count="${uniones.length}">${uniones.map(ref=>`<mergeCell ref="${ref}"/>`).join('')}</mergeCells><printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.15" footer="0.15"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>${logo?'<drawing r:id="logo"/>':''}</worksheet>`
    if(logo){
      const rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships', paquete='http://schemas.openxmlformats.org/package/2006/relationships'
      reemplazos[`xl/worksheets/_rels/sheet${indice+1}.xml.rels`]=`<Relationships xmlns="${paquete}"><Relationship Id="logo" Type="${rel}/drawing" Target="../drawings/drawing${indice+1}.xml"/></Relationships>`
      reemplazos[`xl/drawings/_rels/drawing${indice+1}.xml.rels`]=`<Relationships xmlns="${paquete}"><Relationship Id="logo" Type="${rel}/image" Target="../media/copamex.png"/></Relationships>`
      reemplazos[`xl/drawings/drawing${indice+1}.xml`]=`<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${rel}"><xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>47625</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>47625</xdr:rowOff></xdr:from><xdr:ext cx="457200" cy="457200"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="COPAMEX"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="logo"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="457200" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`
    }
    return {nombre:'Calidad '+(indice+1),titulo:'',contexto:'',columnas:['Hora'],filas:[],congelar:false}
  })
  const base=crearXlsxReporte(hojas)
  // Encabezados repetidos al imprimir, sin inmovilizar filas al desplazarse.
  const dec=new TextDecoder(), texto=dec.decode(base)
  const inicio=texto.indexOf('<?xml version="1.0"?><workbook ')
  const fin=texto.indexOf('</workbook>',inicio)
  if(inicio<0||fin<0)throw new Error('No se pudo preparar el libro de Calidad.')
  reemplazos['xl/workbook.xml']=texto.slice(inicio,fin+11).replace('<calcPr',`<definedNames>${hojas.map((h,i)=>`<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${h.nombre}'!$1:$5</definedName>`).join('')}</definedNames><calcPr`)
  if(logo){
    const tiposInicio=texto.indexOf('<Types xmlns='), tiposFin=texto.indexOf('</Types>',tiposInicio)
    if(tiposInicio<0||tiposFin<0)throw new Error('No se pudo incorporar el logo al Excel.')
    reemplazos['[Content_Types].xml']=texto.slice(tiposInicio,tiposFin+8).replace('</Types>',`<Default Extension="png" ContentType="image/png"/>${hojas.map((_,i)=>`<Override PartName="/xl/drawings/drawing${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`).join('')}</Types>`)
    reemplazos['xl/media/copamex.png']=logo
  }
  return sustituirXml(base,reemplazos)
}
