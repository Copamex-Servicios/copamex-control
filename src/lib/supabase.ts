import { createClient } from '@supabase/supabase-js'
import { almacenamientoSesion } from './almacenamientoSesion'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Falta configurar Supabase en .env.local')
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage: almacenamientoSesion,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})