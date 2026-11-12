// Navegación renderizada con cuentas simuladas; sin llamadas a Supabase.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
let server, Inicio, PanelAdministracion
before(async () => {
  server = await createServer({ configFile: false, envDir: false, cacheDir: '.tmp/vite-tests/novedades-navegacion', server: { middlewareMode: true, hmr: false }, plugins: [{
    name: 'novedades-navegacion', enforce: 'pre',
    resolveId(n) {
      if (n.endsWith('/hooks/useAuth')) return '\0nav-auth'
      if (n.endsWith('/AvisosEntrada')) return '\0nav-avisos'
      if (n.endsWith('/DashboardAdministracion')) return '\0nav-dashboard'
      if (/(^|\/)supabase(?:\.ts)?$/.test(n) && !n.startsWith('@')) return '\0nav-supabase'
    },
    load(n) {
      if (n === '\0nav-auth') return 'export const useAuth=()=>globalThis.__novedadesNavAuth'
      if (n === '\0nav-avisos') return 'export const AvisosEntrada=()=>null'
      if (n === '\0nav-dashboard') return 'export const DashboardAdministracion=()=>null'
      if (n === '\0nav-supabase') return 'export const supabase={}'
    },
  }, react()] })
  Inicio = (await server.ssrLoadModule('/src/pages/Inicio.tsx')).Inicio
  PanelAdministracion = (await server.ssrLoadModule('/src/components/administracion/PanelAdministracion.tsx')).PanelAdministracion
})
after(async () => { await server?.close(); delete globalThis.__novedadesNavAuth })
function render(rol, vista = 'inicio') {
  globalThis.__novedadesNavAuth = { estado: 'autenticado', perfil: { id: 'cuenta', nombre: 'Prueba', rol, activo: true }, sesion: { user: { id: 'cuenta' } }, cerrarSesion() {} }
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [vista === 'novedades' ? '/novedades' : vista === 'bitacora_admin' ? '/bitacora-administrativa' : '/'] }, createElement(Inicio, { vista })))
}
function menu(html) { return html.match(/<nav[^>]*aria-label="Navegación principal"[\s\S]*?<\/nav>/)?.[0] ?? '' }
test('Novedades es el último enlace superior únicamente para Calderas y PTAR', () => {
  for (const rol of ['calderas','ptar']) {
    const html = render(rol), nav = menu(html)
    const rutas = [...nav.matchAll(/href="([^"]+)"/g)].map(m => m[1])
    assert.equal(rutas.at(-1), '/novedades')
    assert.equal(rutas.filter(r => r === '/novedades').length, 1)
    assert.ok(!html.includes('co-sidebar'))
    if (rol === 'calderas') assert.ok(/Pozos[\s\S]*Ultrafiltración[\s\S]*Novedades/.test(nav))
  }
})
test('Inicio muestra una tarjeta de novedades administrativas para Calderas y PTAR, y la bitácora para Admin', () => {
  for (const rol of ['calderas','ptar','calidad']) {
    const html = render(rol)
    assert.ok(!html.includes('Novedades de Administración'))
    const modulos = html.match(/<nav[^>]*aria-label="Módulos disponibles"[\s\S]*?<\/nav>/)?.[0] ?? ''
    assert.equal(modulos.includes('/novedades'),rol!=='calidad')
    if(rol!=='calidad'){
      assert.match(modulos,/Novedades administrativas/)
      assert.equal([...modulos.matchAll(/href="\/novedades"/g)].length,1)
    }
    assert.ok(!modulos.includes('/bitacora-administrativa'))
  }
  const admin=render('admin').match(/<nav[^>]*aria-label="Módulos disponibles"[\s\S]*?<\/nav>/)?.[0]??''
  assert.match(admin,/href="\/bitacora-administrativa"/)
  assert.match(admin,/Bitácora administrativa/)
  assert.ok(!admin.includes('/novedades'))
})
test('la ruta mantiene el enlace activo y los accesos de Calderas y PTAR', () => {
  for (const rol of ['calderas','ptar']) {
    const nav = menu(render(rol,'novedades'))
    assert.match(nav,/aria-current="page"[^>]*href="\/novedades"|href="\/novedades"[^>]*aria-current="page"/)
    if (rol === 'calderas') assert.ok(nav.includes('Pozos') && nav.includes('Ultrafiltración'))
    if (rol === 'ptar') assert.ok(nav.includes('Bitácora'))
  }
})
test('Calidad no ve Novedades ni puede abrir directamente su página', () => {
  assert.ok(!menu(render('calidad')).includes('/novedades'))
  assert.equal(render('calidad','novedades'),'')
})
test('Administración conserva sus accesos sin la nueva opción operativa; App registra la ruta protegida', () => {
  assert.ok(!menu(render('admin')).includes('/novedades'))
  const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8')
  assert.match(app,/<Route path="\/novedades" element=\{<Inicio vista="novedades" \/>\} \/>/)
})
test('Bitácora administrativa es el acceso inmediato a Inicio, únicamente para Admin', () => {
  const nav = menu(render('admin'))
  const rutas = [...nav.matchAll(/href="([^"]+)"/g)].map(m => m[1])
  assert.deepEqual(rutas.slice(0, 2), ['/', '/bitacora-administrativa'])
  for (const rol of ['calderas','ptar','calidad']) assert.ok(!menu(render(rol)).includes('/bitacora-administrativa'))
  const activa = menu(render('admin','bitacora_admin'))
  assert.match(activa,/aria-current="page"[^>]*href="\/bitacora-administrativa"|href="\/bitacora-administrativa"[^>]*aria-current="page"/)
})
test('Administración ya no contiene la pestaña interna de Bitácora y la nueva ruta está registrada', () => {
  render('admin')
  const html = renderToStaticMarkup(createElement(PanelAdministracion))
  assert.ok(html.includes('Dashboard') && html.includes('Capturas'))
  assert.ok(!html.includes('Bitácora'))
  const app = readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8')
  assert.match(app,/<Route path="\/bitacora-administrativa" element=\{<Inicio vista="bitacora_admin" \/>\} \/>/)
})
