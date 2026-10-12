import { useId } from 'react'
import { formatearVolumenUF } from '../../lib/formatoUF'
import type { RegistroUF } from '../../lib/uf'
import type { TipoTurno } from '../../lib/tiposTurno'

interface PropsLecturaUFGuardada {
  registro: RegistroUF
  alCorregir?: () => void
  deshabilitado?: boolean
}

const nombresTurno: Record<TipoTurno, string> = {
  dia: 'Día', tarde: 'Tarde', noche: 'Noche',
}

// Mostrar siempre la zona de la planta, aunque el navegador use otra zona.
const formatoHora = new Intl.DateTimeFormat('es-MX', {
  timeZone: 'America/Mexico_City',
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

function fechaOperativa(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-')
  return `${dia}/${mes}/${anio}`
}

// Presentación de datos ya comprobados por el servicio.
// El panel decide si ofrece corregir; el hook y el servidor validan la acción.
export function LecturaUFGuardada({
  registro, alCorregir, deshabilitado = false,
}: PropsLecturaUFGuardada) {
  const id = useId()
  const { lectura, turno, operadorNombre } = registro
  const uf = [
    { numero: 1, nombre: 'Alimentación', inicial: lectura.alim_ini, final: lectura.alim_fin, consumo: lectura.alimentado },
    { numero: 2, nombre: 'Aceptación', inicial: lectura.acep_ini, final: lectura.acep_fin, consumo: lectura.aceptado },
  ]

  return (
    <article className="lectura-uf" aria-labelledby={`${id}-titulo`}>
      <h3 id={`${id}-titulo`}>Lectura guardada de Ultrafiltración</h3>
      <dl className="datos-turno">
        <div><dt>Tipo de turno</dt><dd>{nombresTurno[turno.turno]}</dd></div>
        <div><dt>Operador</dt><dd>{operadorNombre}</dd></div>
        <div><dt>Fecha operativa</dt><dd>{fechaOperativa(turno.fecha_operativa)}</dd></div>
        <div><dt>Turno</dt><dd>{turno.finalizado_en === null ? 'Abierto' : 'Cerrado'}</dd></div>
        <div>
          <dt>Fecha y hora de captura (México)</dt>
          <dd><time dateTime={lectura.capturado_en}>{formatoHora.format(new Date(lectura.capturado_en))}</time></dd>
        </div>
        {turno.finalizado_en !== null && (
          <div>
            <dt>Cierre del turno (México)</dt>
            <dd><time dateTime={turno.finalizado_en}>{formatoHora.format(new Date(turno.finalizado_en))}</time></dd>
          </div>
        )}
      </dl>

      <div className="resumen-uf">
        {uf.map(({ numero, nombre, inicial, final, consumo }) => (
          <section key={numero} aria-labelledby={`${id}-pozo-${numero}`}>
            <h4 id={`${id}-pozo-${numero}`}>{nombre}</h4>
            <dl className="datos-turno datos-lectura-uf">
              <div><dt>Lectura inicial</dt><dd>{formatearVolumenUF(inicial)}</dd></div>
              <div><dt>Lectura final</dt><dd>{formatearVolumenUF(final)}</dd></div>
              <div><dt>{numero === 1 ? 'Alimentado' : 'Aceptado'}</dt><dd>{formatearVolumenUF(consumo)}</dd></div>
            </dl>
          </section>
        ))}
      </div>
      <dl className="datos-turno">
        <div><dt>Rechazo</dt><dd>{formatearVolumenUF(lectura.rechazo)}</dd></div>
        <div><dt>Rendimiento</dt><dd>{lectura.rendimiento === null ? 'Sin alimentación: no aplica'
          : `${lectura.rendimiento.toLocaleString('es-MX', { maximumFractionDigits: 2 })} %`}</dd></div>
      </dl>

      <h4>Notas</h4>
      <p className="notas-turno">{lectura.notas || 'Sin notas.'}</p>
      {alCorregir && (
        <div className="acciones-lectura-uf">
          <p className="ayuda-turno">
            El plazo de corrección es de una hora desde la captura. La fecha y hora originales se conservan.
          </p>
          <button className="boton-secundario" type="button" disabled={deshabilitado}
            onClick={() => { if (!deshabilitado) alCorregir() }}>
            Corregir lectura
          </button>
        </div>
      )}
    </article>
  )
}
