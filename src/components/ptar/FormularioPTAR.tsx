import { Save, Trash2 } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ErrorPTAR, validarCamposPTAR } from '../../lib/ptar'
import { formatearNumeroPTAR } from '../../lib/formatoPTAR'
import { medicionesPTAR } from '../../lib/tiposPTAR'
import type { CamposPTAR, LecturaPTAR } from '../../lib/tiposPTAR'
interface Props { original?: LecturaPTAR; deshabilitado: boolean; alGuardar: (campos: CamposPTAR) => Promise<boolean> }
export function FormularioPTAR({ original, deshabilitado, alGuardar }: Props) {
  const id = useId()
  const [campos, setCampos] = useState<CamposPTAR>(() => ({
    ...Object.fromEntries(medicionesPTAR.map(({campo}) => [campo, original && original[campo] !== null ? formatearNumeroPTAR(original[campo]) : ''])),
    notas: original?.notas ?? '',
  }) as CamposPTAR)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [confirmado, setConfirmado] = useState(false)
  const activo = useRef(false)
  const bloqueado = deshabilitado || enviando || confirmado
  function cambiar(campo: keyof CamposPTAR, valor: string) {
    if (bloqueado || activo.current) return
    setCampos(c => ({ ...c, [campo]: valor })); setError(null)
  }
  async function guardar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (bloqueado || activo.current) return
    try { validarCamposPTAR(campos) }
    catch (e) { setError(e instanceof ErrorPTAR ? e.message : 'Revisa las mediciones.'); return }
    activo.current = true; setEnviando(true); setError(null)
    try { if (await alGuardar({ ...campos })) setConfirmado(true) }
    catch { setError('No se pudo confirmar el guardado. Revisa el mensaje de PTAR.') }
    finally { activo.current = false; setEnviando(false) }
  }
  function limpiar() {
    if (bloqueado || activo.current) return
    setCampos({ ...Object.fromEntries(medicionesPTAR.map(({ campo }) => [campo, ''])), notas: '' } as CamposPTAR)
    setError(null)
  }
  return <form className="ptar-formulario" onSubmit={guardar} aria-busy={enviando}>
    
    
    <fieldset className="ptar-campos" disabled={bloqueado}>
      <legend>{original ? 'Corregir mediciones PTAR' : 'Mediciones PTAR'}</legend>
      <div className="ptar-paneles">
        {(['DQO', 'SST'] as const).map(parametro => <section className={`ptar-mediciones ptar-mediciones-${parametro.toLowerCase()}`} key={parametro} aria-labelledby={`${id}-${parametro}`}>
          <div className="ptar-mediciones-cabecera">
            <div><h4 id={`${id}-${parametro}`}>{parametro} (mg/L)</h4></div>
          </div>
          <div className="ptar-mediciones-campos">
            {medicionesPTAR.filter(m => m.parametro === parametro).map(({campo,parametro,punto}) => <div className="campo-turno" key={campo}>
              <label htmlFor={`${id}-${campo}`}>{parametro} · {punto} (mg/L)</label>
              <input id={`${id}-${campo}`} name={campo} type="text" inputMode="decimal" autoComplete="off" placeholder="Ingresa el valor…"
                value={campos[campo]} onChange={e => cambiar(campo,e.target.value)} />
            </div>)}
          </div>
        </section>)}
      </div>
      <div className="campo-turno ptar-notas">
        <div className="ptar-notas-titulo"><div><label htmlFor={`${id}-notas`}>Notas (opcional)</label></div></div>
        <textarea id={`${id}-notas`} name="notas" rows={2} placeholder="Escribe tus notas aquí…" value={campos.notas} onChange={e => cambiar('notas',e.target.value)} />
      </div>
    </fieldset>
    
    {error && <p className="mensaje-error" role="alert">{error}</p>}
    <div className="acciones-turno ptar-acciones"><button className="boton-secundario" type="button" disabled={bloqueado} onClick={limpiar}><Trash2 aria-hidden="true" />Limpiar formulario</button><button className="boton-primario" type="submit" disabled={bloqueado}>
      <Save aria-hidden="true" />{enviando ? 'Guardando…' : original ? 'Guardar corrección' : 'Guardar lecturas PTAR'}
    </button></div>
  </form>
}
