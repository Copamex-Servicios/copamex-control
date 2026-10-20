import { useId } from 'react'
import { formatearVolumenPozos } from '../../lib/formatoPozos'
import type { RegistroPozos } from '../../lib/pozos'
import { CabeceraRegistroGuardado } from '../diseno/CabeceraRegistroGuardado'

interface PropsLecturaPozosGuardada {
  registro: RegistroPozos
  alCorregir?: () => void
  deshabilitado?: boolean
}

// Mostrar siempre la zona de la planta, aunque el navegador use otra zona.
const formatoHora = new Intl.DateTimeFormat('es-MX', {
  timeZone: 'America/Mexico_City',
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

// Presentación de datos ya comprobados por el servicio.
// El panel decide si ofrece corregir; el hook y el servidor validan la acción.
export function LecturaPozosGuardada({
  registro, alCorregir, deshabilitado = false,
}: PropsLecturaPozosGuardada) {
  const id = useId()
  const { lectura, turno, operadorNombre } = registro
  const pozos = [
    { numero: 1, inicial: lectura.pozo1_ini, final: lectura.pozo1_fin, consumo: lectura.consumo_pozo1 },
    { numero: 2, inicial: lectura.pozo2_ini, final: lectura.pozo2_fin, consumo: lectura.consumo_pozo2 },
  ]

  return (
    <article className="lectura-pozos co-ficha-registro" aria-labelledby={`${id}-titulo`}>
      <CabeceraRegistroGuardado titulo="Pozos" tituloId={`${id}-titulo`} turno={turno} operador={operadorNombre}>
        <div><dt>Estado del turno</dt><dd>{turno.finalizado_en === null ? 'Abierto' : 'Cerrado'}</dd></div>
        <div>
          <dt>Captura (México)</dt>
          <dd><time dateTime={lectura.capturado_en}>{formatoHora.format(new Date(lectura.capturado_en))}</time></dd>
        </div>
        {turno.finalizado_en !== null && (
          <div>
            <dt>Cierre del turno (México)</dt>
            <dd><time dateTime={turno.finalizado_en}>{formatoHora.format(new Date(turno.finalizado_en))}</time></dd>
          </div>
        )}
      </CabeceraRegistroGuardado>

      <div className="resumen-pozos">
        {pozos.map(({ numero, inicial, final, consumo }) => (
          <section key={numero} aria-labelledby={`${id}-pozo-${numero}`}>
            <h4 id={`${id}-pozo-${numero}`}>Pozo {numero}</h4>
            <dl className="datos-turno datos-lectura-pozos co-ficha-mediciones">
              <div><dt>Lectura inicial</dt><dd>{formatearVolumenPozos(inicial)}</dd></div>
              <div><dt>Lectura final</dt><dd>{formatearVolumenPozos(final)}</dd></div>
              <div><dt>Consumo</dt><dd>{formatearVolumenPozos(consumo)}</dd></div>
            </dl>
          </section>
        ))}
      </div>

      <footer className="co-ficha-notas"><h4>Notas</h4><p className="notas-turno">{lectura.notas || 'Sin notas.'}</p></footer>
      {alCorregir && (
        <div className="acciones-lectura-pozos">
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
