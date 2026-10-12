// Fase 4: datos de lecturas_pozos y campos del formulario.
// El turno vincula la captura con el área y el operador.

export interface LecturaPozos {
  id: string
  turno_id: string
  pozo1_ini: number
  pozo1_fin: number
  consumo_pozo1: number
  pozo2_ini: number
  pozo2_fin: number
  consumo_pozo2: number
  notas: string | null
  capturado_en: string
  recibido_en: string
  creado_por: string
  eliminado_en: string | null
  eliminado_por: string | null
}

// Los campos permanecen como texto mientras se escriben.
// Un campo vacío no debe convertirse automáticamente en una lectura cero.
export interface CamposPozos {
  pozo1Inicial: string
  pozo1Final: string
  pozo2Inicial: string
  pozo2Final: string
  notas: string
}

// Solo los valores editables, una vez validados.
// Supabase calcula los consumos y conserva autoría y fechas.
export interface ValoresPozos {
  pozo1_ini: number
  pozo1_fin: number
  pozo2_ini: number
  pozo2_fin: number
  notas: string | null
}
