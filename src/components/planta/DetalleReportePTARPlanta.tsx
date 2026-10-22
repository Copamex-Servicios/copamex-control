import '../bitacora/historialFichaTecnica.css'
import type { ReporteTecnicoPTAR } from '../../lib/bitacoraTecnicaPTAR'
import { medicionesBitacoraPTAR, bombasBitacoraPTAR, prensasBitacoraPTAR } from '../../lib/tiposBitacoraPTAR'
import { fechaHoraBitacora } from '../../lib/formatoBitacora'
import { Seccion, Estado, Dato } from './PresentacionReportePlanta'

/** Presentación de consulta del reporte guardado de PTAR, exclusiva de Planta. */
export function DetalleReportePTARPlanta({ reporte }: { reporte: ReporteTecnicoPTAR }) {
  const b = reporte.borrador
  const mediciones = (seccion: number) => medicionesBitacoraPTAR.filter(m => m.seccion === seccion).map(m =>
    <Dato key={m.campo} nombre={m.nombre} valor={b.mediciones[m.campo]} unidad={m.unidad} />)
  return <div className="bpt-detalle-tecnico planta-ptar-detalle planta-reporte-detalle reporte-ficha-nueva">
    <div className="pcr-metadatos">
      <p>Registrado: {fechaHoraBitacora(reporte.creadoEn)} (México) · Revisión {reporte.revision}</p>
      <span>Solo consulta</span>
    </div>
    <div className="pcr-secciones">
      <Seccion titulo="Reporte relevante del turno">
        <p className={`pcr-narrativa${b.reporteRelevante ? '' : ' pcr-vacio'}`}>{b.reporteRelevante || 'Sin registrar'}</p>
      </Seccion>
      <Seccion titulo="Clarificador primario">
        <dl className="pcr-datos pcr-ptar-datos">
          {mediciones(0)}
          <div className="pcr-dato"><dt>Agitador 9300</dt><dd><Estado valor={b.estadoAgitador} /></dd></div>
        </dl>
      </Seccion>
      <Seccion titulo="DAF Chino y bombas">
        <dl className="pcr-datos pcr-ptar-datos">
          <Dato nombre="Descarga del DAF Chino" valor={b.destinoDescarga} vacio="Sin registrar" />
          {bombasBitacoraPTAR.map(n => <div className="pcr-dato" key={n}>
            <dt>Bomba {n}</dt><dd><Estado valor={b.bombas[n]} /></dd>
          </div>)}
        </dl>
      </Seccion>
      <Seccion titulo="Flujos PTAR">
        <dl className="pcr-datos pcr-ptar-datos">{mediciones(2)}</dl>
      </Seccion>
      <Seccion titulo="AIMSU y tanque de almacén">
        <dl className="pcr-datos pcr-ptar-datos">{mediciones(3)}</dl>
      </Seccion>
      <Seccion titulo="Prensas de fin de turno">
        <dl className="pcr-datos">
          {prensasBitacoraPTAR.map(n => <div className="pcr-dato" key={n}>
            <dt>Prensa {n}</dt><dd><Estado valor={b.prensas[n]} /></dd>
          </div>)}
          <Dato ancho nombre="Reporte relevante de fin de turno y motivo por el cual la prensa está parada" valor={b.comentarioPrensas} vacio="Sin registrar" />
        </dl>
      </Seccion>
    </div>
  </div>
}
