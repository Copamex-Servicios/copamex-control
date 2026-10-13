import { useId } from 'react'
import type { ReactNode } from 'react'

/** Agrupa lecturas relacionadas; los cálculos y controles pertenecen al formulario. */
export function GrupoMediciones({ titulo, children }: { titulo: string; children: ReactNode }) {
  const id = useId()
  return <section className="mediciones-grupo" aria-labelledby={id}>
    <h4 id={id}>{titulo}</h4>
    <div className="mediciones-grupo-contenido">{children}</div>
  </section>
}
