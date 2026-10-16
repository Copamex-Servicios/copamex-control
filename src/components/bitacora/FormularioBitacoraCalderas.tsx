import { GuardadoReporteTecnico } from './GuardadoReporteTecnico'
import { useId, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { equiposCalderas, pilasCalderas, equiposAguaCalderas } from '../../lib/tiposBitacoraCalderas'
import type { CampoCalderas, EstadoCalderas, EstadoCompresor, EstadoUFBitacora } from '../../lib/tiposBitacoraCalderas'
import type { useReporteCalderas } from '../../hooks/useReporteCalderas'

const pestanas = [
  { nombre: 'Calderas', titulo: 'Calderas y bombas' },
  { nombre: 'Condensado', titulo: 'Condensado y ósmosis' },
  { nombre: 'Ultrafiltración', titulo: 'Ultrafiltración' },
  { nombre: 'Compresores', titulo: 'Compresores' },
  { nombre: 'Pilas', titulo: 'Pilas de suministro' },
  { nombre: 'Agua y pozos', titulo: 'Agua potable y pozos' },
  { nombre: 'Historial', titulo: 'Historial de Bitácora' },
]
function Apartado({ indice, activo, prefijo, children }: { indice: number; activo: number; prefijo: string; children: ReactNode }) {
  return <div className="bc-seccion" role="tabpanel" id={`${prefijo}-panel-${indice}`}
    aria-labelledby={`${prefijo}-tab-${indice}`} hidden={activo !== indice} tabIndex={0}>
    <div className="bc-contenido"><h3 className="bc-titulo-seccion">{pestanas[indice].titulo}</h3>{children}</div></div>
}
export function FormularioBitacoraCalderas({ captura, observaciones }: { captura: ReturnType<typeof useReporteCalderas>; observaciones: ReactNode }) {
  const prefijo = useId()
  const [activo, setActivo] = useState(0)
  const { borrador, cambiarBorrador: setBorrador, editable: habilitado } = captura
  const ayudaGuardado = captura.guardando ? 'Esperando confirmación del servidor…' : captura.reporte ? null
    : captura.estado === 'cargando' ? 'Consultando el reporte técnico del turno…'
    : captura.pendiente ? 'El reintento comprueba el envío original; las ediciones posteriores no sustituyen sus datos.' : null
  function navegar(evento: KeyboardEvent<HTMLButtonElement>, indice: number) {
    let siguiente: number
    if (evento.key === 'ArrowRight') siguiente = (indice + 1) % pestanas.length
    else if (evento.key === 'ArrowLeft') siguiente = (indice - 1 + pestanas.length) % pestanas.length
    else if (evento.key === 'Home') siguiente = 0
    else if (evento.key === 'End') siguiente = pestanas.length - 1
    else return
    evento.preventDefault()
    setActivo(siguiente)
    evento.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[siguiente]?.focus()
  }
  function medir(campo: CampoCalderas, valor: string) {
    setBorrador(b => ({ ...b, mediciones: { ...b.mediciones, [campo]: valor } }))
  }
  function medicion(campo: CampoCalderas, nombre: string, unidad: string) {
    return <label className="bc-campo" htmlFor={`${prefijo}-${campo}`}><span>{nombre} <small>({unidad})</small></span>
      <input id={`${prefijo}-${campo}`} type="number" step="any" inputMode="decimal" value={borrador.mediciones[campo]}
        disabled={!habilitado} onChange={e => medir(campo, e.target.value)} /></label>
  }
  return <div className="bc-formulario">
    <div className="bc-tabs" role="tablist" aria-label="Secciones de Bitácora de Calderas">
      {pestanas.map((pestana, indice) => <button key={pestana.titulo} type="button" role="tab"
        id={`${prefijo}-tab-${indice}`} aria-controls={`${prefijo}-panel-${indice}`}
        aria-selected={activo === indice} tabIndex={activo === indice ? 0 : -1}
        onClick={() => setActivo(indice)} onKeyDown={e => navegar(e, indice)}>
        <span>{pestana.nombre}</span>
      </button>)}
    </div>
    <Apartado indice={0} activo={activo} prefijo={prefijo}>
      <p className="bc-ayuda" id={`${prefijo}-unidades`}>{captura.reporte?.versionFormato === 1
        ? 'Reporte del formato anterior: Sulzer y condensado se registraron en PSI. Los valores no se convierten.'
        : 'Las Calderas solo registran estado. Sulzer y condensado: presión en kg/cm².'}</p>
      <div className="bc-grupos-equipos">
      {[{ nombre: 'Calderas', equipos: equiposCalderas.slice(0, 4) }, { nombre: 'Bombas Sulzer', equipos: equiposCalderas.slice(4) }].map(grupo =>
        <fieldset disabled={!habilitado} className="bc-equipos" key={grupo.nombre}><legend>{grupo.nombre}</legend>
        <div className={`bc-equipo bc-equipo-encabezado${grupo.nombre === 'Calderas' ? ' bc-solo-estado' : ''}`} aria-hidden="true"><span>Equipo</span><span>Estado</span>{grupo.nombre !== 'Calderas' && <span>Presión ({captura.unidadPresion})</span>}</div>
        {grupo.equipos.map(equipo => <div className={`bc-equipo${equipo.id.startsWith('caldera_') ? ' bc-solo-estado' : ''}`} role="group" aria-label={equipo.nombre} key={equipo.id}>
          <h3>{equipo.nombre}</h3>
          <label className="bc-campo" htmlFor={`${prefijo}-${equipo.id}-estado`}><span className="bc-sr">Estado</span>
            <select aria-label={`Estado de ${equipo.nombre}`} id={`${prefijo}-${equipo.id}-estado`} value={borrador.equipos[equipo.id].estado}
              onChange={e => setBorrador(b => ({ ...b, equipos: { ...b.equipos, [equipo.id]: { ...b.equipos[equipo.id], estado: e.target.value as EstadoCalderas } } }))}>
              <option value="">Selecciona</option>{['Servicio', 'Reserva', 'Mantenimiento'].map(v => <option key={v}>{v}</option>)}
            </select></label>
          {equipo.id.startsWith('sulzer_') && <label className="bc-campo" htmlFor={`${prefijo}-${equipo.id}-presion`}><span className="bc-sr">Presión <small>{borrador.equipos[equipo.id].estado === 'Servicio' ? 'en Servicio' : '(opcional)'}</small></span>
            <input aria-label={`Presión de ${equipo.nombre}, ${captura.unidadPresion}`} id={`${prefijo}-${equipo.id}-presion`} type="number" step="any" inputMode="decimal" aria-describedby={`${prefijo}-unidades`}
              disabled={!habilitado} placeholder={captura.unidadPresion}
              value={borrador.equipos[equipo.id].presion} onChange={e => setBorrador(b => ({ ...b, equipos: { ...b.equipos, [equipo.id]: { ...b.equipos[equipo.id], presion: e.target.value } } }))} />
          </label>}
        </div>)}
      </fieldset>)}
      </div>
    </Apartado>
    <Apartado indice={1} activo={activo} prefijo={prefijo}><div className="bc-mediciones">
      {medicion('nivel_condensado', 'Nivel del tanque de condensado', '%')}
      {medicion('presion_432', 'Bomba de condensado 432 · Presión', captura.unidadPresion)}
      {medicion('presion_433', 'Bomba de condensado 433 · Presión', captura.unidadPresion)}
      {medicion('presion_422', 'Bomba de ósmosis 422 · Presión', 'PSI')}
      {medicion('presion_424', 'Bomba de ósmosis 424 · Presión', 'PSI')}
      {medicion('flujo_osmosis', 'Flujo de ósmosis', 'GPM')}
    </div></Apartado>
    <Apartado indice={2} activo={activo} prefijo={prefijo}><div className="bc-mediciones">
      {medicion('flujo_uf', 'Flujo de entrada', 'm³/h')}{medicion('nivel_rotoplas', 'Nivel del Rotoplas de entrada', '%')}
      <label className="bc-campo" htmlFor={`${prefijo}-uf-estado`}><span>Estado de la UF</span>
        <select aria-label="Estado de la UF" id={`${prefijo}-uf-estado`} disabled={!habilitado} value={borrador.estadoUF}
          onChange={e => setBorrador(b => ({ ...b, estadoUF: e.target.value as EstadoUFBitacora }))}>
          <option value="">Selecciona</option>{['Servicio', 'Alarmada (F/S)', 'Lavado'].map(v => <option key={v}>{v}</option>)}
        </select></label>
      <label className="bc-campo bc-ancho" htmlFor={`${prefijo}-uf-comentarios`}><span>Comentarios relevantes de Ultrafiltración</span>
        <textarea id={`${prefijo}-uf-comentarios`} rows={3} disabled={!habilitado} value={borrador.comentariosUF}
          onChange={e => setBorrador(b => ({ ...b, comentariosUF: e.target.value }))} /></label>
    </div></Apartado>
    <Apartado indice={3} activo={activo} prefijo={prefijo}><div className="bc-mediciones">
      {(['1', '2', '3', '4'] as const).map(n => <label className="bc-campo" key={n} htmlFor={`${prefijo}-compresor-${n}`}><span>Compresor {n} · Estado</span>
        <select aria-label={`Estado de Compresor ${n}`} id={`${prefijo}-compresor-${n}`} disabled={!habilitado} value={borrador.compresores[n]}
          onChange={e => setBorrador(b => ({ ...b, compresores: { ...b.compresores, [n]: e.target.value as EstadoCompresor } }))}>
          <option value="">Selecciona</option>{['Servicio', 'Preparado', 'Mantenimiento'].map(v => <option key={v}>{v}</option>)}
        </select></label>)}
      {medicion('presion_aire', 'Presión general de aire', 'kg/cm²')}
    </div></Apartado>
    <Apartado indice={4} activo={activo} prefijo={prefijo}><fieldset className="bc-pilas" disabled={!habilitado}><legend className="bc-sr">Niveles, bombas y presiones</legend>
      {pilasCalderas.map(pila => <div className="bc-pila" key={pila.id}><h3>{pila.nombre}</h3>
        {([{ campo: 'nivel', titulo: 'Nivel', unidad: '%', tipo: 'number' }, { campo: 'bomba', titulo: 'Bomba', unidad: '#', tipo: 'text' },
          { campo: 'presion', titulo: 'Presión', unidad: 'kg/cm²', tipo: 'number' }] as const).map(c =>
          <label className="bc-campo" key={c.campo} htmlFor={`${prefijo}-${pila.id}-${c.campo}`}><span>{c.titulo} <small>({c.unidad})</small></span>
            <input id={`${prefijo}-${pila.id}-${c.campo}`} type={c.tipo} step={c.tipo === 'number' ? 'any' : undefined}
              inputMode={c.tipo === 'number' ? 'decimal' : undefined} value={borrador.pilas[pila.id][c.campo]}
              onChange={e => setBorrador(b => ({ ...b, pilas: { ...b.pilas, [pila.id]: { ...b.pilas[pila.id], [c.campo]: e.target.value } } }))} />
          </label>)}
      </div>)}
    </fieldset></Apartado>
    <Apartado indice={5} activo={activo} prefijo={prefijo}><div className="bc-mediciones">
      {medicion('nivel_agua_potable', 'Nivel de tanques de agua potable', '%')}
    </div>
      <p className="bc-ayuda bc-servicio-ayuda">{captura.reporte?.versionFormato === 1 ? 'Estos equipos no se capturaban en el formato anterior.'
        : 'Marca los equipos en servicio. Puedes marcar ambos; sin marcar queda sin registrar.'}</p>
      <div className="bc-servicios">{[{ titulo: 'Bombas de agua potable', equipos: equiposAguaCalderas.slice(0, 2) },
        { titulo: 'Pozos en servicio', equipos: equiposAguaCalderas.slice(2) }].map(g =>
        <fieldset key={g.titulo} disabled={!habilitado} className="bc-servicio-grupo"><legend>{g.titulo}</legend>
          {g.equipos.map(e => <label key={e.id} className="bc-servicio-opcion">
            <input type="checkbox" aria-label={`${e.nombre} en servicio`} checked={borrador.servicioAgua[e.id]}
              onChange={evento => { const marcado = evento.target.checked; setBorrador(b => ({ ...b, servicioAgua: { ...b.servicioAgua, [e.id]: marcado } })) }} />
            <span>{e.nombre}</span>
          </label>)}
        </fieldset>)}</div>
      <label className="bc-campo bc-ancho" htmlFor={`${prefijo}-reporte-relevante`}><span>Reporte relevante del turno <small>(obligatorio)</small></span>
        <textarea aria-label="Reporte relevante del turno (obligatorio)" id={`${prefijo}-reporte-relevante`} rows={4} required maxLength={4000} disabled={!habilitado} value={borrador.reporteRelevante}
          onChange={e => setBorrador(b => ({ ...b, reporteRelevante: e.target.value }))} /></label>
    </Apartado>
    <Apartado indice={6} activo={activo} prefijo={prefijo}>{observaciones}</Apartado>
    {captura.mensaje && captura.mensaje !== 'Reporte técnico registrado. Solo Administración puede corregirlo.' && <p className="bc-ayuda" role={captura.estado === 'error' || (!captura.reporte && !captura.guardando) ? 'alert' : 'status'}>{captura.mensaje}</p>}
    <footer className="bc-acciones"><span className="bc-ayuda" id={`${prefijo}-guardado`} hidden={!ayudaGuardado}>{ayudaGuardado}</span>
      <GuardadoReporteTecnico captura={captura} descripcionId={`${prefijo}-guardado`} alIntentar={() => {
        if (!captura.pendiente && !borrador.reporteRelevante.trim()) { setActivo(5); window.setTimeout(() => document.getElementById(`${prefijo}-reporte-relevante`)?.focus(), 0) }
      }} />
    </footer>
  </div>
}
