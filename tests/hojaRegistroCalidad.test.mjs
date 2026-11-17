import test from 'node:test'
import assert from 'node:assert/strict'
import {hojasRegistroCalidad,resultadosHojaCalidad} from '../src/lib/hojaRegistroCalidad.ts'
const muestra=(id,hora,extra=false)=>({turno:{id:'turno'},lectura:{id,turno_id:'turno',
 capturado_en:`2026-11-12T${hora}:00Z`,...(extra?{seguimientoId:'seguimiento'}:{}),
 resultados:[{id:'resultado-'+id,valor:42}]}})
test('con dos o tres registros habituales las adicionales solo se anexan al último',()=>{
 const originales=[muestra('a','13:00'),muestra('b','14:00'),muestra('c','15:00')]
 const adicionales=[muestra('extra1','16:00',true),muestra('extra2','17:00',true)]
 const copia=JSON.stringify(originales)
 const hojas=hojasRegistroCalidad(originales,originales[2],adicionales)
 assert.deepEqual(hojas.map(h=>h.adicionales.length),[0,0,2])
 assert.deepEqual(resultadosHojaCalidad(hojas[2].registro,hojas[2].adicionales).map(f=>f.resultado.id),
  ['resultado-c','resultado-extra1','resultado-extra2'])
 assert.equal(JSON.stringify(originales),copia)
})
test('incluye el último registro aunque no esté en la página cargada y evita duplicarlo',()=>{
 const primero=muestra('a','13:00'),ultimo=muestra('b','14:00'),extra=muestra('e','15:00',true)
 assert.deepEqual(hojasRegistroCalidad([primero],ultimo,[extra]).map(h=>h.registro.lectura.id),['a','b'])
 assert.equal(hojasRegistroCalidad([primero,ultimo],ultimo,[extra]).length,2)
})
test('conserva las adicionales si se anuló la muestra habitual y rechaza mezclar turnos',()=>{
 const extra=muestra('e','15:00',true)
 assert.equal(hojasRegistroCalidad([],null,[extra])[0].registro,extra)
 const ajena=structuredClone(extra);ajena.lectura.turno_id='otro'
 assert.throws(()=>resultadosHojaCalidad(muestra('a','13:00'),[ajena]),/mismo turno/)
 assert.throws(()=>resultadosHojaCalidad(extra,[extra]),/repetidos/)
})
