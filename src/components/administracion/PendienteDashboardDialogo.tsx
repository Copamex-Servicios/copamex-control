import { useEffect, useRef, useState } from 'react'
import type { PendienteTecnico } from '../../lib/reporteOperativo'
import { consultarTecnicoAdmin, pendienteTecnica } from '../../lib/revisionTecnica'
import type { DetalleTecnicoAdmin, FilaTecnicaAdmin } from '../../lib/revisionTecnica'
import { EditorTecnico } from './GestionRegistrosAdministracion'
import { CompletarPendiente } from './PendientesTecnicos'

export function PendienteDashboardDialogo({ cuenta, turno, cerrar }: {
  cuenta: string; turno: PendienteTecnico; cerrar: () => void
}) {
  const dialogo = useRef<HTMLDialogElement>(null)
  const [detalle, setDetalle] = useState<DetalleTecnicoAdmin | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [intento, setIntento] = useState(0)
  useEffect(() => {
    const elemento = dialogo.current
    elemento?.showModal()
    const previo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { elemento?.close(); document.body.style.overflow = previo }
  }, [])
  useEffect(() => {
    if (!turno.reporte_id) return
    let vigente = true
    const control = new AbortController()
    const limite = window.setTimeout(() => control.abort(), 20000)
    const fila: FilaTecnicaAdmin = {
      id: turno.reporte_id, turnoId: turno.turno_id, area: turno.area,
      fechaOperativa: turno.fecha_operativa, turno: turno.turno,
      operador: [turno.operador, turno.operador_acompanante].filter(Boolean).join(' · '),
      revision: turno.revision!, creadoEn: turno.creado_en!,
    }
    void (async () => {
      const pendiente = pendienteTecnica(cuenta)
      if (pendiente && pendiente.detalle.fila.id !== fila.id) {
        throw new Error('Confirma primero la corrección pendiente en Capturas antes de abrir otro reporte.')
      }
      return pendiente?.detalle ?? await consultarTecnicoAdmin(cuenta, fila, control.signal)
    })().then(d => { if (vigente) { setDetalle(d); setError(null) } })
      .catch(e => { if (vigente) setError(e instanceof Error ? e.message : 'No se pudo abrir el reporte.') })
      .finally(() => window.clearTimeout(limite))
    return () => { vigente = false; control.abort(); window.clearTimeout(limite) }
  }, [cuenta, turno, intento])

  return <dialog ref={dialogo} className="co-pendiente-dialogo" aria-labelledby="co-pendiente-dialogo-titulo"
    onCancel={e => {
      e.preventDefault()
      if (!dialogo.current?.querySelector('[aria-busy="true"]') && !pendienteTecnica(cuenta)) cerrar()
    }}>
    <h2 id="co-pendiente-dialogo-titulo">Reporte pendiente · {turno.area === 'ptar' ? 'PTAR' : 'Calderas'}</h2>
    {!turno.reporte_id
      ? <CompletarPendiente cuenta={cuenta} turno={turno} cerrar={cerrar} />
      : detalle
        ? <EditorTecnico cuenta={cuenta} detalle={detalle} cerrar={cerrar} guardado={setDetalle} iniciarEdicion />
        : <div>{error ? <><p role="alert">{error}</p><button type="button" className="boton-secundario" onClick={() => { setError(null); setIntento(n => n + 1) }}>Reintentar</button></>
          : <p role="status">Consultando reporte técnico…</p>}
          <button type="button" className="boton-secundario" onClick={cerrar}>Cerrar</button></div>}
  </dialog>
}
