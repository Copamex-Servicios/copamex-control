import type { ReporteTecnicoCalderas } from '../../lib/bitacoraTecnicaCalderas'
import { equiposAguaCalderas, equiposCalderas, pilasCalderas } from '../../lib/tiposBitacoraCalderas'
import { fechaHoraBitacora } from '../../lib/formatoBitacora'
import { Seccion, Estado, Dato } from './PresentacionReportePlanta'

/** Presentación de consulta exclusiva de las tarjetas de Calderas en Planta. */
export function DetalleReporteCalderasPlanta({ reporte }: { reporte: ReporteTecnicoCalderas }) {
  const b = reporte.borrador, m = b.mediciones
  return <div className="bc-detalle-tecnico planta-calderas-detalle planta-reporte-detalle">
    <div className="pcr-metadatos">
      <p>Registrado: {fechaHoraBitacora(reporte.creadoEn)} (México) · Revisión {reporte.revision}</p>
      <span>Solo consulta</span>
    </div>
    {reporte.versionFormato === 1 && <p className="pcr-formato-anterior">
      Formato anterior: unidades originales PSI en Sulzer y condensado, sin conversiones.
      El estado de bombas de agua potable y pozos no se capturaba en este formato.
    </p>}
    <div className="pcr-secciones">
      <Seccion titulo="Reporte relevante del turno">
        <p className={`pcr-narrativa${b.reporteRelevante ? '' : ' pcr-vacio'}`}>{b.reporteRelevante || 'Sin registrar'}</p>
      </Seccion>

      <Seccion titulo="Calderas y bombas">
        <dl className="pcr-equipos">{equiposCalderas.map(e => <div className="pcr-equipo" key={e.id}>
          <dt>{e.nombre}</dt><dd>
            <Estado valor={b.equipos[e.id].estado} />
            {e.id.startsWith('sulzer_') && <span className="pcr-presion-equipo">
              <span>Presión ({reporte.unidadCondensado})</span>
              <strong className={b.equipos[e.id].presion === '' ? 'pcr-vacio' : undefined}>{b.equipos[e.id].presion === '' ? 'Sin lectura' : b.equipos[e.id].presion}</strong>
            </span>}
          </dd>
        </div>)}</dl>
      </Seccion>

      <Seccion titulo="Condensado y ósmosis">
        <dl className="pcr-datos pcr-mediciones">
          <Dato nombre="Nivel del tanque de condensado" valor={m.nivel_condensado} unidad="%" />
          <Dato nombre="Bomba de condensado 432 · Presión" valor={m.presion_432} unidad={reporte.unidadCondensado} />
          <Dato nombre="Bomba de condensado 433 · Presión" valor={m.presion_433} unidad={reporte.unidadCondensado} />
          <Dato nombre="Bomba de ósmosis 422 · Presión" valor={m.presion_422} unidad="PSI" />
          <Dato nombre="Bomba de ósmosis 424 · Presión" valor={m.presion_424} unidad="PSI" />
          <Dato nombre="Flujo de ósmosis" valor={m.flujo_osmosis} unidad="GPM" />
        </dl>
      </Seccion>

      <Seccion titulo="Ultrafiltración">
        <dl className="pcr-datos pcr-ultrafiltracion">
          <Dato nombre="Flujo de entrada" valor={m.flujo_uf} unidad="m³/h" />
          <Dato nombre="Nivel del Rotoplas de entrada" valor={m.nivel_rotoplas} unidad="%" />
          <div className="pcr-dato"><dt>Estado de la UF</dt><dd><Estado valor={b.estadoUF} /></dd></div>
          <Dato nombre="Comentarios relevantes de Ultrafiltración" valor={b.comentariosUF} vacio="Sin registrar" />
        </dl>
      </Seccion>

      <Seccion titulo="Compresores">
        <dl className="pcr-datos pcr-compresores">
          {(['1','2','3','4'] as const).map(n => <div className="pcr-dato" key={n}>
            <dt>Compresor {n}</dt><dd><Estado valor={b.compresores[n]} /></dd>
          </div>)}
          <Dato nombre="Presión general de aire" valor={m.presion_aire} unidad="kg/cm²" />
        </dl>
      </Seccion>

      <Seccion titulo="Pilas de suministro">
        <div className="pcr-pilas">{pilasCalderas.map(p => <section className="pcr-pila" key={p.id}>
          <h6>{p.nombre}</h6>
          <dl className="pcr-pila-datos">
            <Dato nombre="Nivel" valor={b.pilas[p.id].nivel} unidad="%" />
            <Dato nombre="Bomba" valor={b.pilas[p.id].bomba} vacio="Sin registrar" />
            <Dato nombre="Presión" valor={b.pilas[p.id].presion} unidad="kg/cm²" />
          </dl>
        </section>)}</div>
      </Seccion>

      <Seccion titulo="Agua potable y pozos">
        <dl className="pcr-datos pcr-agua">
          <Dato nombre="Nivel de tanques de agua potable" valor={m.nivel_agua_potable} unidad="%" />
          {equiposAguaCalderas.map(e => <div className="pcr-dato" key={e.id}>
            <dt>{e.nombre}</dt><dd><Estado valor={reporte.versionFormato === 2 && b.servicioAgua[e.id] ? 'En servicio' : ''} /></dd>
          </div>)}
        </dl>
      </Seccion>
    </div>
  </div>
}
