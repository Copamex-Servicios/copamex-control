import type { RegistroPozos } from '../../lib/pozos'
import type { RegistroUF } from '../../lib/uf'
import { formatearVolumenUF } from '../../lib/formatoUF'
import './detalleLecturaAgua.css'

type Props = { tipo:'pozos'; registro:RegistroPozos } | { tipo:'uf'; registro:RegistroUF }
const fechaHora = new Intl.DateTimeFormat('es-MX', {
  timeZone:'America/Mexico_City',day:'2-digit',month:'2-digit',year:'numeric',
  hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',
})
const hora = new Intl.DateTimeFormat('es-MX',{timeZone:'America/Mexico_City',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
function Volumen({valor}:{valor:number}) {
  return <span className="agua-valor">{formatearVolumenUF(valor).slice(0,-3)}<small> m³</small></span>
}

// Únicamente presentación de valores guardados; no calcula consumos ni rendimiento.
export function DetalleLecturaAgua(props:Props) {
  const {lectura,turno}=props.registro
  const filas=props.tipo==='pozos'
    ? [
      {nombre:'Pozo 1',inicial:props.registro.lectura.pozo1_ini,final:props.registro.lectura.pozo1_fin,total:props.registro.lectura.consumo_pozo1},
      {nombre:'Pozo 2',inicial:props.registro.lectura.pozo2_ini,final:props.registro.lectura.pozo2_fin,total:props.registro.lectura.consumo_pozo2},
    ] : [
      {nombre:'Alimentación',inicial:props.registro.lectura.alim_ini,final:props.registro.lectura.alim_fin,total:props.registro.lectura.alimentado},
      {nombre:'Aceptación',inicial:props.registro.lectura.acep_ini,final:props.registro.lectura.acep_fin,total:props.registro.lectura.aceptado},
    ]
  return <article className="co-detalle-agua" aria-label={props.tipo==='pozos'?'Lectura guardada de pozos':'Lectura guardada de ultrafiltración'}>
    {props.tipo==='pozos'&&<div className="agua-metadatos">
      <strong>{turno.finalizado_en===null?'Abierto':'Cerrado'} · Capturado <time dateTime={lectura.capturado_en} title={fechaHora.format(new Date(lectura.capturado_en))}>{hora.format(new Date(lectura.capturado_en))}</time>
        {turno.finalizado_en!==null&&<> · Cierre <time dateTime={turno.finalizado_en} title={fechaHora.format(new Date(turno.finalizado_en))}>{hora.format(new Date(turno.finalizado_en))}</time></>}
      </strong>
      <span className="agua-notas">Notas: {lectura.notas||'Sin notas.'}</span>
    </div>}
    {props.tipo==='uf'&&<dl className="agua-resultados">
      <div><dt>Alimentado</dt><dd><Volumen valor={props.registro.lectura.alimentado}/></dd></div>
      <div><dt>Aceptado</dt><dd><Volumen valor={props.registro.lectura.aceptado}/></dd></div>
      <div><dt>Rechazo</dt><dd><Volumen valor={props.registro.lectura.rechazo}/></dd></div>
      <div className="agua-rendimiento"><dt>Rendimiento</dt><dd className={props.registro.lectura.rendimiento===null?'agua-sin-rendimiento':undefined}>
        {props.registro.lectura.rendimiento===null?'Sin alimentación: no aplica':<>{props.registro.lectura.rendimiento.toLocaleString('es-MX',{maximumFractionDigits:2})}<small> %</small></>}
      </dd></div>
    </dl>}
    <div className="agua-tabla" role="region" aria-label={props.tipo==='pozos'?'Lecturas y consumos de pozos en metros cúbicos':'Lecturas y totales de medidores de ultrafiltración en metros cúbicos'} tabIndex={0}>
      <table>
        <thead><tr><th scope="col">{props.tipo==='pozos'?'Pozo':'Medidor'}</th><th scope="col">Lectura inicial</th><th scope="col">Lectura final</th><th scope="col">{props.tipo==='pozos'?'Consumo':'Total'}</th></tr></thead>
        <tbody>{filas.map(f=><tr key={f.nombre}><th scope="row">{f.nombre}</th><td data-label="Lectura inicial"><Volumen valor={f.inicial}/></td><td data-label="Lectura final"><Volumen valor={f.final}/></td><td data-label={props.tipo==='pozos'?'Consumo':'Total'}><strong><Volumen valor={f.total}/></strong></td></tr>)}</tbody>
      </table>
    </div>
    {props.tipo==='uf'&&<footer className="agua-metadatos agua-pie">
      <span>Captura <time dateTime={lectura.capturado_en}>{fechaHora.format(new Date(lectura.capturado_en))}</time>
        {turno.finalizado_en!==null&&<> · Cierre <time dateTime={turno.finalizado_en}>{fechaHora.format(new Date(turno.finalizado_en))}</time></>}
      </span>
      <span className="agua-notas">{lectura.notas||'Sin notas.'}</span>
    </footer>}
  </article>
}
