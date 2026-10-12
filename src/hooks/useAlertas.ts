import { useEffect, useRef, useState } from 'react'
import { useAuth } from './useAuth'
import { consultarAlertas } from '../lib/alertas'
import type { Alerta, FiltrosAlertas } from '../lib/alertas'
export function useAlertas(filtros: FiltrosAlertas) {
  const { estado, perfil, sesion } = useAuth()
  const cuenta = estado==='autenticado' && perfil?.activo===true && perfil.id===sesion?.user.id && ['admin','calderas','ptar'].includes(perfil.rol) ? perfil.id:null
  const clave = cuenta ? `${cuenta}:${perfil?.rol}:${filtros.area}:${filtros.estado}`:null
  const [vista,setVista] = useState<{clave:string|null; filas:Alerta[]; limitada:boolean; cargando:boolean; error:string|null}>({clave:null,filas:[],limitada:false,cargando:false,error:null})
  const actualizarRef = useRef<()=>void>(()=>{})
  useEffect(()=>{
    if(!cuenta || !clave)return
    const controller=new AbortController();let vivo=true,leyendo=false,repetir=false
    async function cargar(){
      if(!vivo)return
      if(leyendo){repetir=true;return}
      leyendo=true
      setVista(v=>({...v,clave,filas:v.clave===clave?v.filas:[],cargando:true,error:null}))
      try{const r=await consultarAlertas(cuenta!,{area:filtros.area,estado:filtros.estado},controller.signal);if(vivo)setVista({...r,clave,cargando:false,error:null})}
      catch(e){if(vivo)setVista({clave,filas:[],limitada:false,cargando:false,error:e instanceof Error?e.message:'No se pudieron consultar las alertas.'})}
      finally{leyendo=false;if(vivo && repetir){repetir=false;void cargar()}}
    }
    const actualizar=()=>{void cargar()};actualizarRef.current=actualizar;actualizar()
    const intervalo=window.setInterval(()=>{if(document.visibilityState==='visible')actualizar()},30000)
    window.addEventListener('focus',actualizar);window.addEventListener('online',actualizar)
    return ()=>{vivo=false;controller.abort();window.clearInterval(intervalo);window.removeEventListener('focus',actualizar);window.removeEventListener('online',actualizar);actualizarRef.current=()=>{}}
  },[cuenta,clave,filtros.area,filtros.estado])
  const actual=clave && vista.clave===clave?vista:{filas:[],limitada:false,cargando:!!clave,error:null}
  return {...actual,cuenta,admin:perfil?.rol==='admin',actualizar:()=>actualizarRef.current()}
}
