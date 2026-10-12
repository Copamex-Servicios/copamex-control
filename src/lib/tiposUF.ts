// Fase 4: datos de lecturas_uf y campos del formulario.
// El turno vincula la captura con el área y el operador.

export interface LecturaUF {
  id: string
  turno_id: string
  alim_ini: number
  alim_fin: number
  alimentado: number
  acep_ini: number
  acep_fin: number
  aceptado: number
  rechazo: number
  rendimiento: number | null
  notas: string | null
  capturado_en: string
  recibido_en: string
  creado_por: string
  eliminado_en: string | null
  eliminado_por: string | null
}

// Los campos permanecen como texto mientras se escriben.
// Un campo vacío no debe convertirse automáticamente en una lectura cero.
export interface CamposUF {
  alimentacionInicial: string
  alimentacionFinal: string
  aceptacionInicial: string
  aceptacionFinal: string
  notas: string
}

// Solo los valores editables, una vez validados.
// Supabase calcula los consumos y conserva autoría y fechas.
export interface ValoresUF {
  alim_ini: number
  alim_fin: number
  acep_ini: number
  acep_fin: number
  notas: string | null
}
