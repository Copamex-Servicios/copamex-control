import { useId, useState, type KeyboardEvent } from 'react'
import { ConsultaMuestrasCalidad } from '../calidad/ConsultaMuestrasCalidad'
import { ReportesTecnicosPlanta } from './ReportesTecnicosPlanta'
import { useAuth } from '../../hooks/useAuth'
import { PanelSupervisionPlanta } from './PanelSupervisionPlanta'

type ConsultaOperativa = 'reportes' | 'calidad'

export function PanelPlanta() {
  const { perfil } = useAuth()
  return perfil?.rol === 'admin' ? <PanelSupervisionPlanta /> : <ConsultaPlantaOperativa />
}

function ConsultaPlantaOperativa() {
  const id = useId()
  const [pestana, setPestana] = useState<ConsultaOperativa>('reportes')
  const [calidadAbierta, setCalidadAbierta] = useState(false)
  const opciones: { id: ConsultaOperativa; nombre: string }[] = [
    { id: 'reportes', nombre: 'Reportes técnicos' },
    { id: 'calidad', nombre: 'Calidad de agua' },
  ]

  function seleccionar(siguiente: ConsultaOperativa) {
    setPestana(siguiente)
    if (siguiente === 'calidad') setCalidadAbierta(true)
  }

  function navegarTeclado(evento: KeyboardEvent<HTMLButtonElement>, indice: number) {
    let siguiente: number | null = null
    if (evento.key === 'ArrowRight') siguiente = (indice + 1) % opciones.length
    if (evento.key === 'ArrowLeft') siguiente = (indice + opciones.length - 1) % opciones.length
    if (evento.key === 'Home') siguiente = 0
    if (evento.key === 'End') siguiente = opciones.length - 1
    if (siguiente === null) return
    evento.preventDefault()
    seleccionar(opciones[siguiente].id)
    evento.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[siguiente]?.focus()
  }

  return <div className="vista-planta">
    <div className="pestanas-modulos" role="tablist" aria-label="Consultas de operadores">
      {opciones.map((opcion, indice) => <button
        key={opcion.id} type="button" role="tab" id={`${id}-${opcion.id}-tab`}
        aria-controls={`${id}-${opcion.id}`} aria-selected={pestana === opcion.id}
        tabIndex={pestana === opcion.id ? 0 : -1}
        onClick={() => seleccionar(opcion.id)}
        onKeyDown={evento => navegarTeclado(evento, indice)}
      >{opcion.nombre}</button>)}
    </div>
    <div id={`${id}-reportes`} role="tabpanel" aria-labelledby={`${id}-reportes-tab`} hidden={pestana !== 'reportes'}>
      <ReportesTecnicosPlanta />
    </div>
    <div id={`${id}-calidad`} role="tabpanel" aria-labelledby={`${id}-calidad-tab`} hidden={pestana !== 'calidad'}>
      {calidadAbierta && <ConsultaMuestrasCalidad />}
    </div>
  </div>
}
