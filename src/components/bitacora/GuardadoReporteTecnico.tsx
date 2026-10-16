import { useEffect, useId, useRef, useState } from 'react'
import './guardadoReporteTecnico.css'

interface CapturaReporte {
  estado: 'sin-consultar' | 'cargando' | 'listo' | 'error'
  puedeGuardar: boolean
  guardando: boolean
  pendiente: unknown
  reporte: object | null
  mensaje: string | null
  guardar: () => Promise<true | undefined>
  actualizar: () => void
}

/** Presenta el resultado del guardado existente; no envía solicitudes por su cuenta. */
export function GuardadoReporteTecnico({ captura, descripcionId, alIntentar }: {
  captura: CapturaReporte; descripcionId: string; alIntentar: () => void
}) {
  const id = useId()
  const dialogo = useRef<HTMLDialogElement>(null)
  const aceptar = useRef<HTMLButtonElement>(null)
  const procesando = useRef(false)
  const [resultado, setResultado] = useState<{ terminado: boolean; confirmado?: boolean; error?: string } | null>(null)
  const abierto = resultado !== null
  const cargando = abierto && (!resultado.terminado || captura.guardando)
  const exito = abierto && !cargando && resultado.confirmado === true && !resultado.error && !!captura.reporte
  const mensajeError = resultado?.error || captura.mensaje || 'No se pudo confirmar el guardado. Conservamos tus datos; revisa el reporte y vuelve a intentar.'

  useEffect(() => {
    const elemento = dialogo.current
    if (abierto && elemento && !elemento.open) elemento.showModal()
    return () => { if (elemento?.open) elemento.close() }
  }, [abierto])
  useEffect(() => {
    if (!abierto) return
    if (cargando) dialogo.current?.focus()
    else aceptar.current?.focus()
  }, [abierto, cargando])

  async function guardar() {
    if (procesando.current || captura.guardando || !captura.puedeGuardar || captura.reporte) return
    procesando.current = true
    setResultado({ terminado: false })
    try {
      alIntentar()
      const confirmado = await captura.guardar()
      setResultado({ terminado: true, confirmado: confirmado === true })
    } catch (error) {
      setResultado({ terminado: true, error: error instanceof Error ? error.message : 'No se pudo confirmar el guardado. Reintenta con los datos capturados.' })
    } finally { procesando.current = false }
  }

  return <>
    {captura.estado === 'error' ? <button type="button" className="boton-secundario" onClick={captura.actualizar}>Reintentar consulta técnica</button>
      : !captura.reporte && <button type="button" className="boton-primario" disabled={!captura.puedeGuardar || captura.guardando || cargando}
        onClick={() => { void guardar() }} aria-describedby={descripcionId}>
        {captura.guardando || cargando ? 'Guardando…' : captura.pendiente ? 'Reintentar envío original' : 'Guardar reporte técnico'}
      </button>}
    <dialog ref={dialogo} className="co-guardado-reporte" aria-labelledby={`${id}-titulo`} aria-describedby={`${id}-mensaje`}
      aria-busy={cargando} tabIndex={-1} onCancel={e => { e.preventDefault(); if (!cargando) setResultado(null) }}>
      {abierto && <>
        <div className="co-guardado-reporte-estado" role="status" aria-live="polite" aria-atomic="true">
          {cargando ? <span className="co-guardado-reporte-cargando" aria-hidden="true" /> : exito ? <svg className="co-guardado-reporte-exito" viewBox="0 0 56 56" fill="none" aria-hidden="true"><circle cx="28" cy="28" r="27" fill="currentColor" fillOpacity=".1" /><path d="m17 28 7 7 15-15" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" /></svg> : null}
          <h2 id={`${id}-titulo`}>{cargando ? 'Guardando reporte técnico...' : exito ? '¡Reporte guardado correctamente!' : 'No se pudo guardar el reporte'}</h2>
          <p id={`${id}-mensaje`} role={!cargando && !exito ? 'alert' : undefined}>{cargando ? 'Espera la confirmación del servidor.' : exito
            ? 'El reporte fue registrado y ahora está en modo de solo lectura' : mensajeError}</p>
        </div>
        {!cargando && <button ref={aceptar} type="button" className="boton-primario" onClick={() => setResultado(null)}>{exito ? 'Aceptar' : 'Cerrar'}</button>}
      </>}
    </dialog>
  </>
}
