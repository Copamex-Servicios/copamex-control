import { CONCESION_ANUAL_POZOS } from '../../lib/concesionPozos'
import { useConcesionPozos } from '../../hooks/useConcesionPozos'
import './monitorConcesionPozos.css'

const numero = (valor: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(valor)

export function MonitorConcesionPozos({ revision, supervision = false }: { revision: number; supervision?: boolean }) {
  const { resumen, cargando, error, anio, actualizadoEn } = useConcesionPozos(revision)
  const porcentaje = resumen ? new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(resumen.porcentaje) : null
  return <section className="monitor-concesion" aria-label="Monitor anual de Pozos" aria-busy={cargando}>
    <header>{supervision ? <><div><h3>Monitor anual de Pozos</h3><span>Enero–diciembre {anio} · Pozo 1 y Pozo 2</span></div><span className="supervision-monitor-actualizado">Última actualización: {actualizadoEn ? new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'short', timeStyle: 'short' }).format(new Date(actualizadoEn)) : 'Pendiente'}</span></> : <><h3>Monitor de Pozos</h3><span>Enero–diciembre {anio} · Pozo 1 y Pozo 2</span></>}</header>
    <div className="monitor-concesion-datos">
      <div><span>Concesión anual</span><strong>{numero(CONCESION_ANUAL_POZOS)} m³</strong></div>
      <div><span>Acumulado registrado</span><strong>{resumen ? `${numero(resumen.acumulado)} m³` : '—'}</strong></div>
      <div><span>Restante</span><strong>{resumen ? `${numero(resumen.restante)} m³` : '—'}</strong></div>
    </div>
    {resumen && <><progress max={CONCESION_ANUAL_POZOS} value={Math.min(resumen.acumulado, CONCESION_ANUAL_POZOS)}
      aria-label="Consumo de la concesión anual" aria-valuetext={`${porcentaje}% consumido`} />
      <div className="monitor-concesion-pie"><span>{porcentaje}% consumido</span><span>{resumen.lecturas} {resumen.lecturas === 1 ? 'lectura registrada' : 'lecturas registradas'}</span></div>
      {resumen.excedente > 0 && <p className="monitor-concesion-exceso" role="status">Concesión superada en {numero(resumen.excedente)} m³.</p>}</>}
    {cargando && <p role="status">Consultando consumo anual…</p>}
    {error && <p className="monitor-concesion-error" role="alert">{error}</p>}
  </section>
}
