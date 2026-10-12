import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import type { EstadoAuth, Perfil } from '../lib/tiposAuth'

interface DatosAuth {
  sesion: Session | null
  perfil: Perfil | null
  estado: EstadoAuth
  mensaje: string | null
}

interface AuthStore extends DatosAuth {
  establecerEstado: (datos: DatosAuth) => void
}

export const useAuthStore = create<AuthStore>()((set) => ({
  sesion: null,
  perfil: null,
  estado: 'cargando',
  mensaje: null,
  establecerEstado: (datos) => set(datos),
}))