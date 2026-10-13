import { Activity, AlertCircle, ClipboardCheck, Clock3, RefreshCw } from 'lucide-react'
import { Card, StatusBadge } from '../diseno/Elementos'
import { useDashboardAdministracion } from '../../hooks/useDashboardAdministracion'
import { modulosArea } from '../../lib/dashboardAdministracion'
import { nombresModulo, nombresTurno } from '../../lib/planta'
import './dashboardAdministracion.css'

const formato = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
function Hora({ fecha }: { fecha: string }) { return <time dateTime={fecha}>{formato.format(new Date(fecha))}</time> }

export function DashboardAdministracion() {
  const { cuenta, datos, cargando, error, actualizar } = useDashboardAdministracion()
  if (!cuenta) return null
  const activos = datos?.turnos.valor
  const completo = activos && activos.total === activos.filas.length
  const pendientes = completo ? activos.filas.reduce((n, t) => n + modulosArea[t.turno.area].length - t.completados.length, 0) : null
  const indicadores = [
    { titulo: 'Turnos activos', numero: activos?.total, Icon: Clock3 },
    { titulo: 'Alertas abiertas', numero: datos?.abiertas.valor, Icon: AlertCircle },
    { titulo: 'Capturas realizadas hoy', numero: datos?.capturas.valor, Icon: ClipboardCheck },
    { titulo: 'Módulos pendientes', numero: pendientes, Icon: Activity },
  ]
  return <div className="co-admin-dashboard" aria-busy={cargando}>
    <div className="planta-encabezado co-dashboard-barra"><div><h2>Dashboard</h2><p className="ayuda-turno">{datos ? <>Actualizado <Hora fecha={datos.consultado} /> · México</> : 'Estado actual del sistema'}</p></div>
      <button className="boton-secundario" type="button" disabled={cargando} onClick={actualizar}><RefreshCw size={17} />{cargando ? 'Actualizando…' : 'Actualizar Dashboard'}</button></div>
    {error && <p className="mensaje-error" role="alert">{error}</p>}
    <div className="co-dashboard-indicadores">{indicadores.map(({ titulo, numero, Icon }) => <Card key={titulo} className="co-dashboard-indicador"><div><Icon size={19} /><span>{titulo}</span></div><strong>{cargando ? '…' : numero === null || numero === undefined ? '—' : numero.toLocaleString('es-MX')}</strong></Card>)}</div>
    {datos?.abiertas.error && <p className="mensaje-error" role="alert">{datos.abiertas.error}</p>}
    {datos?.capturas.error && <p className="mensaje-error" role="alert">{datos.capturas.error}</p>}
    <section className="panel-informacion" aria-labelledby="dashboard-estado"><h2 id="dashboard-estado">Estado actual por área</h2>
      {datos?.turnos.error ? <p className="mensaje-error" role="alert">{datos.turnos.error}</p> : <>
        {!cargando && activos && !completo && <p className="ayuda-turno">Se muestran los 50 turnos activos más recientes. El total de módulos pendientes no está disponible.</p>}
        <div className="co-dashboard-areas">{(['calderas', 'ptar'] as const).map(area => {
          const turnos = activos?.filas.filter(t => t.turno.area === area) ?? []
          return <article className="co-dashboard-area" key={area}><h3>{area === 'calderas' ? 'Calderas' : 'PTAR'}</h3>
            {!turnos.length ? <p className="ayuda-turno">{cargando ? 'Consultando…' : !activos ? 'Información no disponible' : !completo ? 'Sin turnos en los resultados mostrados' : 'Sin turno activo'}</p> : turnos.map(t => {
              const total = modulosArea[area].length, avance = Math.round(t.completados.length / total * 100)
              const faltan = modulosArea[area].filter(m => !t.completados.includes(m))
              return <div className="co-dashboard-turno" key={t.turno.id}><div className="co-dashboard-turno-encabezado"><strong>Turno {nombresTurno[t.turno.turno]}</strong><StatusBadge tono="success">Activo</StatusBadge></div>
                <p className="co-dashboard-operador">{t.operadorNombre}</p><p className="ayuda-turno">Fecha operativa: {t.turno.fecha_operativa.split('-').reverse().join('/')}</p>
                <div className="co-dashboard-avance"><span>{t.completados.length} de {total} módulos con captura</span><strong>{avance}%</strong></div>
                <progress max={total} value={t.completados.length} aria-label={`Avance de módulos de ${t.operadorNombre} en ${area}`} />
                <p className="ayuda-turno">{faltan.length ? `Pendientes: ${faltan.map(m => nombresModulo[m]).join(', ')}` : 'Todos los módulos tienen captura.'}</p></div>
            })}</article>
        })}</div><p className="ayuda-turno co-dashboard-nota">Avance por turno: al menos una captura vigente por módulo.</p></>}
    </section>
    <section className="panel-informacion" aria-labelledby="dashboard-alertas"><h2 id="dashboard-alertas">Alertas recientes</h2>
      {datos?.alertas.error ? <p className="mensaje-error" role="alert">{datos.alertas.error}</p> : <ul className="co-dashboard-lista">{datos?.alertas.valor?.map(a => <li key={a.id}><div><strong>Calidad · {a.detalle.area === 'calderas' ? 'Calderas' : 'PTAR'}</strong><p>{a.mensaje}</p></div><div className="co-dashboard-meta"><StatusBadge tono="warning">{a.estado === 'abierta' ? 'Abierta' : 'Reconocida'}</StatusBadge><Hora fecha={a.creado_en} /></div></li>)}</ul>}
      {!datos?.alertas.valor?.length && !datos?.alertas.error && <p className="ayuda-turno">{cargando ? 'Consultando…' : datos?.alertas.valor ? 'Sin alertas pendientes de atención.' : 'Información no disponible'}</p>}
    </section>
    <section className="panel-informacion" aria-labelledby="dashboard-actividad"><h2 id="dashboard-actividad">Actividad reciente</h2>
      {datos?.actividadParcial && <p className="mensaje-error" role="alert">Actividad parcial: alguna fuente no está disponible.</p>}
      <ul className="co-dashboard-lista">{datos?.actividad.map(a => <li key={a.id}><div><strong>{a.tipo}</strong><p>{a.descripcion}</p></div><Hora fecha={a.fecha} /></li>)}</ul>
      {!datos?.actividad.length && <p className="ayuda-turno">{cargando ? 'Consultando…' : !datos ? 'Información no disponible' : datos.actividadParcial ? 'No se pudo consultar actividad reciente.' : 'Sin actividad registrada.'}</p>}
    </section>
  </div>
}
