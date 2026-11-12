import { useEffect, useId, useState } from 'react'
import { Database } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const limiteConfigurado = Number(import.meta.env.VITE_DATABASE_LIMIT_MB ?? 500)
const limiteMb = Number.isFinite(limiteConfigurado) && limiteConfigurado > 0 ? limiteConfigurado : 500
const numero = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 })

export function AlmacenamientoDashboard({ cuenta, revision }: { cuenta: string; revision: string }) {
  const titulo = useId()
  const [resultado, setResultado] = useState<{ clave: string; bytes: number | null } | null>(null)
  const clave = `${cuenta}:${revision}`
  useEffect(() => {
    let vigente = true
    const control = new AbortController()
    const limite = window.setTimeout(() => control.abort(), 10000)
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('consultar_almacenamiento_dashboard').abortSignal(control.signal)
        const bytes = data?.bytes_usados
        if (error || typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Consumo no disponible')
        if (vigente) setResultado({ clave, bytes })
      } catch {
        if (vigente) setResultado({ clave, bytes: null })
      } finally {
        window.clearTimeout(limite)
      }
    })()
    return () => { vigente = false; control.abort(); window.clearTimeout(limite) }
  }, [clave])

  const actual = resultado?.clave === clave ? resultado : null
  const usadosMb = actual?.bytes === null || actual?.bytes === undefined ? null : actual.bytes / 1000000
  const porcentaje = usadosMb === null ? null : usadosMb / limiteMb * 100
  const tono = porcentaje !== null && porcentaje >= 90 ? 'alto' : porcentaje !== null && porcentaje >= 75 ? 'medio' : 'normal'
  return <section className="co-dashboard-almacenamiento" aria-labelledby={titulo} data-tono={tono} aria-busy={!actual}>
    <div className="co-almacenamiento-encabezado">
      <h2 id={titulo}><Database size={18} aria-hidden="true" />Base de datos</h2>
      <span>{usadosMb === null ? actual ? 'Consumo no disponible' : 'Consultando…' : `${numero.format(usadosMb)} / ${numero.format(limiteMb)} MB`}</span>
    </div>
    {porcentaje !== null && <>
      <progress max={100} value={Math.min(100, porcentaje)} aria-label="Uso de la base de datos" aria-valuetext={`${numero.format(porcentaje)} % del límite configurado`} />
      <div className="co-almacenamiento-detalle"><span>Límite: {numero.format(limiteMb)} MB</span><strong>{numero.format(porcentaje)} % utilizado</strong></div>
    </>}
  </section>
}
