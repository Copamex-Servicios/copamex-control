export type IconoNombre =
  | 'inicio'
  | 'calderas'
  | 'ptar'
  | 'planta'
  | 'reportes'
  | 'administracion'
  | 'menu'
  | 'cerrar'
  | 'salir'
  | 'flecha'
  | 'cuenta'
  | 'modulos'
  | 'bitacora'
  | 'pozos'
  | 'uf'
  | 'calidad'
  | 'cuentaadm'
export const imagenes: Record<Exclude<IconoNombre, 'flecha'>, string> = {
  inicio: 'iconos-opt/inicio-d8cc85767741.webp',
  calderas: 'iconos-opt/calderas-ff5bdc0af2f1.webp',
  ptar: 'iconos-opt/ptar-825f47262c90.webp',
  planta: 'iconos-opt/planta-79dd2db46169.webp',
  reportes: 'iconos-opt/reportes-6d30e36cec07.webp',
  administracion: 'iconos-opt/administracion-fff59f40b23b.webp',
  menu: 'iconos-opt/menu-23ee78caee1e.webp',
  cerrar: 'iconos-opt/cerrar-fbda9856ddd6.webp',
  salir: 'iconos-opt/salir-92a73f2cb4d0.webp',
  cuenta: 'iconos-opt/cuenta-6ebdf6fcc89a.webp',
  modulos: 'iconos-opt/modulos-d9e58b0cdad0.webp',
  bitacora: 'iconos-opt/bitacora-104ff247175a.webp',
  pozos: 'iconos-opt/pozos-173f5d78a420.webp',
  uf: 'iconos-opt/uf-40d12cadd032.webp',
  calidad: 'iconos-opt/calidad-b98c0bb8b512.webp',
  cuentaadm: 'iconos-opt/cuentaadm-80772ad1be09.webp',
}

// La precarga no bloquea el acceso ni depende de datos de la cuenta.
const solicitudesIconos = new Set<string>()

export function precargarIconos(): void {
  for (const archivo of Object.values(imagenes)) {
    if (!archivo.startsWith('iconos-opt/')) continue
    const url = import.meta.env.BASE_URL + archivo
    if (solicitudesIconos.has(url)) continue
    solicitudesIconos.add(url)
    const imagen = new Image()
    imagen.fetchPriority = 'low'
    imagen.decoding = 'async'
    imagen.src = url
    void imagen.decode().catch(() => solicitudesIconos.delete(url))
  }
}

