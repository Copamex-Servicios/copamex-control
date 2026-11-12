import test from 'node:test'
import assert from 'node:assert/strict'
import { formatoTextoBitacora as formato } from '../src/lib/formatoTextoBitacora.ts'

test('minúscula tras el día y mayúscula después de fin de oración sin reescribir el texto', () => {
  const original='SE REALIZÓ MANTENIMIENTO A LAS BOMBAS. SE VERIFICÓ EL FUNCIONAMIENTO DE LA PTAR.'
  assert.equal(formato(original),'se realizó mantenimiento a las bombas. Se verificó el funcionamiento de la PTAR.')
  assert.equal(original,'SE REALIZÓ MANTENIMIENTO A LAS BOMBAS. SE VERIFICÓ EL FUNCIONAMIENTO DE LA PTAR.')
  assert.equal(formato('sE ReAlIzÓ revisión. tOdO bIeN'),'se realizó revisión. Todo bien')
})
test('conserva siglas y nombres operativos conocidos en texto de cualquier caja', () => {
  assert.equal(formato('ptar, uf, daf, aimsu, sst, dqo y copamex con ESSITY, NALCO Y SULZER.'),'PTAR, UF, DAF, AIMSU, SST, DQO y COPAMEX con Essity, Nalco y Sulzer.')
})
test('decimales y unidades no generan falsas oraciones ni cambian valores', () => {
  assert.equal(formato('SE MIDIERON 42.5 M/MIN, 3,8 BAR, 12 L/S, PH 7.5 Y 5 KW. TODO BIEN.'),'se midieron 42.5 m/min, 3,8 bar, 12 L/s, pH 7.5 y 5 kW. Todo bien.')
  assert.equal(formato('FLUJO 12 m³/h Y 0.000000000000000001 kg/cm².'),'flujo 12 m³/h y 0.000000000000000001 kg/cm².')
})
test('identificadores de equipo y abreviaturas conservan su estructura', () => {
  assert.equal(formato('SE REVISÓ b-13. TODO BIEN EN m-2.'),'se revisó B-13. Todo bien en M-2.')
  assert.equal(formato('SE REVISÓ CON EL ING. DE TURNO. SE VALIDÓ.'),'se revisó con el Ing. de turno. Se validó.')
})
test('preserva enlaces y correos; respeta caracteres XML y saltos sin perder contenido', () => {
  assert.equal(formato('SE CONSULTÓ https://Ejemplo.com/Informe. TODO SE ENVIÓ A Nombre@Empresa.com.'),'se consultó https://Ejemplo.com/Informe. Todo se envió a Nombre@Empresa.com.')
  assert.equal(formato('REVISIÓN <BOMBA> & "EQUIPO".\n\nSE CONTINÚA $& {{MES}}.'),'revisión <bomba> & "equipo".\n\nSe continúa $& {{mes}}.')
  assert.equal(formato('\uE0000\uE001 PTAR. TODO.'),'\uE0000\uE001 PTAR. Todo.')
})
test('puntos decimales, fechas y exclamaciones no alteran números; formato vacío estable', () => {
  assert.equal(formato('SE REGISTRÓ 05.11.2026 A 42.5. DESPUÉS SE REVISÓ.'),'se registró 05.11.2026 a 42.5. Después se revisó.')
  assert.equal(formato('TODO BIEN! SE REVISÓ? SÍ.'),'todo bien! Se revisó? Sí.')
  assert.equal(formato(''),'')
})
