import { RefreshCw } from 'lucide-react'
import './avisosCompactos.css'
import { useId } from 'react'
import type { useInformacionDia } from '../../hooks/useInformacionDia'

export function AvisosVisibles({ fecha, informacion }: {
  fecha: string | null
  informacion: ReturnType<typeof useInformacionDia>
}) {
  const titulo = useId()
  const { datos, cargando, actualizar } = informacion
  const error = !!fecha && !!datos?.avisos.error
  const avisos = error ? [] : datos?.avisos.elementos ?? []
  const vacio = !!fecha && !!datos && !error && avisos.length === 0
  return <section className={`avisos-visibles${avisos.length > 0 ? ' avisos-visibles-activos' : ''}${error ? ' avisos-visibles-error' : vacio ? ' avisos-visibles-sin' : ''}`}
    aria-labelledby={titulo}>
    <div className="avisos-visibles-cabecera">
      <h2 id={titulo}>Avisos vigentes{avisos.length > 0 ? ` (${avisos.length})` : ''}</h2>
      <button type="button" className="boton-secundario" onClick={actualizar}
        disabled={!fecha || cargando} aria-label="Actualizar avisos de operación" data-actualizar="true" title="Actualizar"><RefreshCw size={18} style={{ width: 18, height: 18, flexShrink: 0 }} aria-hidden="true" /></button>
    </div>
    {!fecha ? <p className="avisos-visibles-estado" role="status">Esperando la fecha del servidor…</p>
      : error ? <p className="avisos-visibles-estado" role="alert">No se pudieron consultar los avisos. Pulsa Actualizar.</p>
      : !datos ? <p className="avisos-visibles-estado" role="status">Consultando avisos…</p>
      : vacio ? <p className="avisos-visibles-estado">Sin avisos vigentes para tu área.</p>
      : <div className="avisos-visibles-lista" tabIndex={0} role="region" aria-label="Contenido de los avisos de operación">
        {avisos.map(aviso => <p key={aviso.id} className="avisos-visibles-mensaje">{aviso.mensaje}</p>)}
      </div>}
  </section>
}
