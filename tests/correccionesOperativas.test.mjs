// Supabase simulado: sin consultas ni escrituras remotas.
import test,{before,after} from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'vite'
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
let server,mod,ptar,calderas,store,errores=[],respuesta,peticiones=[]
const contexto=()=>({turno_id:id(20),reporte_id:id(30),ahora:'2026-11-06T20:50:00Z',inicio:'2026-11-06T13:01:00Z',fin:'2026-11-06T21:01:00Z',fecha_operativa:'2026-11-06',turno:'dia',puede_editar:true,estado:'Enviado'})
const sesion=(rol='calderas',cuenta=id(2))=>store.setState({estado:'autenticado',perfil:{id:cuenta,nombre:'Prueba',rol,activo:true},sesion:{user:{id:cuenta}}})
before(async()=>{
 globalThis.__horario={rpc(nombre,args){peticiones.push({nombre,args});return{abortSignal:async signal=>{signal.throwIfAborted();const e=errores.shift();if(e)throw e;return typeof respuesta==='function'?respuesta():respuesta}}}}
 server=await createServer({configFile:false,envDir:false,cacheDir:'.tmp/vite-tests/correcciones-operativas',server:{middlewareMode:true,hmr:false},plugins:[{name:'sin-remoto',enforce:'pre',resolveId(n){if(/(^|\/)supabase(?:\.ts)?$/.test(n)&&!n.startsWith('@'))return '\0horario-supabase'},load(n){if(n==='\0horario-supabase')return 'export const supabase=globalThis.__horario'}}]})
 mod=await server.ssrLoadModule('/src/lib/reporteOperativo.ts');ptar=await server.ssrLoadModule('/src/lib/bitacoraTecnicaPTAR.ts');calderas=await server.ssrLoadModule('/src/lib/bitacoraTecnicaCalderas.ts');store=(await server.ssrLoadModule('/src/stores/authStore.ts')).useAuthStore
})
after(async()=>{await server.close();delete globalThis.__horario})
test('el permiso vence exactamente al límite del servidor y no usa el reloj de pared del equipo',()=>{
 const c=mod.leerContextoReporte({...contexto(),ahora:'2026-11-06T21:00:59Z'})
 assert.equal(mod.permisoVigente(c,999),true);assert.equal(mod.permisoVigente(c,1000),false)
 assert.equal(mod.permisoVigente(c,-1),false);assert.equal(mod.permisoVigente(mod.leerContextoReporte(contexto()),60000),false)
 assert.throws(()=>mod.leerContextoReporte({...contexto(),ahora:contexto().fin}),/horario/)
})
test('Noche conserva fecha operativa anterior y usa hora de registro del servidor',()=>{
 const c=mod.leerContextoReporte({...contexto(),fecha_operativa:'2026-11-04',turno:'noche',inicio:'2026-11-05T03:01:00Z',fin:'2026-11-05T13:01:00Z',ahora:'2026-11-05T11:00:00Z'})
 assert.equal(c.fechaOperativa,'2026-11-04');assert.equal(mod.permisoVigente(c,0),true)
 assert.equal(mod.leerContextoReporte({...contexto(),puede_editar:false,estado:'Cerrado con pendientes'}).puedeEditar,false)
})
test('RPC faltante conserva compatibilidad; error de horario no concede edición y cambio de cuenta rechaza respuesta',async()=>{
 sesion();errores=[];peticiones=[];respuesta={data:null,error:{code:'PGRST202'}}
 assert.equal(await mod.consultarContextoReporte(id(2),'calderas',id(20),new AbortController().signal),null)
 respuesta={data:null,error:{code:'42501'}};await assert.rejects(mod.consultarContextoReporte(id(2),'calderas',id(20),new AbortController().signal))
 respuesta=()=>{sesion('calidad');return{data:contexto(),error:null}}
 await assert.rejects(mod.consultarContextoReporte(id(2),'calderas',id(20),new AbortController().signal),/autorizada/)
 sesion('calidad');await assert.rejects(mod.consultarContextoReporte(id(2),'calderas',id(20),new AbortController().signal),/autorizada/)
})
test('corregir no convierte el ID de solicitud en otro reporte y conserva revisión esperada al reintentar',async()=>{
 sesion('ptar',id(3));peticiones=[];errores=[new Error('Confirmación perdida')]
 const envio={id:id(40),reporteId:id(30),turnoId:id(20),cuentaId:id(3),revisionEsperada:2,creadoEn:'2026-11-06T14:00:00Z',operativo:true,datos:{}}
 await assert.rejects(ptar.enviarReportePTAR(envio,new AbortController().signal),e=>e.incierto)
 respuesta={data:null,error:{code:'40001'}};await assert.rejects(ptar.enviarReportePTAR(envio,new AbortController().signal),e=>e.conflicto&&!e.incierto)
 assert.equal(peticiones.length,2);assert.deepEqual(peticiones[0],peticiones[1])
 assert.equal(peticiones[0].nombre,'guardar_reporte_operativo');assert.equal(peticiones[0].args.p_reporte_id,id(30));assert.equal(peticiones[0].args.p_revision_esperada,2)
})
test('borrar opcionales en corrección envía ausencia explícita; una captura vacía sigue rechazada',async()=>{
 const {borradorBitacoraPTAR,medicionesBitacoraPTAR}=await server.ssrLoadModule('/src/lib/tiposBitacoraPTAR.ts')
 const b=borradorBitacoraPTAR();assert.throws(()=>ptar.prepararDatosPTAR(b))
 b.reporteRelevante='Turno';for(const m of medicionesBitacoraPTAR)b.mediciones[m.campo]='1'
 b.estadoAgitador='Servicio';b.destinoDescarga='Tanque 11';b.horasDescarga={tanque11:'1',tanques56:'0'}
 b.bombas={'9':'Automático (A)','13':'Manual (M)','9310':'Automático (A)'};b.prensas={Essity:'Servicio',Nalco:'Mantenimiento'}
 const original=structuredClone(b);original.velocidadesPrensas={Essity:'42.5',Nalco:'0'}
 assert.deepEqual(ptar.prepararDatosPTAR(b,original).velocidadesPrensas,{Essity:null,Nalco:null});assert.equal('velocidadesPrensas' in ptar.prepararDatosPTAR(b),false)
 const {borradorBitacoraCalderas}=await server.ssrLoadModule('/src/lib/tiposBitacoraCalderas.ts');assert.throws(()=>calderas.prepararDatosCalderas(borradorBitacoraCalderas()))
})

test('guardar sin cambios es informativo; otros rechazos siguen siendo errores y una respuesta perdida conserva el reintento',async()=>{
 for(const [area,servicio,cuenta] of [['calderas',calderas,id(2)],['ptar',ptar,id(3)]]){
  sesion(area,cuenta);errores=[];peticiones=[]
  const envio={id:id(40),reporteId:id(30),turnoId:id(20),cuentaId:cuenta,revisionEsperada:2,creadoEn:'2026-11-06T14:00:00Z',operativo:true,datos:{}}
  const enviar=()=>servicio[area==='ptar'?'enviarReportePTAR':'enviarReporteCalderas'](envio,new AbortController().signal)
  respuesta={data:null,error:{code:'22023',message:'No hay cambios para registrar.'}}
  await assert.rejects(enviar(),e=>e.sinCambios&&!e.incierto&&!e.conflicto&&e.message==='No hay cambios para guardar.')
  respuesta={data:null,error:{code:'22023',message:'Completa todos los campos obligatorios antes de enviar.'}}
  await assert.rejects(enviar(),e=>!e.sinCambios&&!e.incierto)
  respuesta={data:null,error:{code:'40001',message:'El reporte cambió.'}}
  await assert.rejects(enviar(),e=>!e.sinCambios&&e.conflicto)
  errores=[new Error('Respuesta perdida')]
  await assert.rejects(enviar(),e=>!e.sinCambios&&e.incierto)
 }
})
test('Calidad no consulta pendientes de supervisión y se rechazan grupos fuera del filtro',async()=>{
 sesion('calidad');await assert.rejects(mod.consultarPendientesTecnicos(id(2),{desde:'2026-11-01',hasta:'2026-11-06',area:'todas'},0,new AbortController().signal),/autorizada/)
 sesion('admin',id(1));respuesta={data:{mas:false,filas:[{turno_id:id(20),area:'ptar',turno:'dia',fecha_operativa:'2026-11-07',reporte_id:null,operador:'Prueba',operador_acompanante:null}]},error:null}
 await assert.rejects(mod.consultarPendientesTecnicos(id(1),{desde:'2026-11-01',hasta:'2026-11-06',area:'todas'},0,new AbortController().signal),/filtros/)
})

test('notas opcionales se preparan como NA o mayúsculas sin completar mediciones ni alterar originales',async()=>{
 const pozos=await server.ssrLoadModule('/src/lib/pozos.ts'),uf=await server.ssrLoadModule('/src/lib/uf.ts')
 const calidad=await server.ssrLoadModule('/src/lib/calidad.ts'),ptarCaptura=await server.ssrLoadModule('/src/lib/ptar.ts')
 const bitacora=await server.ssrLoadModule('/src/lib/bitacora.ts')
 for(const notas of ['', ' \n\t ', 'revisión de válvulas\nservicio']){
  const esperado=notas.trim()? 'REVISIÓN DE VÁLVULAS\nSERVICIO':'NA'
  const p={pozo1Inicial:'1',pozo1Final:'2',pozo2Inicial:'3',pozo2Final:'4',notas}
  assert.equal(pozos.validarCamposPozos(p).notas,esperado);assert.equal(p.notas,notas)
  assert.equal(uf.validarCamposUF({alimentacionInicial:'0',alimentacionFinal:'20',aceptacionInicial:'0',aceptacionFinal:'15',notas}).notas,esperado)
  assert.equal(calidad.validarCamposCalidad({notas,valores:{[id(10)+':'+id(11)]:'10'}}).notas,esperado)
  const {medicionesPTAR}=await server.ssrLoadModule('/src/lib/tiposPTAR.ts')
  const valores={...Object.fromEntries(medicionesPTAR.map(({campo})=>[campo,'1'])),notas}
  assert.equal(ptarCaptura.validarCamposPTAR(valores).notas,esperado)
 }
 assert.throws(()=>bitacora.validarCamposBitacora({texto:''}),/Escribe lo relevante/)
 assert.equal(bitacora.validarCamposBitacora({texto:'revisión de válvulas'}).texto,'REVISIÓN DE VÁLVULAS')
 assert.throws(()=>uf.validarCamposUF({alimentacionInicial:'',alimentacionFinal:'',aceptacionInicial:'',aceptacionFinal:'',notas:''}))
 const t=await server.ssrLoadModule('/src/lib/tiposBitacoraCalderas.ts'),b=t.borradorBitacoraCalderas()
 b.reporteRelevante='reporte del turno';b.estadoUF='Servicio'
 for(const k of Object.keys(b.mediciones))b.mediciones[k]='1'
 for(const e of t.equiposCalderas)b.equipos[e.id]={estado:'Servicio',presion:e.id.startsWith('sulzer_')?'1':''}
 for(const p of t.pilasCalderas)b.pilas[p.id]={nivel:'1',presion:'1',bomba:p.bombas[0]}
 for(const k of Object.keys(b.compresores))b.compresores[k]='Servicio'
 const d=calderas.prepararDatosCalderas(b)
 assert.equal(d.comentariosUF,'NA');assert.equal(d.comentariosPilas,'NA');assert.equal(d.reporteRelevante,'REPORTE DEL TURNO')
 assert.equal(d.comentariosCompresores,'NA')
 assert.deepEqual(t.equiposCalderas.slice(4).map(e=>e.nombre),['Sulzer 435','Sulzer 469','Sulzer 470','Sulzer 456'])
 b.comentariosCompresores='  revisión de válvula  '
 b.equipos.sulzer_436={estado:'Reserva',presion:'dato anterior no numérico'}
 b.equipos.sulzer_469={estado:'Mantenimiento',presion:''}
 const sinServicio=calderas.prepararDatosCalderas(b)
 assert.equal(sinServicio.comentariosCompresores,'REVISIÓN DE VÁLVULA')
 assert.equal(sinServicio.equipos.sulzer_436.presion,'0');assert.equal(sinServicio.equipos.sulzer_469.presion,'0')
 assert.equal(b.equipos.sulzer_436.presion,'dato anterior no numérico','preparar el envío no modifica el borrador histórico')
 b.equipos.sulzer_436={estado:'Servicio',presion:''}
 assert.throws(()=>calderas.prepararDatosCalderas(b),/Presión de Sulzer 435/)
 b.equipos.sulzer_436.presion='2.5'
 assert.equal(calderas.prepararDatosCalderas(b).equipos.sulzer_436.presion,'2.5')
 b.comentariosCompresores='a'.repeat(4001)
 assert.throws(()=>calderas.prepararDatosCalderas(b),/comentarios de Compresores/)
 b.comentariosCompresores=''
 const individuales=await server.ssrLoadModule('/src/lib/reportesIndividuales.ts')
 b.reportesOperadores=[{nombre:'OPERADOR PRINCIPAL',comentario:'revisión de bombas'},{nombre:'OPERADOR ACOMPAÑANTE',comentario:'limpieza de filtros'}]
 b.reporteRelevante=individuales.resumenReportesIndividuales(b.reportesOperadores)
 const porOperador=calderas.prepararDatosCalderas(b)
 assert.deepEqual(porOperador.reportesOperadores,{principal:'REVISIÓN DE BOMBAS',acompanante:'LIMPIEZA DE FILTROS'})
 assert.equal(porOperador.reporteRelevante,'OPERADOR 1:\nREVISIÓN DE BOMBAS\n\nOPERADOR 2:\nLIMPIEZA DE FILTROS')
 b.reportesOperadores[1].comentario=' '
 assert.throws(()=>calderas.prepararDatosCalderas(b),/dos operadores/)
 delete b.reportesOperadores
 b.reporteRelevante='';assert.throws(()=>calderas.prepararDatosCalderas(b),/reporte relevante/)
})

test('reportes individuales: históricos sin autoría se conservan y se valida el límite conjunto',async()=>{
 const r=await server.ssrLoadModule('/src/lib/reportesIndividuales.ts')
 assert.equal(r.leerReportesIndividuales(null),undefined)
 assert.equal(r.prepararReportesIndividuales(undefined),undefined)
 const pareja=[{nombre:'Nombre <uno>',comentario:'primera línea\nsegunda línea'},{nombre:'Nombre dos',comentario:'revisión'}]
 assert.deepEqual(r.leerReportesIndividuales(pareja),pareja)
 assert.throws(()=>r.leerReportesIndividuales([pareja[0]]),/dos operadores/)
 pareja[0].comentario='a'.repeat(2000);pareja[1].comentario='b'.repeat(2000)
 assert.throws(()=>r.prepararReportesIndividuales(pareja),/4,000/)
})

