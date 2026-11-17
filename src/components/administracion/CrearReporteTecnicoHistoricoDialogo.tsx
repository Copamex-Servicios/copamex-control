import { useEffect, useMemo, useRef, useState } from 'react'
import { exigirAdminRevision } from '../../lib/revisionCapturas'
import { supabase } from '../../lib/supabase'
import type { AreaOperativa, TipoTurno } from '../../lib/tiposTurno'
import { borradorBitacoraCalderas } from '../../lib/tiposBitacoraCalderas'
import type { BorradorBitacoraCalderas } from '../../lib/tiposBitacoraCalderas'
import { prepararDatosCalderas } from '../../lib/bitacoraTecnicaCalderas'
import { borradorBitacoraPTAR } from '../../lib/tiposBitacoraPTAR'
import type { BorradorBitacoraPTAR } from '../../lib/tiposBitacoraPTAR'
import { prepararDatosPTAR } from '../../lib/bitacoraTecnicaPTAR'
import { FormularioBitacoraCalderas } from '../bitacora/FormularioBitacoraCalderas'
import { FormularioBitacoraPTAR } from '../bitacora/FormularioBitacoraPTAR'
import { ConfirmacionGuardadoTecnico } from '../bitacora/GuardadoReporteTecnico'
import './crearReporteTecnicoHistorico.css'

interface OperadorCatalogo { id: string; nombre: string; numero_empleado: string }
type RolOperador = 'principal' | 'acompanante'
type ResultadoBusquedaOperador = { numero: string; operador: OperadorCatalogo | null; mensaje: string | null }
interface Props {
  cuenta: string
  fecha: string
  area: AreaOperativa
  turnoInicial: TipoTurno
  turnosDisponibles: readonly TipoTurno[]
  alCerrar: (guardado: boolean) => void
}
type SolicitudHistorica = {
  id: string
  area: AreaOperativa
  turno: TipoTurno
  numeroEmpleado: string
  numeroEmpleadoAcompanante: string
  datos: ReturnType<typeof prepararDatosCalderas> | ReturnType<typeof prepararDatosPTAR>
}
type RegistroRpc = { id?: unknown; confirmado?: unknown }

const ordenTurnos: readonly TipoTurno[] = ['dia', 'tarde', 'noche']
const etiquetaTurno: Record<TipoTurno, string> = { dia: 'Día', tarde: 'Tarde', noche: 'Noche' }
const etiquetaArea: Record<AreaOperativa, string> = { calderas: 'Calderas', ptar: 'PTAR' }
const numeroNormalizado = (valor: string) => valor.trim().toUpperCase()

function leerOperadores(valor: unknown): OperadorCatalogo[] {
  if (!Array.isArray(valor)) throw new Error('No se pudo consultar el catálogo de operadores.')
  return valor.flatMap(fila => {
    if (!fila || typeof fila !== 'object' || Array.isArray(fila)) return []
    const r = fila as Record<string, unknown>
    return typeof r.id === 'string' && typeof r.nombre === 'string' && r.nombre.trim()
      && typeof r.numero_empleado === 'string' && r.numero_empleado.trim()
      ? [{ id: r.id, nombre: r.nombre.trim(), numero_empleado: r.numero_empleado.trim() }] : []
  })
}

function errorDeGuardado(error: unknown): { mensaje: string; definitivo: boolean } {
  const e = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const codigo = typeof e.code === 'string' ? e.code : ''
  const mensajeServidor = typeof e.message === 'string' ? e.message : ''
  if (codigo === '23505') return { mensaje: 'Ya existe un turno o reporte para esa fecha, área y turno. Actualiza la lista antes de intentar otra vez.', definitivo: true }
  if (codigo === '42501') return { mensaje: 'La cuenta ya no tiene autorización administrativa para guardar.', definitivo: true }
  if (codigo === 'PGRST202') return { mensaje: 'Falta aplicar en Supabase la migración local de alta histórica antes de usar esta opción.', definitivo: true }
  if (codigo === '22023') return { mensaje: mensajeServidor || 'Revisa los datos del turno y los campos obligatorios.', definitivo: true }
  if (codigo === '40001') return { mensaje: 'El registro cambió durante la operación. Actualiza la lista y revisa si el turno ya se creó.', definitivo: true }
  const definitivo = /^[0-9A-Z]{5}$/.test(codigo) || codigo.startsWith('PGRST')
  return { mensaje: mensajeServidor || 'No se recibió confirmación. Reintenta el mismo guardado para comprobar si se registró.', definitivo }
}

export function CrearReporteTecnicoHistoricoDialogo({ cuenta, fecha, area, turnoInicial, turnosDisponibles, alCerrar }: Props) {
  const dialogo = useRef<HTMLDialogElement>(null)
  const solicitud = useRef<SolicitudHistorica | null>(null)
  const controlActivo = useRef<AbortController | null>(null)
  const cerrado = useRef(false)
  const [numeroPrincipal, setNumeroPrincipal] = useState('')
  const [numeroAcompanante, setNumeroAcompanante] = useState('')
  const [busquedas, setBusquedas] = useState<Record<RolOperador, ResultadoBusquedaOperador | null>>({ principal: null, acompanante: null })
  const [buscando, setBuscando] = useState<Record<RolOperador, boolean>>({ principal: false, acompanante: false })
  const controlesBusqueda = useRef<Record<RolOperador, AbortController | null>>({ principal: null, acompanante: null })
  const [turno, setTurno] = useState<TipoTurno>(turnoInicial)
  const [borrador, setBorrador] = useState<BorradorBitacoraCalderas | BorradorBitacoraPTAR>(() =>
    area === 'calderas' ? borradorBitacoraCalderas() : borradorBitacoraPTAR())
  const [guardando, setGuardando] = useState(false)
  const [confirmado, setConfirmado] = useState(false)
  const [incierto, setIncierto] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bloqueado = guardando || incierto || confirmado
  const opcionesTurno = useMemo(() => ordenTurnos.filter(t => turnosDisponibles.includes(t)), [turnosDisponibles])

  useEffect(() => {
    const elemento = dialogo.current
    const busquedasActivas = controlesBusqueda.current
    if (elemento && !elemento.open) elemento.showModal()
    // En StrictMode React limpia y vuelve a montar los efectos en desarrollo.
    // Cerrar aquí dispara `onClose` y desmonta el diálogo antes de que el usuario lo vea.
    // Al desmontar el nodo <dialog>, el navegador lo retira por sí mismo de la capa modal.
    return () => {
      controlActivo.current?.abort()
      busquedasActivas.principal?.abort()
      busquedasActivas.acompanante?.abort()
    }
  }, [])

  const resultadoPrincipal = busquedas.principal?.numero === numeroNormalizado(numeroPrincipal) ? busquedas.principal : null
  const resultadoAcompanante = busquedas.acompanante?.numero === numeroNormalizado(numeroAcompanante) ? busquedas.acompanante : null
  const operadorPrincipal = resultadoPrincipal?.operador ?? null
  const operadorAcompanante = resultadoAcompanante?.operador ?? null
  const operadoresDistintos = !!operadorPrincipal && !!operadorAcompanante && operadorPrincipal.id !== operadorAcompanante.id
  const operadorRepetido = !!operadorPrincipal && !!operadorAcompanante && operadorPrincipal.id === operadorAcompanante.id
  const numeroRepetido = !!numeroNormalizado(numeroPrincipal) && numeroNormalizado(numeroPrincipal) === numeroNormalizado(numeroAcompanante)
  const listoParaCapturar = operadoresDistintos && !numeroRepetido

  function cambiarNumero(rol: RolOperador, valor: string) {
    controlesBusqueda.current[rol]?.abort()
    controlesBusqueda.current[rol] = null
    setBuscando(actual => ({ ...actual, [rol]: false }))
    setBusquedas(actual => ({ ...actual, [rol]: null }))
    if (rol === 'principal') setNumeroPrincipal(valor)
    else setNumeroAcompanante(valor)
  }

  async function buscarOperador(rol: RolOperador) {
    if (bloqueado || buscando[rol]) return
    const numero = numeroNormalizado(rol === 'principal' ? numeroPrincipal : numeroAcompanante)
    controlesBusqueda.current[rol]?.abort()
    if (!numero) {
      setBusquedas(actual => ({ ...actual, [rol]: { numero, operador: null, mensaje: 'Escribe el número completo y presiona Enter.' } }))
      return
    }
    const control = new AbortController()
    controlesBusqueda.current[rol] = control
    const limite = window.setTimeout(() => control.abort(), 20000)
    setBuscando(actual => ({ ...actual, [rol]: true }))
    setBusquedas(actual => ({ ...actual, [rol]: null }))
    try {
      exigirAdminRevision(cuenta)
      const { data, error: fallo } = await supabase.from('operadores')
        .select('id,nombre,numero_empleado').eq('numero_empleado', numero).limit(2).abortSignal(control.signal)
      if (fallo) throw fallo
      control.signal.throwIfAborted()
      exigirAdminRevision(cuenta)
      const coincidencias = leerOperadores(data)
      const resultado = coincidencias.length > 1
        ? { numero, operador: null, mensaje: 'Ese número está duplicado en el catálogo. Pide que lo revisen.' }
        : coincidencias.length === 1
          ? { numero, operador: coincidencias[0], mensaje: null }
          : { numero, operador: null, mensaje: 'No se encontró un operador con ese número.' }
      setBusquedas(actual => ({ ...actual, [rol]: resultado }))
    } catch (e) {
      if (controlesBusqueda.current[rol] !== control) return
      const registro = e && typeof e === 'object' ? e as Record<string, unknown> : {}
      const mensaje = control.signal.aborted
        ? 'La búsqueda tardó demasiado. Presiona Enter para intentar de nuevo.'
        : typeof registro.message === 'string' ? registro.message : 'No se pudo consultar el número de empleado.'
      setBusquedas(actual => ({ ...actual, [rol]: { numero, operador: null, mensaje } }))
    } finally {
      window.clearTimeout(limite)
      if (controlesBusqueda.current[rol] === control) {
        controlesBusqueda.current[rol] = null
        setBuscando(actual => ({ ...actual, [rol]: false }))
      }
    }
  }

  function salir(guardado = false) {
    if (guardando) return
    if (guardado) cerrado.current = true
    if (dialogo.current?.open) dialogo.current.close()
    else alCerrar(cerrado.current)
  }

  async function guardar() {
    if (guardando || confirmado || (incierto && !solicitud.current)) return
    setGuardando(true); setError(null)
    const control = new AbortController()
    controlActivo.current = control
    const limite = window.setTimeout(() => control.abort(), 30000)
    try {
      exigirAdminRevision(cuenta)
      if (!solicitud.current) {
        if (!listoParaCapturar || !operadorPrincipal || !operadorAcompanante) throw new Error('Escribe dos números de empleado válidos y distintos y presiona Enter para buscarlos antes de guardar.')
        const datos = area === 'calderas'
          ? prepararDatosCalderas(borrador as BorradorBitacoraCalderas)
          : prepararDatosPTAR(borrador as BorradorBitacoraPTAR)
        solicitud.current = {
          id: crypto.randomUUID(), area, turno,
          numeroEmpleado: numeroNormalizado(numeroPrincipal),
          numeroEmpleadoAcompanante: numeroNormalizado(numeroAcompanante), datos,
        }
      }
      const envio = solicitud.current
      const { data, error: fallo } = await supabase.rpc('crear_reporte_tecnico_historico', {
        p_id: envio.id,
        p_fecha: fecha,
        p_area: envio.area,
        p_turno: envio.turno,
        p_numero_empleado: envio.numeroEmpleado,
        p_numero_empleado_acompanante: envio.numeroEmpleadoAcompanante,
        p_datos: envio.datos,
      }).abortSignal(control.signal)
      if (fallo) throw fallo
      control.signal.throwIfAborted()
      exigirAdminRevision(cuenta)
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('No se pudo validar la confirmación del servidor. Reintenta el mismo guardado.')
      const respuesta = data as RegistroRpc
      if (respuesta.id !== envio.id || respuesta.confirmado !== true) throw new Error('No se pudo validar la confirmación del servidor. Reintenta el mismo guardado.')
      solicitud.current = null
      setIncierto(false); setConfirmado(true)
    } catch (e) {
      const resultado = errorDeGuardado(e)
      if (!solicitud.current || resultado.definitivo) {
        solicitud.current = null
        setIncierto(false)
      } else setIncierto(true)
      setError(control.signal.aborted ? 'La confirmación tardó demasiado. Reintenta el mismo guardado; el servidor evitará duplicar el turno.' : resultado.mensaje)
    } finally {
      window.clearTimeout(limite); controlActivo.current = null; setGuardando(false)
    }
  }

  const nombres = operadorPrincipal && operadorAcompanante
    ? [operadorPrincipal.nombre, operadorAcompanante.nombre] : undefined

  return <>
    <dialog ref={dialogo} className="ct-alta-historica" aria-labelledby="ct-alta-historica-titulo"
      onCancel={evento => { if (guardando) evento.preventDefault() }}
      onClose={() => { controlActivo.current?.abort(); alCerrar(cerrado.current) }}>
      <div className="ct-alta-historica-marco" aria-busy={guardando}>
        <header className="ct-alta-historica-cabecera">
          <div><h2 id="ct-alta-historica-titulo">Agregar reporte técnico · {etiquetaArea[area]}</h2>
            <p>{fecha.split('-').reverse().join('/')} · {etiquetaArea[area]}</p></div>
          <button type="button" className="boton-secundario ct-alta-historica-cerrar" aria-label="Cerrar formulario" title="Cerrar"
            disabled={guardando} onClick={() => salir()}>×</button>
        </header>
        <div className="ct-alta-historica-cuerpo">
          <div className="ct-alta-historica-identidad">
            <label>Turno<select value={turno} disabled={bloqueado} onChange={e => setTurno(e.target.value as TipoTurno)}>
              {opcionesTurno.map(opcion => <option key={opcion} value={opcion}>{etiquetaTurno[opcion]}</option>)}
            </select></label>
            <label className="ct-alta-historica-operador">Número de empleado del operador
              <span className={`ct-alta-historica-operador-caja${operadorPrincipal ? ' ct-operador-encontrado' : ''}`}>
                <input value={numeroPrincipal} disabled={bloqueado} autoComplete="off" placeholder="Escribe el número y presiona Enter"
                  onChange={e => cambiarNumero('principal', e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void buscarOperador('principal') } }} />
                {buscando.principal && <span className="ct-alta-historica-busqueda" role="status">Buscando…</span>}
                {resultadoPrincipal?.operador && <span className="ct-alta-historica-nombre" role="status">{resultadoPrincipal.operador.nombre}</span>}
                {resultadoPrincipal?.mensaje && <span className="ct-alta-historica-error-operador" role="alert">{resultadoPrincipal.mensaje}</span>}
              </span>
            </label>
            <label className="ct-alta-historica-operador">Número de empleado del segundo operador
              <span className={`ct-alta-historica-operador-caja${operadorAcompanante ? ' ct-operador-encontrado' : ''}`}>
                <input value={numeroAcompanante} disabled={bloqueado} autoComplete="off" placeholder="Escribe el número y presiona Enter"
                  onChange={e => cambiarNumero('acompanante', e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void buscarOperador('acompanante') } }} />
                {buscando.acompanante && <span className="ct-alta-historica-busqueda" role="status">Buscando…</span>}
                {resultadoAcompanante?.operador && <span className="ct-alta-historica-nombre" role="status">{resultadoAcompanante.operador.nombre}</span>}
                {resultadoAcompanante?.mensaje && <span className="ct-alta-historica-error-operador" role="alert">{resultadoAcompanante.mensaje}</span>}
                {(numeroRepetido || operadorRepetido) && <span className="ct-alta-historica-error-operador" role="alert">Ingresa dos operadores distintos.</span>}
              </span>
            </label>
          </div>
          {listoParaCapturar && <>
            <p className="ct-alta-historica-ayuda">Transcribe el reporte del papel. El turno se guarda con su fecha y horario originales.</p>
            {area === 'calderas' && 'equipos' in borrador
              ? (() => {
                const capturaCalderas = {
                  borrador,
                  reporte: null,
                  editable: !bloqueado,
                  unidadPresion: 'kg/cm²' as const,
                  cambiarBorrador: (cambio: (actual: BorradorBitacoraCalderas) => BorradorBitacoraCalderas) => {
                    if (!bloqueado) setBorrador(actual => 'equipos' in actual ? cambio(actual) : actual)
                  },
                }
                return <div className="bc-panel"><FormularioBitacoraCalderas
                  completarAdministracion={{ guardando, confirmado, incierto, guardar: () => { void guardar() }, cerrar: () => salir(), contenidoFinal: null }}
                  captura={capturaCalderas} observaciones={null} nombresOperadores={nombres} /></div>
              })()
              : area === 'ptar' && 'bombas' in borrador
                ? (() => {
                  const capturaPTAR = {
                    borrador,
                    reporte: null,
                    editable: !bloqueado,
                    cambiarBorrador: (cambio: (actual: BorradorBitacoraPTAR) => BorradorBitacoraPTAR) => {
                      if (!bloqueado) setBorrador(actual => 'bombas' in actual ? cambio(actual) : actual)
                    },
                  }
                  return <div className="bpt-panel"><FormularioBitacoraPTAR
                    completarAdministracion={{ guardando, confirmado, incierto, guardar: () => { void guardar() }, cerrar: () => salir(), contenidoFinal: null }}
                    captura={capturaPTAR} observaciones={null} nombresOperadores={nombres} /></div>
                })() : null}
          </>}
          {error && <p role="alert" className="mensaje-error ct-alta-historica-error">{error}</p>}
        </div>
      </div>
    </dialog>
    <ConfirmacionGuardadoTecnico abierto={guardando || confirmado} guardando={guardando}
      alAceptar={() => salir(true)} />
  </>
}
