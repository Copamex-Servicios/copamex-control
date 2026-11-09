import './formularioUF.css'
import { useId, useRef, useState } from 'react'
import { mayusculasNota } from '../../lib/notasOperativas'
import type { FormEvent, ReactNode } from 'react'
import { calcularConsumosUF, calcularResultadosUF, ErrorUF, validarCamposUF } from '../../lib/uf'
import type { CamposUF, ValoresUF } from '../../lib/tiposUF'

interface PropsFormularioUF {
  alGuardar: (campos: CamposUF) => Promise<boolean>
  valoresIniciales?: ValoresUF
  modo?: 'capturar' | 'corregir'
  deshabilitado?: boolean
  alCancelar?: () => void
  accionSecundaria?: ReactNode
}

// Expandir exponentes sin redondear: una lectura guardada como 1e-8
// debe poder corregirse con el mismo formato decimal que acepta el formulario.
function textoDecimal(numero: number): string {
  const texto = String(numero)
  if (!/e/i.test(texto)) return texto
  const negativo = texto.startsWith('-')
  const [mantisa, exponente] = texto.replace(/^-/, '').toLowerCase().split('e')
  const [entera, fraccion = ''] = mantisa.split('.')
  const digitos = entera + fraccion
  const posicion = entera.length + Number(exponente)
  const decimal = posicion <= 0 ? `0.${'0'.repeat(-posicion)}${digitos}`
    : posicion >= digitos.length ? digitos + '0'.repeat(posicion - digitos.length)
      : `${digitos.slice(0, posicion)}.${digitos.slice(posicion)}`
  return negativo ? `-${decimal}` : decimal
}

function crearCampos(valores?: ValoresUF): CamposUF {
  return {
    alimentacionInicial: valores ? textoDecimal(valores.alim_ini) : '',
    alimentacionFinal: valores ? textoDecimal(valores.alim_fin) : '',
    aceptacionInicial: valores ? textoDecimal(valores.acep_ini) : '',
    aceptacionFinal: valores ? textoDecimal(valores.acep_fin) : '',
    notas: valores?.notas ?? '',
  }
}

function consumoPrevio(inicial: string, final: string): string | null {
  try {
    const valores = validarCamposUF({
      alimentacionInicial: inicial, alimentacionFinal: final,
      aceptacionInicial: '0', aceptacionFinal: '0', notas: '',
    })
    return calcularConsumosUF(valores).alimentado
  } catch {
    return null
  }
}

// El padre debe usar una key distinta al cambiar de cuenta, turno o lectura.
// Los valores iniciales se toman al montar; un refresco no reemplaza lo escrito.
export function FormularioUF({
  alGuardar, valoresIniciales, modo = 'capturar', deshabilitado = false, alCancelar, accionSecundaria,
}: PropsFormularioUF) {
  const id = useId()
  const [campos, setCampos] = useState<CamposUF>(() => crearCampos(valoresIniciales))
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [confirmado, setConfirmado] = useState(false)
  const envioActivo = useRef(false)
  const bloqueado = deshabilitado || enviando || confirmado
  const correccion = modo === 'corregir'

  function cambiar(campo: keyof CamposUF, valor: string): void {
    if (bloqueado || envioActivo.current) return
    setCampos((anteriores) => ({ ...anteriores, [campo]: campo === 'notas' ? mayusculasNota(valor) : valor }))
    setError(null)
  }

  async function guardar(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault()
    if (deshabilitado || confirmado || envioActivo.current) return
    try {
      validarCamposUF(campos)
    } catch (fallo) {
      setError(fallo instanceof ErrorUF ? fallo.message : 'Revisa las lecturas antes de guardar.')
      return
    }
    envioActivo.current = true
    setEnviando(true)
    setError(null)
    try {
      const guardado = await alGuardar({ ...campos })
      if (guardado) setConfirmado(true)
    } catch {
      setError('No se pudo confirmar el guardado. Revisa el mensaje de UF antes de volver a intentar.')
    } finally {
      envioActivo.current = false
      setEnviando(false)
    }
  }

  const lecturas = [
    { campo: 'alimentacionInicial' as const, nombre: 'alim_ini', etiqueta: 'Alimentación — Lectura inicial (m³)' },
    { campo: 'alimentacionFinal' as const, nombre: 'alim_fin', etiqueta: 'Alimentación — Lectura final (m³)' },
    { campo: 'aceptacionInicial' as const, nombre: 'acep_ini', etiqueta: 'Aceptación — Lectura inicial (m³)' },
    { campo: 'aceptacionFinal' as const, nombre: 'acep_fin', etiqueta: 'Aceptación — Lectura final (m³)' },
  ]
  const consumos = [
    { medidor: 1, etiqueta: 'Alimentado', inicial: 'alim_ini', final: 'alim_fin', valor: consumoPrevio(campos.alimentacionInicial, campos.alimentacionFinal) },
    { medidor: 2, etiqueta: 'Aceptado', inicial: 'acep_ini', final: 'acep_fin', valor: consumoPrevio(campos.aceptacionInicial, campos.aceptacionFinal) },
  ]
  let resultados: ReturnType<typeof calcularResultadosUF> | null = null
  try { resultados = calcularResultadosUF(validarCamposUF(campos)) } catch { /* Faltan lecturas válidas. */ }

  return (
    <form className="formulario-turno formulario-uf" onSubmit={guardar} aria-busy={enviando} aria-describedby={error ? `${id}-error` : undefined}>
      <fieldset className="campos-turno" disabled={bloqueado}>
        <legend>{correccion ? 'Corregir lecturas de UF' : 'Lecturas de UF'}</legend>
        <div className="uf-captura-tabla"><table>
          <thead><tr><th scope="col">Medidor</th><th scope="col">Lectura inicial (m³)</th><th scope="col">Lectura final (m³)</th><th scope="col">Consumo (m³)</th></tr></thead>
          <tbody>
          {consumos.map(({ medidor, etiqueta, inicial, final, valor }, indice) => (
            <tr key={medidor}>
              <th scope="row">{medidor === 1 ? 'Alimentación' : 'Aceptación'}</th>
                {lecturas.slice(indice * 2, indice * 2 + 2).map(({ campo, nombre, etiqueta }) => (
                  <td key={campo}>
                    <input id={`${id}-${nombre}`} name={nombre} type="text" inputMode="decimal"
                      aria-label={etiqueta} placeholder="0.00" autoComplete="off" required value={campos[campo]}
                      onChange={(evento) => cambiar(campo, evento.target.value)} />
                  </td>
                ))}
              <td><output id={`${id}-consumo-${medidor}`} aria-label={`${etiqueta} (m³)`} htmlFor={`${id}-${inicial} ${id}-${final}`}>
                {valor ?? '—'}
              </output></td>
            </tr>
          ))}
          </tbody>
        </table></div>
        <div className="uf-captura-resultados">
          <div><h3>Rechazo</h3><output id={`${id}-rechazo`} aria-label="Rechazo (m³)"><strong>{resultados?.rechazo ?? '—'}</strong><span>m³</span></output></div>
          <div><h3>Rendimiento</h3><output id={`${id}-rendimiento`} aria-label="Rendimiento (%)"><strong>{resultados === null ? '—'
            : resultados.rendimiento === null ? 'No aplica'
              : resultados.rendimiento.toLocaleString('es-MX', { maximumFractionDigits: 2 })}</strong><span>%</span></output>
            {resultados && resultados.rendimiento === null && <p>Sin alimentación</p>}
          </div>
        </div>
      </fieldset>

      {error && <p id={`${id}-error`} className="mensaje-error" role="alert">{error}</p>}
      {confirmado && <p className="mensaje-exito" role="status">{correccion ? 'Corrección confirmada.' : 'Lectura guardada.'}</p>}
      <div className="uf-captura-pie">
        <div className="campo-turno">
          <label htmlFor={`${id}-notas`}>Notas (opcional)</label>
          <textarea id={`${id}-notas`} name="notas" rows={1} placeholder="Escribe una nota corta" value={campos.notas} disabled={bloqueado}
            onChange={(evento) => cambiar('notas', evento.target.value)} />
        </div>
        <div className="acciones-turno">
        {accionSecundaria}
        <button className="boton-primario" type="submit" disabled={bloqueado}>
          {enviando ? 'Guardando…' : correccion ? 'Guardar corrección' : 'Guardar'}
        </button>
        {alCancelar && (
          <button className="boton-secundario" type="button" onClick={alCancelar}
            disabled={deshabilitado || enviando}>
            Cancelar
          </button>
        )}
      </div>
      </div>
    </form>
  )
}
