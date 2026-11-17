import test from 'node:test'
import assert from 'node:assert/strict'
import { parametrosParaPuntoCalidad } from '../src/lib/configuracionCalidad.ts'

const punto = (id, area = null) => ({ id, nombre:'Nombre editable', area, activo:true, orden:1 })
const parametros = [
 { id:'color', nombre:'Color', activo:true, areas_captura:['calderas','ptar'], puntos_permitidos:null, evaluar_limites:true },
 { id:'sst', nombre:'SST', activo:true, areas_captura:['calderas','ptar'], puntos_permitidos:['m2','m4'], evaluar_limites:false },
 { id:'turbidez', nombre:'Turbidez', activo:true, areas_captura:['calderas','ptar'], puntos_permitidos:['aimsu'], evaluar_limites:true },
]
test('SST solo aparece en M2/M4; no amplía la captura a los demás puntos', () => {
 for (const area of ['calderas','ptar']) {
  for (const id of ['m2','m4']) assert.deepEqual(parametrosParaPuntoCalidad(parametros,punto(id),area).map(p=>p.id),['color','sst'])
  assert.deepEqual(parametrosParaPuntoCalidad(parametros,punto('pozo'),area).map(p=>p.id),['color'])
  assert.deepEqual(parametrosParaPuntoCalidad(parametros,punto('aimsu'),area).map(p=>p.id),['color','turbidez'])
 }
})
test('reglas por configuración soportan nuevos parámetros y cambios de nombres', () => {
 const nuevo = { id:'nuevo', nombre:'Otro parámetro', activo:true, areas_captura:['ptar'], puntos_permitidos:['pozo'], evaluar_limites:false }
 assert.deepEqual(parametrosParaPuntoCalidad([nuevo],punto('pozo'),'ptar'),[nuevo])
 assert.deepEqual(parametrosParaPuntoCalidad([nuevo],punto('pozo'),'calderas'),[])
 assert.equal(parametrosParaPuntoCalidad(parametros.map(p=>({...p,nombre:'Renombrado'})),punto('m4'),'calderas')[1].evaluar_limites,false)
})
test('respeta inactivos y áreas de los puntos', () => {
 assert.deepEqual(parametrosParaPuntoCalidad(parametros,{...punto('m4'),activo:false},'calderas'),[])
 assert.deepEqual(parametrosParaPuntoCalidad(parametros,punto('m4','ptar'),'calderas'),[])
 assert.deepEqual(parametrosParaPuntoCalidad(parametros.map(p=>({...p,activo:false})),punto('m4'),'ptar'),[])
})
