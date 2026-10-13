import { GrupoMediciones } from '../operativo/GrupoMediciones'
import { useId, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { calcularConsumosPozos, ErrorPozos, validarCamposPozos } from '../../lib/pozos'
import type { CamposPozos, ValoresPozos } from '../../lib/tiposPozos'

interface PropsFormularioPozos {
  alGuardar: (campos: CamposPozos) => Promise<boolean>
  valoresIniciales?: ValoresPozos
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

function crearCampos(valores?: ValoresPozos): CamposPozos {
  return {
    pozo1Inicial: valores ? textoDecimal(valores.pozo1_ini) : '',
    pozo1Final: valores ? textoDecimal(valores.pozo1_fin) : '',
    pozo2Inicial: valores ? textoDecimal(valores.pozo2_ini) : '',
    pozo2Final: valores ? textoDecimal(valores.pozo2_fin) : '',
    notas: valores?.notas ?? '',
  }
}

function consumoPrevio(inicial: string, final: string): string | null {
  try {
    const valores = validarCamposPozos({
      pozo1Inicial: inicial, pozo1Final: final,
      pozo2Inicial: '0', pozo2Final: '0', notas: '',
    })
    return calcularConsumosPozos(valores).pozo1
  } catch {
    return null
  }
}

// El padre debe usar una key distinta al cambiar de cuenta, turno o lectura.
// Los valores iniciales se toman al montar; un refresco no reemplaza lo escrito.
export function FormularioPozos({
  alGuardar, valoresIniciales, modo = 'capturar', deshabilitado = false, alCancelar, accionSecundaria,
}: PropsFormularioPozos) {
  const id = useId()
  const [campos, setCampos] = useState<CamposPozos>(() => crearCampos(valoresIniciales))
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [confirmado, setConfirmado] = useState(false)
  const envioActivo = useRef(false)
  const bloqueado = deshabilitado || enviando || confirmado
  const correccion = modo === 'corregir'

  function cambiar(campo: keyof CamposPozos, valor: string): void {
    if (bloqueado || envioActivo.current) return
    setCampos((anteriores) => ({ ...anteriores, [campo]: valor }))
    setError(null)
  }

  async function guardar(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault()
    if (deshabilitado || confirmado || envioActivo.current) return
    try {
      validarCamposPozos(campos)
    } catch (fallo) {
      setError(fallo instanceof ErrorPozos ? fallo.message : 'Revisa las lecturas antes de guardar.')
      return
    }
    envioActivo.current = true
    setEnviando(true)
    setError(null)
    try {
      const guardado = await alGuardar({ ...campos })
      if (guardado) setConfirmado(true)
    } catch {
      setError('No se pudo confirmar el guardado. Revisa el mensaje de Pozos antes de volver a intentar.')
    } finally {
      envioActivo.current = false
      setEnviando(false)
    }
  }

  const lecturas = [
    { campo: 'pozo1Inicial' as const, nombre: 'pozo1_ini', etiqueta: 'Pozo 1 — Lectura inicial (m³)' },
    { campo: 'pozo1Final' as const, nombre: 'pozo1_fin', etiqueta: 'Pozo 1 — Lectura final (m³)' },
    { campo: 'pozo2Inicial' as const, nombre: 'pozo2_ini', etiqueta: 'Pozo 2 — Lectura inicial (m³)' },
    { campo: 'pozo2Final' as const, nombre: 'pozo2_fin', etiqueta: 'Pozo 2 — Lectura final (m³)' },
  ]
  const consumos = [
    { pozo: 1, inicial: 'pozo1_ini', final: 'pozo1_fin', valor: consumoPrevio(campos.pozo1Inicial, campos.pozo1Final) },
    { pozo: 2, inicial: 'pozo2_ini', final: 'pozo2_fin', valor: consumoPrevio(campos.pozo2Inicial, campos.pozo2Final) },
  ]

  return (
    <form className="formulario-turno formulario-pozos formulario-mediciones" onSubmit={guardar} aria-busy={enviando} aria-describedby={error ? `${id}-error` : undefined}>
      <fieldset className="campos-turno" disabled={bloqueado}>
        <legend>{correccion ? 'Corregir lecturas de Pozos' : 'Lecturas de Pozos'}</legend>
        <div className="mediciones-grupos">
          {consumos.map(({ pozo, inicial, final, valor }, indice) => (
            <GrupoMediciones key={pozo} titulo={`Pozo ${pozo}`}>
              <div className="mediciones-entradas">
                {lecturas.slice(indice * 2, indice * 2 + 2).map(({ campo, nombre, etiqueta }) => (
                  <div className="campo-turno" key={campo}>
                    <label htmlFor={`${id}-${nombre}`}>{etiqueta}</label>
                    <input id={`${id}-${nombre}`} name={nombre} type="text" inputMode="decimal"
                      autoComplete="off" required value={campos[campo]}
                      onChange={(evento) => cambiar(campo, evento.target.value)} />
                  </div>
                ))}
              </div>
              <div className="campo-turno mediciones-resultado">
                <label htmlFor={`${id}-consumo-${pozo}`}>Consumo del Pozo {pozo} (m³)</label>
                <output id={`${id}-consumo-${pozo}`} htmlFor={`${id}-${inicial} ${id}-${final}`}>
                  {valor === null ? 'Completa las dos lecturas' : `${valor} m³`}
                </output>
              </div>
            </GrupoMediciones>
          ))}
        </div>
        <div className="campo-turno campo-turno-ancho">
          <label htmlFor={`${id}-notas`}>Notas (opcional)</label>
          <textarea id={`${id}-notas`} name="notas" rows={3} value={campos.notas}
            onChange={(evento) => cambiar('notas', evento.target.value)} />
        </div>
      </fieldset>

      {error && <p id={`${id}-error`} className="mensaje-error" role="alert">{error}</p>}
      {confirmado && <p className="mensaje-exito" role="status">{correccion ? 'Corrección confirmada.' : 'Lectura guardada.'}</p>}
      <div className="acciones-turno">
        {accionSecundaria}
        <button className="boton-primario" type="submit" disabled={bloqueado}>
          {enviando ? 'Guardando…' : correccion ? 'Guardar corrección' : 'Guardar lectura de Pozos'}
        </button>
        {alCancelar && (
          <button className="boton-secundario" type="button" onClick={alCancelar}
            disabled={deshabilitado || enviando}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  )
}
