import { useEffect, useState } from 'react'
import { consultarHistorialCalidad } from '../../lib/calidad'
import type { RegistroCalidad } from '../../lib/tiposCalidad'
import { LecturaCalidadGuardada } from './LecturaCalidadGuardada'

export function ConsultaCalidad() {
  const [registros, setRegistros] = useState<RegistroCalidad[]>([])
  const [area, setArea] = useState('todas')
  const [revision, setRevision] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    let vigente = true
    async function cargar() {
      setCargando(true)
      try {
        const filas = await consultarHistorialCalidad(controller.signal)
        if (vigente) { setRegistros(filas); setError(null) }
      } catch { if (vigente) setError('No se pudo consultar Calidad. Vuelve a actualizar.') }
      finally { if (vigente) setCargando(false) }
    }
    void cargar()
    const actualizar = () => setRevision(v => v + 1)
    window.addEventListener('focus', actualizar)
    const intervalo = window.setInterval(actualizar,60000)
    return () => { vigente=false; controller.abort(); window.removeEventListener('focus',actualizar); window.clearInterval(intervalo) }
  }, [revision])
  const visibles = registros.filter(r => area === 'todas' || r.turno.area === area)
  return <section className="panel-informacion panel-calidad">
    <div className="planta-encabezado"><h2>Calidad de agua</h2><button type="button" className="boton-secundario" disabled={cargando} onClick={() => setRevision(v => v + 1)}>{cargando ? 'Actualizando…' : 'Actualizar'}</button></div>
    <label>Área <select value={area} onChange={e => setArea(e.target.value)}><option value="todas">Ambas áreas</option><option value="calderas">Calderas</option><option value="ptar">PTAR</option></select></label>
    <p className="texto-secundario">Últimas 20 muestras de cada área · Solo consulta</p>
    {error && <p className="mensaje-error" role="alert">{error}</p>}
    {!error && !cargando && !visibles.length && <p>No hay muestras registradas.</p>}
    {visibles.map(r => <details className="item-historial-calidad" key={r.lectura.id}><summary>{r.turno.area === 'calderas' ? 'Calderas' : 'PTAR'} · {r.turno.fecha_operativa.split('-').reverse().join('/')} · {r.operadorNombre} · {new Intl.DateTimeFormat('es-MX',{timeZone:'America/Mexico_City',hour:'2-digit',minute:'2-digit'}).format(new Date(r.lectura.capturado_en))}</summary><LecturaCalidadGuardada registro={r} /></details>)}
  </section>
}
