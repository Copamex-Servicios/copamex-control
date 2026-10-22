import { RefreshCw } from 'lucide-react'
import { Card, StatusBadge } from '../diseno/Elementos'
import { useDashboardAdministracion } from '../../hooks/useDashboardAdministracion'
import { modulosArea, nombresModuloDashboard } from '../../lib/dashboardAdministracion'
import { nombresTurno } from '../../lib/planta'
import './dashboardAdministracion.css'

const formato = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
function Hora({ fecha }: { fecha: string }) { return <time dateTime={fecha}>{formato.format(new Date(fecha))}</time> }

export function DashboardAdministracion() {
  const { cuenta, datos, cargando, error, actualizar } = useDashboardAdministracion()
  if (!cuenta) return null
  const activos = datos?.turnos.valor
  const completo = activos && activos.total === activos.filas.length
  const sinTurnoActivo = completo && activos.total === 0
  const pendientes = completo && activos.total > 0 ? activos.filas.reduce((n, t) => n + modulosArea[t.turno.area].length - t.completados.length, 0) : null
  const indicadores = [
    { titulo: 'Turnos activos', numero: activos?.total },
    { titulo: 'Alertas abiertas', numero: datos?.abiertas.valor },
    { titulo: 'Capturas realizadas hoy', numero: datos?.capturas.valor },
    { titulo: 'Módulos pendientes', numero: sinTurnoActivo ? 'Sin turno activo' : pendientes },
  ]
  return <div className="co-admin-dashboard" aria-busy={cargando}>
    <div className="planta-encabezado co-dashboard-barra"><div><h2>Dashboard</h2><p className="ayuda-turno">{datos ? <>Actualizado <Hora fecha={datos.consultado} /> · México</> : 'Estado actual del sistema'}</p></div>
      <button className="boton-secundario" type="button" disabled={cargando} onClick={actualizar} data-actualizar="true" aria-label={cargando ? 'Actualizando…' : 'Actualizar'} title="Actualizar"><RefreshCw size={18} style={{ width: 18, height: 18, flexShrink: 0 }} aria-hidden="true" /></button></div>
    {error && <p className="mensaje-error" role="alert">{error}</p>}
    <div className="co-dashboard-indicadores">{indicadores.map(({ titulo, numero }) => <Card key={titulo} className="co-dashboard-indicador"><div><span>{titulo}</span></div><strong className={typeof numero === 'string' ? 'co-dashboard-indicador-estado' : undefined}>{cargando && !datos ? '…' : numero === null || numero === undefined ? '—' : typeof numero === 'string' ? numero : numero.toLocaleString('es-MX')}</strong></Card>)}</div>
    {datos?.abiertas.error && <p className="mensaje-error" role="alert">{datos.abiertas.error}</p>}
    {datos?.capturas.error && <p className="mensaje-error" role="alert">{datos.capturas.error}</p>}
    <section className="panel-informacion" aria-labelledby="dashboard-estado"><h2 id="dashboard-estado">Estado actual por área</h2>
      {datos?.turnos.error ? <p className="mensaje-error" role="alert">{datos.turnos.error}</p> : <>
        {!cargando && activos && !completo && <p className="ayuda-turno">Se muestran los 50 turnos activos más recientes. El total de módulos pendientes no está disponible.</p>}
        <div className="co-dashboard-areas">{(['calderas', 'ptar'] as const).map(area => {
          const turnos = activos?.filas.filter(t => t.turno.area === area) ?? []
          return <article className={`co-dashboard-area${!cargando && completo && !turnos.length ? ' co-dashboard-area-sin-turno' : ''}`} key={area}><h3>{area === 'calderas' ? 'Calderas' : 'PTAR'}</h3>
            {!turnos.length ? <p className="ayuda-turno">{cargando ? 'Consultando…' : !activos ? 'Información no disponible' : !completo ? 'Sin turnos en los resultados mostrados' : 'Sin turno activo'}</p> : turnos.map(t => {
              const total = modulosArea[area].length, avance = Math.round(t.completados.length / total * 100)
              const faltan = modulosArea[area].filter(m => !t.completados.includes(m))
              return <div className="co-dashboard-turno" key={t.turno.id}><div className="co-dashboard-turno-encabezado"><strong>Turno {nombresTurno[t.turno.turno]}</strong><StatusBadge tono="success">Activo</StatusBadge></div>
                <p className="co-dashboard-operador">{t.operadorNombre}</p><p className="ayuda-turno">Fecha operativa: {t.turno.fecha_operativa.split('-').reverse().join('/')}</p>
                <div className="co-dashboard-avance"><span>{t.completados.length} de {total} módulos con captura</span><strong>{avance}%</strong></div>
                <progress max={total} value={t.completados.length} aria-label={`Avance de módulos de ${t.operadorNombre} en ${area}`} />
                <p className="ayuda-turno">{faltan.length ? `Pendientes: ${faltan.map(m => nombresModuloDashboard[m]).join(', ')}` : 'Todos los módulos tienen captura.'}</p></div>
            })}</article>
        })}</div></>}
    </section>
  </div>
}
