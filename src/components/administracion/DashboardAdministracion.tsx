import { RefreshCw } from 'lucide-react'
import { createPortal } from 'react-dom'
import { StatusBadge } from '../diseno/Elementos'
import { useDashboardAdministracion } from '../../hooks/useDashboardAdministracion'
import { modulosArea, nombresModuloDashboard } from '../../lib/dashboardAdministracion'
import { nombresTurno } from '../../lib/planta'
import { useInformacionDia } from '../../hooks/useInformacionDia'
import { InformacionDelDia } from '../operativo/InformacionDelDia'
import { ResumenPendientesDashboard } from './ResumenPendientesDashboard'
import { AlmacenamientoDashboard } from './AlmacenamientoDashboard'
import './dashboardAdministracion.css'

export function DashboardAdministracion({ contenedorAcciones }: { contenedorAcciones: HTMLDivElement | null }) {
  const { cuenta, datos, cargando, error, actualizar } = useDashboardAdministracion()
  const informacionDia = useInformacionDia('todas', datos?.fecha ?? null)
  if (!cuenta) return null
  const activos = datos?.turnos.valor
  const completo = activos && activos.total === activos.filas.length
  return <div className="co-admin-dashboard" aria-busy={cargando}>
    {contenedorAcciones && createPortal(<button className="boton-secundario" type="button" disabled={cargando} onClick={actualizar} data-actualizar="true" aria-label={cargando ? 'Actualizando dashboard…' : 'Actualizar dashboard'} title="Actualizar dashboard"><RefreshCw size={18} style={{ width: 18, height: 18, flexShrink: 0 }} aria-hidden="true" /></button>, contenedorAcciones)}
    {error && <p className="mensaje-error" role="alert">{error}</p>}
    <div className="co-dashboard-cuerpo">
    <section className="panel-informacion co-dashboard-estado" aria-labelledby="dashboard-estado"><h2 id="dashboard-estado">Estado actual por área</h2>
      {datos?.turnos.error ? <p className="mensaje-error" role="alert">{datos.turnos.error}</p> : <>
        {!cargando && activos && !completo && <p className="ayuda-turno">Se muestran los 50 turnos activos más recientes. El total de módulos pendientes no está disponible.</p>}
        <div className="co-dashboard-areas">{(['calderas', 'ptar'] as const).map(area => {
          const turnos = activos?.filas.filter(t => t.turno.area === area) ?? []
          return <article className="co-dashboard-area" key={area}>
            <div className="co-dashboard-area-encabezado"><h3>{area === 'calderas' ? 'Calderas' : 'PTAR'}</h3>{turnos.length > 0 && <StatusBadge tono="success">Activo</StatusBadge>}</div>
            {!turnos.length ? <p className="ayuda-turno">{cargando ? 'Consultando…' : !activos ? 'Información no disponible' : !completo ? 'Sin turnos en los resultados mostrados' : 'Sin turno activo'}</p> : turnos.map(t => {
              const total = modulosArea[area].length, avance = Math.round(t.completados.length / total * 100)
              const faltan = modulosArea[area].filter(m => !t.completados.includes(m))
              return <div className="co-dashboard-turno" key={t.turno.id}><div className="co-dashboard-turno-encabezado"><strong>Turno {nombresTurno[t.turno.turno]}</strong></div>
                <p className="co-dashboard-operador">{t.operadorNombre.split(' · ').map((nombre, indice) => <span key={`${indice}-${nombre}`}>{nombre}</span>)}</p><p className="ayuda-turno">Fecha operativa: {t.turno.fecha_operativa.split('-').reverse().join('/')}</p>
                <div className="co-dashboard-avance"><span>{t.completados.length} de {total} módulos con captura</span><strong>{avance}%</strong></div>
                <progress max={total} value={t.completados.length} aria-label={`Avance de módulos de ${t.operadorNombre} en ${area}`} />
                <p className="ayuda-turno">{faltan.length ? `Pendientes: ${faltan.map(m => nombresModuloDashboard[m]).join(', ')}` : 'Todos los módulos tienen captura.'}</p></div>
            })}</article>
        })}</div></>}
    </section>
    <div className="co-dashboard-dia"><InformacionDelDia fecha={datos?.fecha ?? null} informacion={informacionDia} compacto />
      <ResumenPendientesDashboard key={`${cuenta}:${datos?.fecha ?? ''}:${datos?.consultado ?? ''}`} cuenta={cuenta} fecha={datos?.fecha ?? null} />
      {datos && <AlmacenamientoDashboard cuenta={cuenta} revision={String(datos.consultado)} />}
    </div>
    </div>
  </div>
}
