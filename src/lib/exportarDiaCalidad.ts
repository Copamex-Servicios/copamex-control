import { useAuthStore } from '../stores/authStore'
import { consultarDiaCompletoCalidad } from './reporteDiarioCalidad'
import type { SolicitudDiaCompletoCalidad } from './reporteDiarioCalidad'
import { matrizCalidadDiaria } from './matrizCalidadDiaria'
import { descargarArchivo } from './exportarTecnicoDiario'

export function exigirExportacionCalidad(): string {
  const {estado,perfil,sesion}=useAuthStore.getState()
  if(estado!=='autenticado'||!perfil?.activo||perfil.id!==sesion?.user.id||!['calidad','admin'].includes(perfil.rol))throw new Error('La exportación de Calidad está disponible en Calidad y Administración.')
  return JSON.stringify([perfil.id,perfil.rol])
}
let fuente:Promise<string>|null=null
let logo:Promise<Uint8Array>|null=null
async function logoCalidad(){
  logo??=fetch(new URL('../assets/cpx-logo-barra.png',import.meta.url)).then(async r=>{
    if(!r.ok)throw new Error('No se pudo cargar el logo del reporte. Reintenta.')
    return new Uint8Array(await r.arrayBuffer())
  }).catch(e=>{logo=null;throw e})
  return logo
}
async function fuenteCalidad(){
  fuente??=fetch(new URL('../assets/fuentes/DejaVuSans.ttf',import.meta.url)).then(async r=>{
    if(!r.ok)throw new Error('No se pudo cargar la fuente del PDF. Reintenta.')
    const bytes=new Uint8Array(await r.arrayBuffer());let s=''
    for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000))
    return btoa(s)
  }).catch(e=>{fuente=null;throw e})
  return fuente
}
// Restricción de la aplicación acordada con el usuario. No modifica los permisos de consulta del backend.
export async function prepararArchivoDiaCalidad(s:SolicitudDiaCompletoCalidad,tipo:'pdf'|'excel',signal:AbortSignal):Promise<{blob:Blob;nombre:string}>{
  const cuenta=exigirExportacionCalidad(), solicitud={...s}
  const comprobar=()=>{signal.throwIfAborted();if(exigirExportacionCalidad()!==cuenta)throw new Error('La cuenta cambió. Consulta nuevamente antes de exportar.')}
  comprobar()
  const dia=await consultarDiaCompletoCalidad(solicitud,signal)
  comprobar()
  const matriz=matrizCalidadDiaria(dia), nombre=`COPAMEX_Calidad_${solicitud.area}_${solicitud.fechaOperativa}.${tipo==='pdf'?'pdf':'xlsx'}`
  const imagen=await logoCalidad()
  comprobar()
  let blob:Blob
  if(tipo==='pdf'){
    const [{crearPdfCalidadDiaria},font]=await Promise.all([import('./pdfCalidadDiaria'),fuenteCalidad()])
    comprobar();blob=crearPdfCalidadDiaria(matriz,font,imagen).output('blob')
  }else{
    const {crearXlsxCalidadDiaria}=await import('./xlsxCalidadDiaria');comprobar()
    const bytes=crearXlsxCalidadDiaria(matriz,imagen), buffer=new ArrayBuffer(bytes.byteLength);new Uint8Array(buffer).set(bytes)
    blob=new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
  }
  comprobar();return {blob,nombre}
}
export function descargarDiaCalidad(archivo:{blob:Blob;nombre:string}):void{
  exigirExportacionCalidad();descargarArchivo(archivo.blob,archivo.nombre)
}
