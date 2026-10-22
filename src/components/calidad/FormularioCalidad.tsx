import { Save, Trash2 } from 'lucide-react'
import { useLimitesCalidad } from '../../hooks/useLimitesCalidad'
import { evaluarLimite, textoLimite } from '../../lib/limitesCalidad'
import { useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { claveResultadoCalidad, ErrorCalidad, validarCamposCalidad } from '../../lib/calidad'
import { formatearNumeroCalidad } from '../../lib/formatoCalidad'
import type { CamposCalidad, CatalogosCalidad, LecturaCalidad } from '../../lib/tiposCalidad'
import type { AreaOperativa } from '../../lib/tiposTurno'

interface Props {
  horaServidor?: string | null
  area: AreaOperativa
  catalogos: CatalogosCalidad
  original?: LecturaCalidad
  deshabilitado: boolean
  alGuardar: (campos: CamposCalidad) => Promise<boolean>
}

export function FormularioCalidad({ area, catalogos, original, deshabilitado, alGuardar }: Props) {
  const id = useId()
  const configuracion = useLimitesCalidad()
  const [campos, setCampos] = useState<CamposCalidad>(() => ({
    notas: original?.notas ?? '',
    valores: Object.fromEntries(original?.resultados.map(r => [claveResultadoCalidad(r.punto_id, r.parametro_id), formatearNumeroCalidad(r.valor)]) ?? []),
  }))
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [confirmado, setConfirmado] = useState(false)
  const activo = useRef(false)
  const bloqueado = deshabilitado || enviando || confirmado
  const celdas = original ? original.resultados.map(r => ({ clave: claveResultadoCalidad(r.punto_id, r.parametro_id), punto: r.punto.nombre, parametro: r.parametro.nombre, unidad: r.parametro.unidad, puntoId: r.punto_id, parametroId: r.parametro_id, min: r.limite_min_aplicado, max: r.limite_max_aplicado }))
    : catalogos.puntos.filter(p => p.activo && (p.area === null || p.area === area)).flatMap(p => catalogos.parametros.filter(q => q.activo
      && (q.nombre.trim().toLowerCase() !== 'turbidez' || p.nombre.trim().toUpperCase() === 'AIMSU') && (area !== 'calderas'
      || q.nombre.trim().toLowerCase() === 'color'
      || (p.nombre.trim().toUpperCase() === 'AIMSU' && q.nombre.trim().toLowerCase() === 'turbidez'))).map(q => ({
      clave: claveResultadoCalidad(p.id, q.id), punto: p.nombre, parametro: q.nombre, unidad: q.unidad, puntoId: p.id, parametroId: q.id, min: null as number | null, max: null as number | null,
    })))

  function vistaPrevia(celda: typeof celdas[number]) {
    const version = configuracion.limites.find(l => l.punto_id === celda.puntoId && l.parametro_id === celda.parametroId)
    const min = original ? celda.min : version?.limite_min ?? null, max = original ? celda.max : version?.limite_max ?? null
    if (!original && (configuracion.error || configuracion.cargando)) return <small className="ayuda-turno">{configuracion.error ? 'No se pudo consultar el límite. El servidor evaluará al guardar.' : 'Consultando límite…'}</small>
    const texto = (campos.valores[celda.clave] ?? '').trim(), valor = Number(texto.replace(',', '.'))
    const evaluacion = texto && /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(texto) && Number.isFinite(valor) ? evaluarLimite(valor,min,max) : null
    return <div>{original && <small className="ayuda-turno">Límite original: {textoLimite(min,max)}</small>}{texto && <p className={evaluacion === true ? 'mensaje-error' : evaluacion === false ? 'mensaje-exito' : 'ayuda-turno'} role="status">{evaluacion === true ? 'Fuera de norma' : evaluacion === false ? 'En norma' : min === null && max === null ? 'Sin límite definido; no se evalúa.' : 'Escribe un número válido para evaluar.'}</p>}</div>
  }

  async function guardar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (bloqueado || activo.current) return
    try {
      const valores = validarCamposCalidad(campos)
      if (original && valores.resultados.length !== original.resultados.length) throw new ErrorCalidad('Completa todos los resultados originales para corregir.')
    } catch (e) { setError(e instanceof ErrorCalidad ? e.message : 'Revisa los resultados.'); return }
    activo.current = true
    setEnviando(true)
    setError(null)
    try {
      if (await alGuardar({ notas: campos.notas, valores: { ...campos.valores } })) setConfirmado(true)
    } catch { setError('No se pudo confirmar el guardado. Revisa el mensaje de Calidad.') }
    finally { activo.current = false; setEnviando(false) }
  }

  function limpiar() {
    if (bloqueado || activo.current) return
    setCampos({ notas: '', valores: {} })
    setError(null)
  }
  return <form className="calidad-formulario" onSubmit={guardar} aria-busy={enviando}>
    
    <fieldset className="calidad-campos" disabled={bloqueado}>
      <legend>{original ? 'Corregir muestra' : 'Nueva muestra de Calidad'}</legend>
      <div className="calidad-captura-cabecera">
        <div><h3>{original ? 'Corregir análisis de calidades de agua' : 'Análisis de calidades de agua'}</h3></div>
      </div>
      {celdas.length === 0 && <p>No hay puntos o parámetros activos disponibles para esta área.</p>}
      <div className="calidad-tarjetas">{Array.from(new Set(celdas.map(c => c.puntoId))).map(puntoId => <article className="calidad-tarjeta" key={puntoId}>
        <div className="calidad-tarjeta-cabecera"><h4>{celdas.find(c => c.puntoId === puntoId)?.punto}</h4>
          <div className="calidad-limites">{celdas.filter(c => c.puntoId === puntoId).map(celda => {
            const version = configuracion.limites.find(l => l.punto_id === celda.puntoId && l.parametro_id === celda.parametroId)
            const min = original ? celda.min : version?.limite_min ?? null, max = original ? celda.max : version?.limite_max ?? null
            if (!original && (configuracion.error || configuracion.cargando)) return null
            if (min === null && max === null) return null
            return <span className="calidad-limite-badge" key={celda.clave} title={celda.parametro + ': ' + textoLimite(min,max)}>{celda.parametro} {textoLimite(min,max)}</span>
          })}</div>
        </div>
        <div className="calidad-parametros">{celdas.filter(c => c.puntoId === puntoId).map(celda => {
          const indice = celdas.indexOf(celda)
          const version = configuracion.limites.find(l => l.punto_id === celda.puntoId && l.parametro_id === celda.parametroId)
          const minimo = original ? celda.min : version?.limite_min ?? null, maximo = original ? celda.max : version?.limite_max ?? null
          const texto = (campos.valores[celda.clave] ?? '').trim(), valor = Number(texto.replace(',', '.'))
          const valido = !!texto && /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(texto) && Number.isFinite(valor)
          const resultado = valido && (original || (!configuracion.error && !configuracion.cargando)) ? evaluarLimite(valor,minimo,maximo) : null
          return <div className="campo-turno" key={celda.clave}>
            <label htmlFor={id + '-' + indice}>{celda.parametro}{celda.unidad ? ' (' + celda.unidad + ')' : ''}</label>
            <input id={id + '-' + indice} aria-describedby={id + '-estado-' + indice} className={resultado === true ? 'calidad-fuera' : resultado === false ? 'calidad-normal' : ''} type="text" inputMode="decimal" autoComplete="off" required={!!original}
              value={campos.valores[celda.clave] ?? ''} onChange={e => {
                if (bloqueado || activo.current) return
                const valor = e.target.value
                setCampos(c => ({ ...c, valores: { ...c.valores, [celda.clave]: valor } })); setError(null)
              }} />
            <div id={id + '-estado-' + indice}>{vistaPrevia(celda)}</div>
          </div>
        })}</div>
      </article>)}</div>
      <div className="campo-turno calidad-notas">
        <label htmlFor={`${id}-notas`}>Notas de la muestra (opcional)</label>
        <textarea id={`${id}-notas`} rows={2} placeholder="Observaciones de la captura…" value={campos.notas} onChange={e => {
          if (bloqueado || activo.current) return
          const notas = e.target.value; setCampos(c => ({ ...c, notas })); setError(null)
        }} />
      </div>
    </fieldset>
    
    {error && <p className="mensaje-error" role="alert">{error}</p>}
    <div className="acciones-turno calidad-acciones"><button type="button" className="boton-secundario" disabled={bloqueado} onClick={limpiar}><Trash2 aria-hidden="true" />Limpiar formulario</button><button className="boton-primario" type="submit" disabled={bloqueado || celdas.length === 0}>
      <Save aria-hidden="true" />{enviando ? 'Guardando…' : original ? 'Guardar corrección' : 'Guardar registro técnico'}
    </button></div>
  </form>
}
