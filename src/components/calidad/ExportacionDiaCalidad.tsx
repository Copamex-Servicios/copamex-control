import { useEffect, useId, useRef, useState } from 'react'
import { exigirExportacionCalidad, prepararArchivoDiaCalidad, descargarDiaCalidad } from '../../lib/exportarDiaCalidad'
import { opcionDiaCompletoCalidad } from '../../lib/reporteDiarioCalidad'
import type { AreaOperativa } from '../../lib/tiposTurno'

export function ExportacionDiaCalidad({fechaInicial='',areaInicial='calderas'}:{fechaInicial?:string;areaInicial?:AreaOperativa}){
  const id=useId(), control=useRef<AbortController|null>(null)
  const campoFecha=useRef<HTMLInputElement>(null)
  const [fecha,setFecha]=useState(fechaInicial),[area,setArea]=useState(areaInicial)
  const [ocupado,setOcupado]=useState<'pdf'|'excel'|null>(null),[error,setError]=useState<string|null>(null)
  useEffect(()=>()=>{control.current?.abort();control.current=null},[])
  async function exportar(tipo:'pdf'|'excel'){
    if(control.current)return
    if(!fecha){
      setError('Selecciona la fecha operativa del día que quieres descargar.')
      campoFecha.current?.focus()
      return
    }
    const c=new AbortController();control.current=c;setOcupado(tipo);setError(null)
    const limite=window.setTimeout(()=>c.abort(),120000)
    try{
      const cuenta=exigirExportacionCalidad()
      const archivo=await prepararArchivoDiaCalidad({alcance:'dia-completo',fechaOperativa:fecha,area},tipo,c.signal)
      if(c.signal.aborted)return
      if(exigirExportacionCalidad()!==cuenta)throw new Error('La cuenta cambió.')
      descargarDiaCalidad(archivo)
    }catch(e){
      if(control.current===c)setError(c.signal.aborted?'La exportación tardó demasiado. Reintenta.':e instanceof Error?e.message:'No se pudo exportar el día completo.')
    }finally{
      window.clearTimeout(limite)
      if(control.current===c){control.current=null;setOcupado(null)}
    }
  }
  return <section className="cmc-exportacion" aria-labelledby={id}>
    <h4 id={id}>{opcionDiaCompletoCalidad.etiqueta}</h4>
    <div className="cmc-filtros">
      <label>Fecha operativa<input ref={campoFecha} type="date" value={fecha} disabled={!!ocupado} aria-invalid={!fecha&&!!error} onChange={e=>{setFecha(e.target.value);setError(null)}}/></label>
      <label>Área del archivo<select value={area} disabled={!!ocupado} onChange={e=>setArea(e.target.value as AreaOperativa)}><option value="calderas">Calderas</option><option value="ptar">PTAR</option></select></label>
      <button type="button" className="boton-secundario cmc-pdf" disabled={!!ocupado} onClick={()=>{void exportar('pdf')}}>PDF</button>
      <button type="button" className="boton-secundario cmc-excel" disabled={!!ocupado} onClick={()=>{void exportar('excel')}}>Excel</button>
    </div>
    {!fecha&&!error&&<p className="cmc-ayuda">Selecciona la fecha operativa para descargar.</p>}
    {ocupado&&<p role="status">Preparando {ocupado==='pdf'?'PDF':'Excel'} del día completo…</p>}
    {error&&<p role="alert" className="mensaje-error">{error}</p>}
  </section>
}
