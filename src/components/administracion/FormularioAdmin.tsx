import { RotateCcw, Save } from 'lucide-react'
import './programacionFormularios.css'
import { useAuth } from '../../hooks/useAuth'
import { resolverPapel } from '../../lib/administracion'
import { useState } from 'react'
import { borradorAdmin, validarAdmin } from '../../lib/administracion'
import type { ConfigAdmin, DatosAdmin, FilaAdmin, SolicitudAdmin } from '../../lib/administracion'

interface Props { config: ConfigAdmin; datos: DatosAdmin; original: FilaAdmin | null; bloqueado: boolean; guardar: (valores: SolicitudAdmin['valores']) => Promise<boolean>; cancelar: () => void }
export function FormularioAdmin({ config: c, datos, original, bloqueado, guardar, cancelar }: Props) {
  const { perfil } = useAuth()
  const produccion = c.tabla === 'programa_produccion'
  const calendario = c.tabla === 'eventos_calendario'
  const programacion = produccion || calendario
  const [preparando, setPreparando] = useState(false)
  const [papel, setPapel] = useState(() => String(datos.catalogo_papeles.filas.find(r => r.id === original?.papel_id)?.nombre ?? '').toLocaleUpperCase('es-MX'))
  const [campos, setCampos] = useState(() => borradorAdmin(c, original))
  const [error, setError] = useState<string | null>(null)
  async function enviar() {
    if (bloqueado || preparando) return
    setPreparando(true)
    try {
      let fuente = datos, valoresCampos = campos
      if (c.tabla === 'programa_produccion') {
        // Validar antes de crear una opción de papel; no modifica el programa todavía.
        if (!perfil?.id || typeof campos.maquina_id !== 'string' || !papel.trim()) throw new Error('Selecciona la máquina y escribe el papel.')
        const temporal = { id: crypto.randomUUID(), maquina_id: campos.maquina_id, nombre: papel, activo: true }
        validarAdmin(c, { ...campos, papel_id: temporal.id }, { ...datos, catalogo_papeles: { ...datos.catalogo_papeles, filas: [...datos.catalogo_papeles.filas, temporal] } }, original)
        const opcion = await resolverPapel(perfil.id, campos.maquina_id, papel)
        fuente = { ...datos, catalogo_papeles: { ...datos.catalogo_papeles, filas: [...datos.catalogo_papeles.filas.filter(r => r.id !== opcion.id), opcion] } }
        valoresCampos = { ...campos, papel_id: opcion.id }
      }
      const valores = validarAdmin(c, valoresCampos, fuente, original)
      setError(null); await guardar(valores)
    } catch (e) { setError(e instanceof Error ? e.message : 'Revisa los datos del formulario.') }
    finally { setPreparando(false) }
  }
  function cambiar(clave: string, valor: string | boolean) {
    if (c.tabla === 'programa_produccion' && clave === 'maquina_id') setPapel('')
    setCampos(v => ({ ...v, [clave]: valor, ...(c.tabla === 'programa_produccion' && clave === 'maquina_id' ? { papel_id: '' } : {}) }))
  }
  function limpiar() {
    if (bloqueado || preparando) return
    setCampos(borradorAdmin(c, original))
    setPapel(String(datos.catalogo_papeles.filas.find(r => r.id === original?.papel_id)?.nombre ?? '').toLocaleUpperCase('es-MX'))
    setError(null)
  }
  return <form className={programacion ? `admin-editor co-programacion-formulario ${produccion ? 'co-programacion-produccion' : 'co-programacion-calendario'}` : 'admin-editor'} onSubmit={e => { e.preventDefault(); void enviar() }}>
    <div className="planta-encabezado"><h3>{programacion ? <>{original ? 'Editar ' + c.singular : produccion ? 'Programación de producción diaria' : 'Programación de calendario'}</> : <>{original ? 'Editar' : 'Nuevo'} {c.singular}</>}</h3><button type="button" className="boton-secundario" onClick={cancelar} disabled={bloqueado || preparando}>Cancelar</button></div>
    
    <fieldset disabled={bloqueado || preparando} className="admin-campos">
      {c.campos.map(f => {
        if (c.tabla === 'programa_produccion' && f.clave === 'papel_id') return <label className="co-programacion-campo co-programacion-papel" key={f.clave}>Papel<input type="text" list="opciones-papel-produccion" value={papel} maxLength={200} required onChange={e => setPapel(e.target.value.toLocaleUpperCase('es-MX'))} /><datalist id="opciones-papel-produccion">{datos.catalogo_papeles.filas.filter(r => r.maquina_id === campos.maquina_id && r.activo !== false).map(r => <option key={r.id} value={String(r.nombre).toLocaleUpperCase('es-MX')} />)}</datalist></label>
        const valor = campos[f.clave]
        if ((produccion && f.clave === 'consumo_objetivo') || (calendario && f.clave === 'tipo')) {
          const texto = typeof valor === 'string' ? valor : ''
          const opciones = produccion ? [['ALTO','ALTO'],['NORMAL','NORMAL']] : [['paro_operativo','Paro operativo'],['lavado_quimico','Lavado químico']]
          return <label className="co-programacion-campo" key={f.clave}>{f.nombre}<select value={texto} required={!f.opcional} onChange={e => cambiar(f.clave,e.target.value)}>
            <option value="">{produccion ? 'Selecciona consumo objetivo' : 'Selecciona tipo de evento'}</option>
            {texto && !opciones.some(([v]) => v === texto) && <option value={texto} disabled>Valor anterior: {texto}</option>}
            {opciones.map(([v,n]) => <option value={v} key={v}>{n}</option>)}
          </select></label>
        }
        if (calendario && f.clave === 'motivo') return <label className="co-programacion-campo" key={f.clave}>{f.nombre}<input type="text" value={typeof valor === 'string' ? valor : ''} maxLength={10000} required={!f.opcional} placeholder="Motivo / detalles" onChange={e => cambiar(f.clave,e.target.value)} /></label>
        if (f.tipo === 'booleano') return <label className="admin-casilla" key={f.clave}><input type="checkbox" checked={valor === true} onChange={e => cambiar(f.clave, e.target.checked)} />{f.nombre}</label>
        const texto = typeof valor === 'string' ? valor : ''
        const disabled = c.tabla === 'avisos' && campos.permanente === true && ['inicio', 'fin'].includes(f.clave)
        if (f.tipo === 'opcion' || f.tipo === 'referencia') {
          const opciones = f.tipo === 'opcion' ? f.opciones ?? [] : (f.referencia ? datos[f.referencia].filas : [])
            .filter(r => f.clave !== 'papel_id' || r.maquina_id === campos.maquina_id)
            .filter(r => r.activo !== false || r.id === texto)
            .map(r => [r.id, `${r.codigo ? `${r.codigo} · ` : ''}${r.nombre}${r.activo === false ? ' (inactivo)' : ''}`] as const)
          return <label className={programacion ? "co-programacion-campo" : undefined} key={f.clave}>{f.nombre}<select value={texto} required={!f.opcional} onChange={e => cambiar(f.clave, e.target.value)}><option value="">{f.opcional ? 'Sin asignar (ambas áreas)' : 'Selecciona una opción'}</option>{texto && !opciones.some(([v]) => v === texto) && <option value={texto}>Referencia no disponible: {texto}</option>}{opciones.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>
        }
        return <label className={programacion ? 'co-programacion-campo co-programacion-' + f.clave : f.tipo === 'largo' ? 'admin-campo-amplio' : ''} key={f.clave}>{f.nombre}{f.tipo === 'largo' ? <textarea value={texto} rows={4} maxLength={10000} required={!f.opcional} onChange={e => cambiar(f.clave, e.target.value)} /> : <input type={f.tipo === 'fecha' ? 'date' : f.tipo === 'instante' ? 'datetime-local' : f.tipo === 'entero' ? 'number' : 'text'} step={f.tipo === 'instante' ? 1 : f.tipo === 'entero' ? 1 : undefined} placeholder={calendario && f.clave === 'horario' ? 'Ej. 08:00 – 14:00' : undefined} maxLength={1000} disabled={disabled} value={texto} required={!f.opcional && !disabled} onChange={e => cambiar(f.clave, e.target.value)} />}</label>
      })}
    </fieldset>
    {error && <p className="mensaje-error" role="alert">{error}</p>}
    {programacion ? <div className="co-programacion-acciones"><button type="button" className="boton-secundario" disabled={bloqueado || preparando} onClick={limpiar}><RotateCcw aria-hidden="true" />{original ? 'Restablecer' : 'Limpiar'}</button><button type="submit" className="boton-principal" disabled={bloqueado || preparando}><Save aria-hidden="true" />{bloqueado || preparando ? 'Esperando confirmación…' : original ? 'Guardar cambios' : calendario ? 'Agregar evento' : 'Guardar programación'}</button></div> : <button type="submit" className="boton-principal" disabled={bloqueado || preparando}>{bloqueado || preparando ? 'Esperando confirmación…' : 'Guardar'}</button>}
  </form>
}
