import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import type { RowInput } from 'jspdf-autotable'
import { bloquesColumnasCalidad, limiteColumnaCalidad, nombresTurnoCalidad, operadoresCalidad, tituloCalidadFisico } from './matrizCalidadDiaria'
import type { MatrizCalidadDiaria } from './matrizCalidadDiaria'
import { formatearNumeroCalidad } from './formatoCalidad'

export function crearPdfCalidadDiaria(m: MatrizCalidadDiaria, fuente: string, logo?: Uint8Array): jsPDF {
  const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4',compress:true,putOnlyUsedFonts:true})
  doc.addFileToVFS('DejaVuSans.ttf',fuente);doc.addFont('DejaVuSans.ttf','DejaVuSans','normal');doc.setFont('DejaVuSans','normal')
  doc.setProperties({title:tituloCalidadFisico+' · '+m.area+' · '+m.fecha,author:'COPAMEX'})
  const bloques=bloquesColumnasCalidad(m)
  const encabezado=()=>{
    doc.setFont('DejaVuSans','normal');doc.setTextColor(0);doc.setFontSize(11)
    doc.setDrawColor(0);doc.setLineWidth(0.2)
    doc.rect(10,8,277,14)
    if(logo)doc.addImage(logo,'PNG',13,9,12,12,'copamex')
    else doc.text('COPAMEX',13,16)
    doc.setFont('helvetica','bold')
    doc.text(tituloCalidadFisico,148.5,17,{align:'center'})
    doc.setFont('DejaVuSans','normal')
    doc.setFontSize(8)
    doc.text(`${m.area==='calderas'?'Calderas':'PTAR'} · Fecha operativa: ${m.fecha.split('-').reverse().join('/')}`,10,27)
  }
  const opciones={theme:'grid' as const,margin:{left:10,right:10,top:32,bottom:14},showHead:'everyPage' as const,rowPageBreak:'avoid' as const,
    styles:{font:'DejaVuSans',fontStyle:'normal' as const,fontSize:7.5,cellPadding:1.8,lineWidth:0.15,lineColor:[60,60,60] as [number,number,number],textColor:0,overflow:'linebreak' as const,valign:'middle' as const},
    headStyles:{fillColor:[240,242,245] as [number,number,number],textColor:0,fontStyle:'normal' as const},willDrawPage:encabezado}
  let y=32
  for(const [indice,b] of bloques.entries()){
    if(indice){doc.addPage();y=32}
    const n=Math.max(2,b.columnas.length+1), puntos:RowInput=[]
    puntos.push({content:'Hora de registro',rowSpan:3})
    for(let i=0;i<b.columnas.length;){
      let j=i+1;while(j<b.columnas.length&&b.columnas[j].puntoId===b.columnas[i].puntoId)j++
      puntos.push({content:b.columnas[i].punto,colSpan:j-i});i=j
    }
    if(!b.columnas.length)puntos.push({content:'Sin resultados',rowSpan:3})
    const head:RowInput[]=[puntos,...(b.columnas.length?[
      b.columnas.map(c=>c.parametro+(c.unidad?' ('+c.unidad+')':'')),b.columnas.map(limiteColumnaCalidad),
    ]:[])]
    const body:RowInput[]=[]
    for(const t of m.turnos){
      if(!t.filas.length)body.push([{content:nombresTurnoCalidad[t.tipo]+': Sin muestras',colSpan:n}])
      for(const f of t.filas)body.push([f.hora,...(b.columnas.length?f.valores.slice(b.inicio,b.inicio+b.columnas.length).map(v=>v===null?'':formatearNumeroCalidad(v)):[''])])
    }
    autoTable(doc,{...opciones,startY:y,head,body,columnStyles:{0:{cellWidth:37}}})
    y=(doc as jsPDF & {lastAutoTable:{finalY:number}}).lastAutoTable.finalY+5
  }
  const notas:RowInput[]=[]
  const texto=(s:string)=>{ // Divide narrativas extensas sin omitir ningún carácter.
    const caracteres=Array.from(s)
    for(let i=0;i<caracteres.length;i+=600)notas.push([caracteres.slice(i,i+600).join('')])
  }
  for(const t of m.turnos){
    const comentadas=t.filas.filter(f=>f.notas)
    const turno=nombresTurnoCalidad[t.tipo]+': '
    if(!comentadas.length)texto(turno+(t.filas.length?'Sin comentarios registrados.':'Sin muestras'))
    for(const f of comentadas)texto(turno+f.hora+' · '+f.operador+' · '+f.notas)
  }
  if(y>175){doc.addPage();y=32}
  autoTable(doc,{...opciones,startY:y,head:[['COMENTARIOS POR TURNO']],body:notas})
  y=(doc as jsPDF & {lastAutoTable:{finalY:number}}).lastAutoTable.finalY+4
  if(y>175){doc.addPage();y=32}
  const porTurno=m.turnos.map(t=>operadoresCalidad(t))
  const operadores:RowInput[]=Array.from({length:Math.max(1,...porTurno.map(t=>t.length))},(_,i)=>porTurno.map(t=>t[i]??(i===0?'Sin muestras':'')))
  autoTable(doc,{...opciones,startY:y,head:[m.turnos.map(t=>'OPERADORES · TURNO '+nombresTurnoCalidad[t.tipo].toUpperCase())],body:operadores})
  const paginas=doc.getNumberOfPages()
  for(let p=1;p<=paginas;p++){doc.setPage(p);doc.setFontSize(7);doc.setTextColor(60);doc.text('F-TA-03 · Calidad de agua',10,203);doc.text(`Página ${p} de ${paginas}`,287,203,{align:'right'})}
  return doc
}
