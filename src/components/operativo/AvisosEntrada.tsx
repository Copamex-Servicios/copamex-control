import { useEffect, useId, useRef, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import { Icono } from '../diseno/Icono'
import './avisosEntrada.css'

interface Aviso { id: string; mensaje: string }
let sesionVista = ''
const vistos = new Set<string>()
const claveAviso = (a: Aviso) => JSON.stringify([a.id,a.mensaje])
function identificarSesion(token: string | undefined, ultimoAcceso: string | undefined) {
  try {
    const parte = token?.split('.')[1]
    if (parte) {
      const normalizada = parte.replace(/-/g, '+').replace(/_/g, '/')
      const datos: unknown = JSON.parse(atob(normalizada.padEnd(Math.ceil(normalizada.length / 4) * 4, '=')))
      if (datos && typeof datos === 'object' && 'session_id' in datos && typeof datos.session_id === 'string') return datos.session_id
    }
  } catch { /* Usar la fecha de inicio si el token no contiene identificador. */ }
  return ultimoAcceso ?? 'sesion-activa'
}
function recuperarVistos(clave: string) {
  try {
    const datos: unknown = JSON.parse(sessionStorage.getItem('copamex:avisos-vistos:' + clave) ?? '[]')
    if (Array.isArray(datos)) datos.forEach(dato => { if (typeof dato === 'string') vistos.add(dato) })
  } catch { /* La memoria mantiene el control si el almacenamiento no está disponible. */ }
}
function guardarVistos(clave: string) {
  try { sessionStorage.setItem('copamex:avisos-vistos:' + clave, JSON.stringify([...vistos])) } catch { /* Mantener los vistos en memoria. */ }
}

export function AvisosEntrada() {
  const { perfil, sesion, estado } = useAuth()
  const cuenta = estado === 'autenticado' && perfil?.activo && perfil.id === sesion?.user.id ? perfil.id : null
  const clave = cuenta ? cuenta + ':' + identificarSesion(sesion?.access_token, sesion?.user.last_sign_in_at) : null
  const [vista, setVista] = useState<{ clave: string; avisos: Aviso[]; error: boolean } | null>(null)
  const [revision, setRevision] = useState(0)
  const [abierto, setAbierto] = useState(false)
  const dialogo = useRef<HTMLDialogElement>(null)
  const titulo = useId()
  const avisos = vista?.clave === clave ? vista.avisos : []
  const hayAvisos = avisos.length > 0
  useEffect(() => {
    if (!clave) return
    if (sesionVista !== clave) { sesionVista=clave; vistos.clear(); recuperarVistos(clave) }
    let vigente=true, consultando=false
    const controller = new AbortController()
    async function cargar() {
      if (!vigente || consultando || document.visibilityState === 'hidden') return
      consultando=true
      try {
        const { data, error } = await supabase.from('avisos').select('id,mensaje')
          .or('permanente.eq.true,and(or(inicio.is.null,inicio.lte.now),or(fin.is.null,fin.gt.now))')
          .order('creado_en',{ascending:false}).limit(20).abortSignal(controller.signal)
        if (!vigente) return
        if (error || !Array.isArray(data) || data.some(a => typeof a.id !== 'string' || typeof a.mensaje !== 'string')) throw new Error('Consulta inválida')
        setVista({ clave: clave!, avisos:data, error:false })
        if (data.some(a => !vistos.has(claveAviso(a)))) setAbierto(true)
        if (!data.length) setAbierto(false)
      } catch { if (vigente) setVista(v => ({ clave:clave!, avisos:v?.clave === clave ? v.avisos : [], error:true })) }
      finally { consultando=false }
    }
    void cargar()
    const alVolver = () => { void cargar() }
    const intervalo=window.setInterval(alVolver,30000)
    window.addEventListener('focus',alVolver)
    window.addEventListener('online',alVolver)
    window.addEventListener('copamex:avisos-actualizados',alVolver)
    document.addEventListener('visibilitychange',alVolver)
    return () => { vigente=false; controller.abort(); window.clearInterval(intervalo); window.removeEventListener('focus',alVolver); window.removeEventListener('online',alVolver); window.removeEventListener('copamex:avisos-actualizados',alVolver); document.removeEventListener('visibilitychange',alVolver) }
  }, [clave,revision])
  useEffect(() => {
    const elemento=dialogo.current
    if (!elemento) return
    if (abierto && hayAvisos && !elemento.open) elemento.showModal()
    else if ((!abierto || !hayAvisos) && elemento.open) elemento.close()
    return () => { if (elemento.open) elemento.close() }
  }, [abierto,hayAvisos])
  function cerrar() { avisos.forEach(a => vistos.add(claveAviso(a))); if (clave) guardarVistos(clave); setAbierto(false) }
  if (!cuenta) return null
  return <>
    {avisos.length > 0 && <section className="co-aviso-barra" aria-label="Avisos importantes vigentes">
      <span className="co-aviso-etiqueta">Avisos importantes{avisos.length > 1 ? ` (${avisos.length})` : ''}</span>
      <CarruselAvisos key={JSON.stringify(avisos)} avisos={avisos} />
      <button type="button" onClick={() => setAbierto(true)}>Ver aviso{avisos.length > 1 ? 's' : ''}</button>
    </section>}
    {vista?.clave === clave && vista.error && <div className="co-aviso-error" role="status">No se pudieron actualizar los avisos. <button type="button" onClick={() => setRevision(v => v+1)}>Reintentar</button></div>}
    <dialog ref={dialogo} className="co-aviso-dialogo" role="alertdialog" aria-labelledby={titulo} aria-describedby={titulo+'-contenido'} onCancel={e => e.preventDefault()}>
      <header><div><span className="co-aviso-modal-etiqueta">Avisos importantes</span><h2 id={titulo}>Aviso urgente</h2></div><button type="button" className="co-aviso-cerrar" aria-label="Cerrar aviso urgente" onClick={cerrar}><Icono nombre="cerrar" /></button></header>
      <div id={titulo+'-contenido'} className="co-aviso-mensajes">{avisos.map(a => <p key={a.id}>{a.mensaje}</p>)}</div>
    </dialog>
  </>
}

function CarruselAvisos({ avisos }: { avisos: Aviso[] }) {
  const [indice, setIndice] = useState(0)
  const [desplazando, setDesplazando] = useState(false)
  const cantidad = avisos.length
  useEffect(() => {
    if (cantidad < 2) return
    let espera = 0, movimiento = 0
    function programar() {
      espera = window.setTimeout(() => {
        if (document.visibilityState === 'hidden') { programar(); return }
        setDesplazando(true)
        movimiento = window.setTimeout(() => {
          setIndice(actual => (actual + 1) % cantidad)
          setDesplazando(false)
          programar()
        }, 450)
      }, 8000)
    }
    programar()
    return () => { window.clearTimeout(espera); window.clearTimeout(movimiento) }
  }, [cantidad])
  const actual = avisos[indice % cantidad]
  const siguiente = avisos[(indice + 1) % cantidad]
  return <div className="co-aviso-carrusel" aria-live="off">
    <div className="co-aviso-ventana">
      <div className={`co-aviso-pista${desplazando ? ' co-aviso-pista-moviendo' : ''}`}>
        <span className="co-aviso-item" title={actual.mensaje}>{actual.mensaje}</span>
        {cantidad > 1 && <span className="co-aviso-item" aria-hidden="true">{siguiente.mensaje}</span>}
      </div>
    </div>
    {cantidad > 1 && <span className="co-aviso-posicion" aria-label={`Aviso ${indice + 1} de ${cantidad}`}>{indice + 1}/{cantidad}</span>}
  </div>
}
