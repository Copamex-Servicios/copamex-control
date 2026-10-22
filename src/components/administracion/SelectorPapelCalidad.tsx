import { useEffect, useId, useRef, useState } from 'react'
import { consultarPapelesCalidad, guardarPapelCalidad } from '../../lib/catalogoPapelesCalidad'
import type { FilaAdmin } from '../../lib/administracion'

interface Props {
  cuenta: string; maquina: string; seleccionado: string; iniciales: FilaAdmin[]
  seleccionar: (id: string) => void; actualizar: (filas: FilaAdmin[]) => void
  editar: (abierto: boolean) => void; ocupar: (ocupado: boolean) => void
}
const agregar = '__agregar_papel__'

export function SelectorPapelCalidad({ cuenta, maquina, seleccionado, iniciales, seleccionar, actualizar, editar, ocupar }: Props) {
  const id = useId()
  const [catalogo, setCatalogo] = useState(iniciales)
  const [maquinaEdicion, setMaquinaEdicion] = useState<string | null>(null)
  const [nombre, setNombre] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorConsulta, setErrorConsulta] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<{ maquina: string; texto: string } | null>(null)
  const activo = useRef(false)
  const confirmados = useRef<FilaAdmin[]>([])
  const abierto = maquinaEdicion !== null && maquinaEdicion === maquina
  useEffect(() => {
    const controller = new AbortController()
    let consultando = false
    async function cargar() {
      if (consultando || controller.signal.aborted) return
      consultando = true
      try {
        const respuesta = await consultarPapelesCalidad(cuenta, controller.signal)
        const filas = [...respuesta, ...confirmados.current.filter(p => !respuesta.some(r => r.id === p.id))]
        setCatalogo(filas); actualizar(filas); setErrorConsulta(null)
      } catch (e) {
        if (!controller.signal.aborted) setErrorConsulta(e instanceof Error ? e.message : 'No se pudo actualizar el catálogo de papeles.')
      } finally { consultando = false }
    }
    const recargar = () => { void cargar() }
    void cargar(); window.addEventListener('focus', recargar)
    return () => { controller.abort(); window.removeEventListener('focus', recargar) }
  }, [cuenta, actualizar])
  async function guardar() {
    if (activo.current) return
    activo.current = true; setGuardando(true); ocupar(true); setError(null); setMensaje(null)
    try {
      const resultado = await guardarPapelCalidad(cuenta, maquina, nombre, catalogo)
      confirmados.current = [...confirmados.current.filter(p => p.id !== resultado.papel.id), resultado.papel]
      const filas = [...catalogo.filter(p => p.id !== resultado.papel.id), resultado.papel]
      setCatalogo(filas); actualizar(filas); seleccionar(resultado.papel.id)
      setMaquinaEdicion(null); editar(false); setNombre('')
      setMensaje({ maquina, texto:resultado.existente ? 'El papel ya existe y quedó seleccionado.' : 'Papel confirmado y seleccionado.' })
    } catch (e) { setError(e instanceof Error ? e.message : 'No se confirmó el guardado del papel. Reintenta con el mismo nombre.') }
    finally { activo.current = false; setGuardando(false); ocupar(false) }
  }
  return <div className="co-programacion-papel">
    <label className="co-programacion-campo" htmlFor={id}>Papel</label>
    <select id={id} value={abierto ? agregar : seleccionado} required disabled={!maquina || guardando} onChange={e => {
      setError(null); setMensaje(null)
      if (e.target.value === agregar) { setNombre(''); setMaquinaEdicion(maquina); editar(true) }
      else { setMaquinaEdicion(null); editar(false); seleccionar(e.target.value) }
    }}>
      <option value="">Selecciona un papel</option>
      {seleccionado && !catalogo.some(p => p.id === seleccionado && p.maquina_id === maquina) && <option value={seleccionado}>Papel seleccionado no disponible en el catálogo</option>}
      {catalogo.filter(p => p.maquina_id === maquina && (p.activo === true || p.id === seleccionado))
        .sort((a,b) => String(a.nombre).localeCompare(String(b.nombre), 'es-MX'))
        .map(p => <option value={p.id} key={p.id}>{String(p.nombre)}{p.activo !== true ? ' (inactivo)' : ''}</option>)}
      <option value={agregar}>+ AGREGAR OTRO...</option>
    </select>
    {abierto && <div className="co-programacion-papel-alta">
      <label htmlFor={`${id}-nombre`}>Nombre del papel</label>
      <input id={`${id}-nombre`} value={nombre} maxLength={200} autoFocus aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}
        onChange={e => { setNombre(e.target.value.toLocaleUpperCase('es-MX')); setError(null) }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void guardar() } }} />
      <div className="co-programacion-papel-acciones">
        <button type="button" className="boton-principal" disabled={guardando} onClick={() => { void guardar() }}>{guardando ? 'Guardando…' : 'Guardar'}</button>
        <button type="button" className="boton-secundario" disabled={guardando} onClick={() => { setMaquinaEdicion(null); editar(false); setNombre(''); setError(null) }}>Cancelar</button>
      </div>
      {error && <p id={`${id}-error`} className="mensaje-error" role="alert">{error}</p>}
    </div>}
    {mensaje?.maquina === maquina && !abierto && <p className="mensaje-exito" role="status">{mensaje.texto}</p>}
    {errorConsulta && <p className="mensaje-error" role="alert">{errorConsulta}</p>}
  </div>
}
