interface Punto { etiqueta: string; valor: number | null; minimo?: number | null; maximo?: number | null; fuera?: boolean }
export function GraficaReporte({ titulo, unidad, puntos }: { titulo: string; unidad: string; puntos: Punto[] }) {
  const visibles = puntos.slice(-60), valores = visibles.flatMap(p => [p.valor, p.minimo, p.maximo]).filter((n): n is number => n !== null && n !== undefined && Number.isFinite(n))
  if (!valores.length) return <figure className="reporte-grafica"><figcaption>{titulo}</figcaption><p>Sin mediciones en el período.</p></figure>
  const bajo = Math.min(0, ...valores), alto = Math.max(1, ...valores), x = (i: number) => 55 + i * 560 / Math.max(1, visibles.length - 1), y = (v: number) => 190 - (v - bajo) / (alto - bajo) * 150
  function lineas(campo: 'valor' | 'minimo' | 'maximo', color: string) {
    let trazo = '', conectado = false
    visibles.forEach((p, i) => { const v = p[campo]; if (v === null || v === undefined) conectado = false; else { trazo += `${conectado ? 'L' : 'M'}${x(i)},${y(v)} `; conectado = true } })
    return <path d={trazo} fill="none" stroke={color} strokeWidth={campo === 'valor' ? 2.5 : 1.5} strokeDasharray={campo === 'valor' ? undefined : '5 4'} />
  }
  const fmt = (v: number) => new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(v)
  return <figure className="reporte-grafica"><figcaption>{titulo} {unidad && `(${unidad})`}</figcaption><svg viewBox="0 0 660 245" role="img" aria-label={`${titulo}. ${visibles.length} posiciones; límites aplicados en líneas discontinuas cuando existen.`}>
    {[0, 0.5, 1].map(k => <g key={k}><line x1={55} x2={615} y1={40 + k * 150} y2={40 + k * 150} stroke="#dce4ef" /><text x={49} y={45 + k * 150} textAnchor="end" fontSize={11}>{fmt(alto - k * (alto - bajo))}</text></g>)}
    {lineas('minimo', '#b37a00')}{lineas('maximo', '#b37a00')}{lineas('valor', '#002d72')}
    {visibles.map((p, i) => p.valor === null ? null : <circle key={i} cx={x(i)} cy={y(p.valor)} r={4} fill={p.fuera ? '#bb2828' : '#002d72'}><title>{`${p.etiqueta}: ${fmt(p.valor)} ${unidad}${p.fuera ? ' · Fuera de límite aplicado' : ''}`}</title></circle>)}
    <text x={55} y={218} fontSize={10}>{visibles[0]?.etiqueta}</text><text x={615} y={238} textAnchor="end" fontSize={10}>{visibles.at(-1)?.etiqueta}</text>
  </svg>{puntos.length > 60 && <p className="ayuda-turno">Gráfica: últimas 60 posiciones. El Excel conserva todos los registros del período.</p>}</figure>
}
