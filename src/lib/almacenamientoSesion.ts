const clavePreferencia = 'copamex:mantener-sesion'

export function obtenerMantenerSesion(): boolean {
  return window.sessionStorage.getItem(clavePreferencia) !== 'false'
}

export function configurarMantenerSesion(mantener: boolean): void {
  window.sessionStorage.setItem(clavePreferencia, String(mantener))
}

function obtenerAlmacenamiento(): Storage {
  return obtenerMantenerSesion()
    ? window.localStorage
    : window.sessionStorage
}

export const almacenamientoSesion = {
  getItem(clave: string): string | null {
    return obtenerAlmacenamiento().getItem(clave)
  },

  setItem(clave: string, valor: string): void {
    const mantener = obtenerMantenerSesion()
    const destino = mantener ? window.localStorage : window.sessionStorage
    const anterior = mantener ? window.sessionStorage : window.localStorage

    destino.setItem(clave, valor)
    anterior.removeItem(clave)
  },

  removeItem(clave: string): void {
    window.localStorage.removeItem(clave)
    window.sessionStorage.removeItem(clave)
  },
}