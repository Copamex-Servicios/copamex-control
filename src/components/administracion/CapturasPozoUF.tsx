import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { actualizarDatosPozos } from '../../hooks/usePozos'
import { actualizarDatosUF } from '../../hooks/useUF'
import { FormularioPozos } from '../pozos/FormularioPozos'
import { FormularioUF } from '../uf/FormularioUF'
import { MonitorConcesionPozos } from '../pozos/MonitorConcesionPozos'
import { validarCamposPozos } from '../../lib/pozos'
import { validarCamposUF } from '../../lib/uf'
import type { CamposPozos } from '../../lib/tiposPozos'
import type { CamposUF } from '../../lib/tiposUF'
import type { TipoTurno } from '../../lib/tiposTurno'
import { supabase } from '../../lib/supabase'
import './gestionRegistros.css'
import './capturasPozoUF.css'

type Modulo = 'pozos' | 'uf'
type Referencia = {
  fecha: string
  inicial1: number | null
  inicial2: number | null
  existente: Record<string, unknown> | null
  motivoBloqueo: string | null
  ocupadaOperativa: boolean
}
const borradores = new Map<string, { fecha: string; inicial1: number | null; inicial2: number | null; campos: CamposPozos | CamposUF }>()
type Solicitud = {
  p_modulo: Modulo
  p_id: string
  p_fecha: string
  p_final1: number
  p_final2: number
  p_notas: string | null
}
type FilaHistorial = {
  id: string
  fecha_operativa: string
  turno: TipoTurno
  inicial1: number
  final1: number
  consumo1: number
  inicial2: number
  final2: number
  consumo2: number
  rechazo?: number | null
  rendimiento?: number | null
  notas: string | null
  capturado_en: string
}

function fechaActualMexico(ahora = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(ahora)
  const valor = (tipo: string) => partes.find(parte => parte.type === tipo)?.value ?? ''
  return `${valor('year')}-${valor('month')}-${valor('day')}`
}

function numeroSeguro(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function numeroFinito(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function porcentajeLegible(value: number | null): string {
  return value === null ? 'No aplica'
    : `${value.toLocaleString('es-MX', { maximumFractionDigits: 2 })} %`
}

function anchoPorcentaje(value: number | null): number {
  return value === null ? 0 : Math.min(100, Math.max(0, value))
}

function etiquetaTurno(turno: TipoTurno): string {
  return turno === 'dia' ? 'Día' : turno === 'tarde' ? 'Tarde' : 'Noche'
}

function fechaLegible(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('es-MX')
}

function fechaCaptura(value: string, modulo: Modulo): string {
  const fecha = new Date(value)
  if (!Number.isFinite(fecha.getTime())) return '—'
  return modulo === 'pozos'
    ? fecha.toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' })
    : fecha.toLocaleString('es-MX')
}

function horaCapturaMexico(value: unknown): string {
  if (typeof value !== 'string') return '—'
  const fecha = new Date(value)
  return Number.isFinite(fecha.getTime())
    ? fecha.toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: 'numeric', minute: '2-digit' })
    : '—'
}

function errorRPC(error: { code?: string; message: string }, migracion: string): string {
  if (error.code === 'PGRST202') return `Falta aplicar la migración ${migracion} en Supabase.`
  if (error.code === '23505') return 'Ya hay una lectura registrada para esa fecha y turno.'
  if (error.code === '22023') return error.message
  if (error.code === '42501') return 'La sesión no tiene permiso de Administración. Cierra sesión y vuelve a entrar.'
  return error.message || 'No se pudo completar la operación.'
}

export function CapturasPozoUF() {
  const { estado, perfil, sesion } = useAuth()
  const [modulo, setModulo] = useState<Modulo>('pozos')
  const [ufAbierta, setUFAbierta] = useState(false)
  const cuenta = estado === 'autenticado' && perfil?.activo && perfil.rol === 'admin' && perfil.id === sesion?.user.id ? perfil.id : null
  if (!cuenta) return null

  return <div className="gestion-registros gestion-mediciones-admin">
    <nav className="gestion-capturas-tabs" aria-label="Captura de Pozos y UF">
      <button type="button" aria-pressed={modulo === 'pozos'} onClick={() => setModulo('pozos')}>Pozo</button>
      <button type="button" aria-pressed={modulo === 'uf'} onClick={() => { setUFAbierta(true); setModulo('uf') }}>UF</button>
    </nav>
    <div hidden={modulo !== 'pozos'}><CapturaMedicion key={cuenta + ':pozos'} cuenta={cuenta} modulo="pozos" /></div>
    {ufAbierta && <div hidden={modulo !== 'uf'}><CapturaMedicion key={cuenta + ':uf'} cuenta={cuenta} modulo="uf" /></div>}
  </div>
}

function CapturaMedicion({ cuenta, modulo }: { cuenta: string; modulo: Modulo }) {
  const titulo = modulo === 'pozos' ? 'Pozos' : 'Ultrafiltración'
  const [fecha, setFecha] = useState(fechaActualMexico)
  const [referencia, setReferencia] = useState<Referencia | null>(null)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [solicitudPendiente, setSolicitudPendiente] = useState<Solicitud | null>(null)
  const [versionFormulario, setVersionFormulario] = useState(0)
  const [offsetHistorial, setOffsetHistorial] = useState(0)
  const [filasHistorial, setFilasHistorial] = useState<FilaHistorial[]>([])
  const [hayMasHistorial, setHayMasHistorial] = useState(false)
  const [cargandoHistorial, setCargandoHistorial] = useState(true)
  const [errorHistorial, setErrorHistorial] = useState('')
  const [versionHistorial, setVersionHistorial] = useState(0)
  const [versionConsultaReferencia, setVersionConsultaReferencia] = useState(0)
  const [revisionMonitorPozos, setRevisionMonitorPozos] = useState(0)
  const operacion = useRef(false)
  const consultaAutomatica = useRef('')
  const serialFormulario = `${modulo}:${fecha}:${versionFormulario}`
  const claveBorrador = modulo === 'pozos' ? `${cuenta}:${modulo}:${fecha}` : `${cuenta}:${modulo}`
  const guardadoLocal = borradores.get(claveBorrador)
  const borrador = guardadoLocal && referencia
    && guardadoLocal.fecha === referencia.fecha
    && guardadoLocal.inicial1 === referencia.inicial1
    && guardadoLocal.inicial2 === referencia.inicial2 ? guardadoLocal.campos : undefined

  function conservarBorrador(campos: CamposPozos | CamposUF) {
    if (!referencia) return
    borradores.set(claveBorrador, { fecha: referencia.fecha, inicial1: referencia.inicial1, inicial2: referencia.inicial2, campos })
  }

  const consultarReferencia = useCallback(async () => {
    if (operacion.current) return
    if (solicitudPendiente) {
      setError('Hay un guardado sin confirmar. Reintenta esa misma solicitud antes de cargar otra lectura.')
      return
    }
    operacion.current = true
    setOcupado(true)
    setError('')
    setSolicitudPendiente(null)
    try {
      const { data, error: rpcError } = modulo === 'uf'
        ? await supabase.rpc('consultar_referencia_uf_admin', { p_fecha: fecha })
          .abortSignal(AbortSignal.timeout(20000))
        : await supabase.rpc('consultar_referencia_pozos_admin', { p_fecha: fecha })
          .abortSignal(AbortSignal.timeout(20000))
      if (rpcError) throw new Error(errorRPC(rpcError,
        modulo === 'uf' ? '20261120000200_historial_capturas_y_fecha_uf.sql' : '20261127000100_fecha_captura_pozos_admin.sql'))
      const resultado = data as Record<string, unknown> | null
      if (!resultado) throw new Error('No se recibió una referencia de lecturas.')
      if (resultado.fecha_operativa !== fecha) throw new Error('La referencia recibida no coincide con la fecha seleccionada.')
      const inicial1 = numeroSeguro(resultado.inicial1)
      const inicial2 = numeroSeguro(resultado.inicial2)
      const existente = resultado.existente && typeof resultado.existente === 'object'
        ? resultado.existente as Record<string, unknown> : null
      const motivoBloqueo = typeof resultado.motivo_bloqueo === 'string' ? resultado.motivo_bloqueo : null
      setReferencia({
        fecha,
        inicial1,
        inicial2,
        existente,
        motivoBloqueo,
        ocupadaOperativa: resultado.ocupada_operativa === true,
      })
      setVersionFormulario(n => n + 1)
      if (existente || resultado.ocupada_operativa === true) {
        borradores.delete(claveBorrador)
        setMensaje('')
      }
      else if (!motivoBloqueo && (inicial1 === null || inicial2 === null)) setError('No hay lecturas iniciales anteriores ni una base histórica para esta fecha.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron consultar las lecturas iniciales.')
    } finally {
      operacion.current = false
      setOcupado(false)
    }
  }, [claveBorrador, fecha, modulo, solicitudPendiente])

  useEffect(() => {
    if (ocupado || solicitudPendiente) return
    const clave = `${cuenta}:${modulo}:${fecha}:${versionConsultaReferencia}`
    if (consultaAutomatica.current === clave) return
    consultaAutomatica.current = clave
    void consultarReferencia()
  }, [cuenta, modulo, fecha, ocupado, solicitudPendiente, versionConsultaReferencia, consultarReferencia])

  async function guardar(campos: CamposPozos | CamposUF): Promise<boolean> {
    if (operacion.current || !referencia || referencia.motivoBloqueo || referencia.inicial1 === null || referencia.inicial2 === null) return false
    let final1: number
    let final2: number
    let notas: string | null
    let recargarReferencia = false
    try {
      if ('pozo1Inicial' in campos) {
        const valores = validarCamposPozos(campos)
        final1 = valores.pozo1_fin
        final2 = valores.pozo2_fin
        notas = valores.notas
      } else {
        const valores = validarCamposUF(campos)
        final1 = valores.alim_fin
        final2 = valores.acep_fin
        notas = valores.notas
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Revisa las lecturas finales.')
      return false
    }

    if (solicitudPendiente && (solicitudPendiente.p_modulo !== modulo
      || solicitudPendiente.p_fecha !== referencia.fecha
      || solicitudPendiente.p_final1 !== final1 || solicitudPendiente.p_final2 !== final2
      || solicitudPendiente.p_notas !== notas)) {
      setError('Hay un guardado sin confirmar. Reintenta con los mismos datos antes de cambiar la lectura.')
      return false
    }

    let solicitud = solicitudPendiente
    if (!solicitud) {
      solicitud = { p_modulo: modulo, p_id: crypto.randomUUID(), p_fecha: referencia.fecha, p_final1: final1, p_final2: final2, p_notas: notas }
      setSolicitudPendiente(solicitud)
    }
    operacion.current = true
    setOcupado(true)
    setError('')
    setMensaje('')
    try {
      const { data, error: rpcError } = modulo === 'uf'
        ? await supabase.rpc('crear_medicion_uf_admin', {
          p_id: solicitud.p_id, p_fecha: solicitud.p_fecha,
          p_final1: solicitud.p_final1, p_final2: solicitud.p_final2, p_notas: solicitud.p_notas,
        }).abortSignal(AbortSignal.timeout(25000))
        : await supabase.rpc('crear_medicion_pozos_admin', {
          p_id: solicitud.p_id, p_fecha: solicitud.p_fecha,
          p_final1: solicitud.p_final1, p_final2: solicitud.p_final2, p_notas: solicitud.p_notas,
        }).abortSignal(AbortSignal.timeout(25000))
      if (rpcError) {
        if (['42501', '22023', '22P02', '23505', '23514', 'PGRST202'].includes(rpcError.code)) setSolicitudPendiente(null)
        throw new Error(errorRPC(rpcError,
          modulo === 'uf' ? '20261120000200_historial_capturas_y_fecha_uf.sql' : '20261127000100_fecha_captura_pozos_admin.sql'))
      }
      if (data !== solicitud.p_id) throw new Error('No se confirmó la lectura. Reintenta el mismo guardado.')
      borradores.delete(claveBorrador)
      setSolicitudPendiente(null)
      setReferencia(null)
      setVersionFormulario(n => n + 1)
      setMensaje('Lectura guardada.')
      if (modulo === 'pozos') setRevisionMonitorPozos(n => n + 1)
      setCargandoHistorial(true)
      setErrorHistorial('')
      setVersionHistorial(n => n + 1)
      setOffsetHistorial(0)
      recargarReferencia = true
      void (modulo === 'pozos' ? actualizarDatosPozos() : actualizarDatosUF())
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la lectura.')
      return false
    } finally {
      operacion.current = false
      setOcupado(false)
      if (recargarReferencia) setVersionConsultaReferencia(n => n + 1)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    let activa = true
    void Promise.resolve(supabase.rpc('consultar_historial_mediciones_admin', {
      p_modulo: modulo, p_limite: 7, p_offset: offsetHistorial,
    }).abortSignal(controller.signal)).then(({ data, error: rpcError }) => {
      if (!activa) return
      if (rpcError) throw new Error(errorRPC(rpcError, '20261120000200_historial_capturas_y_fecha_uf.sql'))
      const resultado = data as { filas?: unknown; mas?: unknown } | null
      const filas = Array.isArray(resultado?.filas) ? resultado.filas as FilaHistorial[] : []
      setFilasHistorial(filas)
      setHayMasHistorial(resultado?.mas === true)
    }).catch(e => {
      if (activa && !controller.signal.aborted) setErrorHistorial(e instanceof Error ? e.message : 'No se pudo cargar el historial.')
    }).finally(() => {
      if (activa) setCargandoHistorial(false)
    })
    return () => { activa = false; controller.abort() }
  }, [cuenta, modulo, offsetHistorial, versionHistorial])

  const entradaOcupada = referencia?.existente !== null && referencia?.existente !== undefined
    || referencia?.ocupadaOperativa === true
  const inicialesDisponibles = referencia?.inicial1 !== null && referencia?.inicial1 !== undefined
    && referencia?.inicial2 !== null && referencia?.inicial2 !== undefined

  return <div className="co-operativo-referencia">
    {modulo === 'pozos' && <div className="pozo-uf-monitor panel-pozos">
      <MonitorConcesionPozos revision={revisionMonitorPozos} supervision />
    </div>}
    <section className="panel-informacion panel-mediciones">
      <div className="gestion-mediciones-filtros pozo-uf-fecha-captura">
        <label>{modulo === 'pozos' ? 'Fecha de lectura' : 'Fecha de captura'} · Turno Día
          <input type="date" value={fecha} max={fechaActualMexico()} disabled={ocupado || Boolean(solicitudPendiente)}
            onChange={event => {
              const siguiente = event.currentTarget.value
              if (!siguiente || siguiente > fechaActualMexico()) return
              if (modulo === 'uf') borradores.delete(claveBorrador)
              setReferencia(null)
              setError('')
              setMensaje('')
              setFecha(siguiente)
              setVersionFormulario(n => n + 1)
            }} />
        </label>
      </div>
      {error && <p className="mensaje-error" role="alert">{error}</p>}
      {mensaje && <p className="mensaje-exito" role="status">{mensaje}</p>}
      {referencia?.motivoBloqueo && !entradaOcupada && <p className="mensaje-error" role="alert">{referencia.motivoBloqueo}</p>}
      {referencia && !entradaOcupada && !referencia.motivoBloqueo && inicialesDisponibles && <>
        {modulo === 'pozos'
          ? <FormularioPozos key={serialFormulario}
            lecturasIniciales={{ pozo1: referencia.inicial1!, pozo2: referencia.inicial2! }}
            borrador={borrador && 'pozo1Final' in borrador ? borrador : undefined} alEditar={conservarBorrador}
            mostrarAyudaLecturasIniciales={false} alGuardar={guardar} deshabilitado={ocupado} />
          : <FormularioUF key={serialFormulario}
            lecturasIniciales={{ alimentacion: referencia.inicial1!, aceptacion: referencia.inicial2! }}
            borrador={borrador && 'alimentacionFinal' in borrador ? borrador : undefined} alEditar={conservarBorrador}
            mostrarAyudaLecturasIniciales={false} alGuardar={guardar} deshabilitado={ocupado} />}
      </>}
      {referencia?.existente && <RegistroExistente modulo={modulo} registro={referencia.existente} />}
      {referencia?.ocupadaOperativa && <p>La captura de esta fecha ya está ligada a un turno operativo. No se agregó otra para evitar duplicar el registro.</p>}
      {solicitudPendiente && <p className="mensaje-error" role="status">El guardado no se confirmó. Vuelve a pulsar Guardar para reintentar la misma solicitud.</p>}
    </section>

    <section className="panel-informacion pozo-uf-historial" aria-label={`Historial de capturas administrativas de ${titulo}`}>
      <h2>Historial de capturas administrativas</h2>
      {errorHistorial && <p className="mensaje-error" role="alert">{errorHistorial}</p>}
      {cargandoHistorial ? <p role="status">Cargando historial…</p> : !errorHistorial && filasHistorial.length === 0
        ? <p>No hay capturas administrativas registradas.</p>
        : <div className="tabla-scroll"><table>
          <thead><tr>
            <th>Fecha</th><th>Turno</th>
            <th>{modulo === 'pozos' ? 'Pozo 1' : 'Alimentación'}</th>
            <th>{modulo === 'pozos' ? 'Pozo 2' : 'Aceptación'}</th>
            {modulo === 'uf' && <th>Rechazo</th>}
            {modulo === 'pozos' ? <th>Total (m³)</th> : <th>Aceptado (%)</th>}
          </tr></thead>
          <tbody>{filasHistorial.map(fila => {
            const aceptadoPorcentaje = modulo === 'uf' ? numeroFinito(fila.rendimiento) : null
            return <tr key={fila.id}>
              <td>{fechaLegible(fila.fecha_operativa)}</td><td>{etiquetaTurno(fila.turno)}</td>
              <td>{fila.inicial1.toLocaleString('es-MX')} → {fila.final1.toLocaleString('es-MX')} ({fila.consumo1.toLocaleString('es-MX')} m³)</td>
              <td>{fila.inicial2.toLocaleString('es-MX')} → {fila.final2.toLocaleString('es-MX')} ({fila.consumo2.toLocaleString('es-MX')} m³)</td>
              {modulo === 'uf' && <td>{numeroFinito(fila.rechazo)?.toLocaleString('es-MX', { maximumFractionDigits: 3 }) ?? '—'} m³</td>}
              {modulo === 'pozos'
                ? <td>{(fila.consumo1 + fila.consumo2).toLocaleString('es-MX')} m³</td>
                : <td>
                  <div className="pozo-uf-aceptado-resumen">
                    <strong>{porcentajeLegible(aceptadoPorcentaje)}</strong>
                    <div className="pozo-uf-balance-barra" aria-hidden="true">
                      <span style={{ width: `${anchoPorcentaje(aceptadoPorcentaje)}%` }} />
                    </div>
                  </div>
                </td>}
            </tr>
          })}</tbody>
        </table></div>}
      {(offsetHistorial > 0 || hayMasHistorial) && <div className="pozo-uf-paginacion">
        <button type="button" className="boton-secundario" disabled={cargandoHistorial || offsetHistorial === 0}
          onClick={() => { setCargandoHistorial(true); setErrorHistorial(''); setOffsetHistorial(n => Math.max(0, n - 7)) }}>Anterior</button>
        <span>Página {Math.floor(offsetHistorial / 7) + 1}</span>
        <button type="button" className="boton-secundario" disabled={cargandoHistorial || !hayMasHistorial}
          onClick={() => { setCargandoHistorial(true); setErrorHistorial(''); setOffsetHistorial(n => n + 7) }}>Siguiente</button>
      </div>}
    </section>

  </div>
}

function RegistroExistente({ modulo, registro }: { modulo: Modulo; registro: Record<string, unknown> }) {
  const inicial1 = numeroSeguro(registro.inicial1 ?? registro.alim_ini)
  const inicial2 = numeroSeguro(registro.inicial2 ?? registro.acep_ini)
  const final1 = numeroSeguro(registro.final1 ?? registro.pozo1_fin ?? registro.alim_fin)
  const final2 = numeroSeguro(registro.final2 ?? registro.pozo2_fin ?? registro.acep_fin)
  const capturado = typeof registro.capturado_en === 'string' ? fechaCaptura(registro.capturado_en, modulo) : '—'
  if (modulo === 'pozos') {
    const pozos = [
      {
        numero: 1,
        inicial: numeroSeguro(registro.inicial1 ?? registro.pozo1_ini),
        final: numeroSeguro(registro.final1 ?? registro.pozo1_fin),
        consumo: numeroSeguro(registro.consumo1 ?? registro.consumo_pozo1),
      },
      {
        numero: 2,
        inicial: numeroSeguro(registro.inicial2 ?? registro.pozo2_ini),
        final: numeroSeguro(registro.final2 ?? registro.pozo2_fin),
        consumo: numeroSeguro(registro.consumo2 ?? registro.consumo_pozo2),
      },
    ]
    const fecha = typeof registro.fecha_operativa === 'string' ? fechaLegible(registro.fecha_operativa) : capturado
    const turno = registro.turno === 'tarde' ? 'Tarde' : registro.turno === 'noche' ? 'Noche' : 'Día'
    const volumenPozo = (valor: number | null) => valor?.toLocaleString('es-MX', { maximumFractionDigits: 3 }) ?? '—'
    return <article className="pozo-uf-registro-existente pozo-uf-pozos-guardado">
      <header className="pozo-uf-resumen-encabezado">
        <div>
          <h3>Captura de Pozos</h3>
          <p>Fecha de captura: {fecha} · Turno {turno}</p>
        </div>
        <span className="pozo-uf-resumen-estado">Registrada</span>
      </header>
      <div className="pozo-uf-pozos-resumen">
        {pozos.map(pozo => <section key={pozo.numero} aria-label={`Pozo ${pozo.numero}`}>
          <h4>Pozo {pozo.numero}</h4>
          <dl>
            <div><dt>Lectura inicial (m³)</dt><dd>{volumenPozo(pozo.inicial)}</dd></div>
            <div><dt>Lectura final (m³)</dt><dd>{volumenPozo(pozo.final)}</dd></div>
            <div><dt>Consumo (m³)</dt><dd>{volumenPozo(pozo.consumo)}</dd></div>
          </dl>
        </section>)}
      </div>
      <p className="pozo-uf-pozos-nota">Esta lectura ya está registrada; no se reemplazará.</p>
    </article>
  }

  const alimentado = numeroFinito(registro.alimentado)
  const aceptado = numeroFinito(registro.aceptado)
  const rendimientoGuardado = numeroFinito(registro.rendimiento)
  const rendimiento = rendimientoGuardado ?? (alimentado !== null && alimentado > 0 && aceptado !== null
    ? aceptado / alimentado * 100 : null)
  const rechazoPorcentaje = rendimiento === null ? null : 100 - rendimiento
  const rechazo = numeroFinito(registro.rechazo)
  const fecha = typeof registro.fecha_operativa === 'string' ? fechaLegible(registro.fecha_operativa) : '—'
  const turno = registro.turno === 'tarde' ? 'Tarde' : registro.turno === 'noche' ? 'Noche' : 'Día'
  const etiquetaRendimiento = rendimiento === null ? 'No aplica' : porcentajeLegible(rendimiento)
  const etiquetaRechazo = rechazoPorcentaje === null ? 'No aplica' : porcentajeLegible(rechazoPorcentaje)
  const volumen = (value: number | null) => value?.toLocaleString('es-MX', { maximumFractionDigits: 3 }) ?? '—'
  return <div className="pozo-uf-registro-existente pozo-uf-resumen-guardado">
    <header className="pozo-uf-resumen-encabezado">
      <div>
        <h3>Ultrafiltración</h3>
        <p>{fecha} · Turno {turno} · Guardada {horaCapturaMexico(registro.capturado_en)}</p>
      </div>
      <span className="pozo-uf-resumen-estado">Registrada</span>
    </header>
    <div className="pozo-uf-tabla-lecturas">
      <table>
        <thead><tr>
          <th scope="col">Medidor</th>
          <th scope="col">Lectura inicial (m³)</th>
          <th scope="col">Lectura final (m³)</th>
          <th scope="col">Consumo (m³)</th>
        </tr></thead>
        <tbody>
          <tr>
            <th scope="row">Alimentación</th>
            <td>{volumen(inicial1)}</td><td>{volumen(final1)}</td>
            <td><strong>{volumen(alimentado)}</strong></td>
          </tr>
          <tr>
            <th scope="row">Aceptación</th>
            <td>{volumen(inicial2)}</td><td>{volumen(final2)}</td>
            <td><strong>{volumen(aceptado)}</strong></td>
          </tr>
        </tbody>
      </table>
    </div>
    <section className="pozo-uf-rendimiento" aria-label="Rendimiento de Ultrafiltración">
      <div className="pozo-uf-rendimiento-cabecera">
        <strong>Rendimiento</strong>
        <strong>{etiquetaRendimiento}</strong>
      </div>
      <div className="pozo-uf-balance-barra" role="img" aria-label={`${etiquetaRendimiento} aceptado; ${etiquetaRechazo} rechazado`}>
        <span aria-hidden="true" style={{ width: `${anchoPorcentaje(rendimiento)}%` }} />
      </div>
      <div className="pozo-uf-balance-leyenda">
        <div>
          <span className="pozo-uf-balance-punto pozo-uf-balance-punto-aceptado" aria-hidden="true" />
          <span>Aceptado<strong>{volumen(aceptado)} m³ · {etiquetaRendimiento}</strong></span>
        </div>
        <div>
          <span className="pozo-uf-balance-punto pozo-uf-balance-punto-rechazado" aria-hidden="true" />
          <span>Rechazado<strong>{volumen(rechazo)} m³ · {etiquetaRechazo}</strong></span>
        </div>
      </div>
    </section>
  </div>
}
