import { useEffect, useState } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { consultarDatosTurno, ErrorTurnos } from '../../lib/turnos'
import type { DatosConsultadosTurno } from '../../lib/turnos'
import type { AreaOperativa } from '../../lib/tiposTurno'
import { TurnoActivo } from './TurnoActivo'

interface PropsConsultaTurno {
  area: AreaOperativa
}

interface VistaConsulta {
  estado: 'cargando' | 'listo' | 'error'
  datos: DatosConsultadosTurno | null
  mensaje: string | null
}

function puedeConsultar(cuentaId: string): boolean {
  const { estado, sesion, perfil } = useAuthStore.getState()
  return estado === 'autenticado' && sesion?.user.id === cuentaId
    && perfil?.id === cuentaId && perfil.activo === true && perfil.rol === 'admin'
}

function ConsultaAutorizada({ area, cuentaId }: PropsConsultaTurno & { cuentaId: string }) {
  const [revision, setRevision] = useState(0)
  const [vista, setVista] = useState<VistaConsulta>({ estado: 'cargando', datos: null, mensaje: null })

  useEffect(() => {
    let activo = true
    let numeroConsulta = 0
    let consultaActiva: AbortController | null = null
    let vueltaPendiente: number | null = null
    let teniaAcceso = puedeConsultar(cuentaId)

    function cancelarConsulta(): void {
      numeroConsulta += 1
      consultaActiva?.abort()
      consultaActiva = null
    }

    async function cargar(conservarVista = false): Promise<void> {
      if (!activo || !puedeConsultar(cuentaId)) return
      cancelarConsulta()
      const numero = numeroConsulta
      const control = new AbortController()
      consultaActiva = control
      setVista((anterior) => conservarVista && anterior.estado === 'listo'
        ? anterior : { estado: 'cargando', datos: null, mensaje: null })

      let temporizador: number | null = null
      let alCancelar: (() => void) | null = null
      const limite = new Promise<never>((_resolver, rechazar) => {
        alCancelar = () => rechazar(new ErrorTurnos('La consulta fue cancelada.'))
        control.signal.addEventListener('abort', alCancelar, { once: true })
        temporizador = window.setTimeout(() => {
          rechazar(new ErrorTurnos('La consulta tardó demasiado. Revisa la conexión e intenta de nuevo.'))
          control.abort()
        }, 15000)
      })

      try {
        const datos = await Promise.race([consultarDatosTurno(area, control.signal), limite])
        if (!activo || numero !== numeroConsulta || !puedeConsultar(cuentaId)) return
        setVista({ estado: 'listo', datos, mensaje: null })
      } catch (fallo) {
        if (!activo || numero !== numeroConsulta || !puedeConsultar(cuentaId)) return
        setVista({
          estado: 'error', datos: null,
          mensaje: fallo instanceof ErrorTurnos ? fallo.message : 'No se pudo consultar el turno. Reintenta.',
        })
      } finally {
        if (temporizador !== null) window.clearTimeout(temporizador)
        if (alCancelar) control.signal.removeEventListener('abort', alCancelar)
        if (consultaActiva === control) consultaActiva = null
        control.abort()
      }
    }

    const alCambiarCuenta = () => {
      if (!activo) return
      const autorizado = puedeConsultar(cuentaId)
      if (!autorizado) {
        cancelarConsulta()
        setVista({ estado: 'cargando', datos: null, mensaje: null })
      } else if (!teniaAcceso) {
        void cargar()
      }
      teniaAcceso = autorizado
    }

    const alVolver = () => {
      if (!activo || document.visibilityState !== 'visible' || !puedeConsultar(cuentaId)
        || consultaActiva || vueltaPendiente !== null) return
      vueltaPendiente = window.setTimeout(() => {
        vueltaPendiente = null
        if (activo && document.visibilityState === 'visible' && puedeConsultar(cuentaId)) void cargar(true)
      }, 0)
    }

    const desuscribir = useAuthStore.subscribe(alCambiarCuenta)
    window.addEventListener('focus', alVolver)
    document.addEventListener('visibilitychange', alVolver)
    void cargar()

    return () => {
      activo = false
      desuscribir()
      window.removeEventListener('focus', alVolver)
      document.removeEventListener('visibilitychange', alVolver)
      if (vueltaPendiente !== null) window.clearTimeout(vueltaPendiente)
      cancelarConsulta()
    }
  }, [area, cuentaId, revision])

  const turno = vista.datos?.turno ?? null
  const nombre = turno
    ? vista.datos?.operadores.find((operador) => operador.id === turno.operador_id)?.nombre
    : null

  return (
    <section className="panel-informacion panel-turno" aria-label={`Consulta del turno de ${area === 'calderas' ? 'Calderas' : 'PTAR'}`}>
      <div className="cabecera-turno">
        <h2>Consulta del turno</h2>
        <button className="boton-secundario" type="button" disabled={vista.estado === 'cargando'}
          onClick={() => setRevision((anterior) => anterior + 1)}>
          {vista.estado === 'error' ? 'Reintentar consulta' : 'Actualizar'}
        </button>
      </div>
      {vista.estado === 'cargando' && <p role="status">Consultando el turno…</p>}
      {vista.estado === 'error' && <p className="mensaje-error" role="alert">{vista.mensaje}</p>}
      {vista.estado === 'listo' && (
        turno ? (
          nombre ? (
            <TurnoActivo key={turno.id} turno={turno} nombreOperador={nombre}
              operadores={vista.datos?.operadores ?? []} soloLectura />
          ) : <p className="mensaje-error" role="alert">Actualiza el turno para consultar el nombre del operador.</p>
        ) : <p className="texto-secundario">No hay un turno abierto en esta área.</p>
      )}
    </section>
  )
}

export function ConsultaTurno({ area }: PropsConsultaTurno) {
  const { estado, sesion, perfil } = useAuthStore()
  if (estado !== 'autenticado' || !sesion || !perfil || perfil.activo !== true
    || perfil.id !== sesion.user.id || perfil.rol !== 'admin') return null

  return <ConsultaAutorizada key={`${perfil.id}:${area}`} area={area} cuentaId={perfil.id} />
}
