import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const clave = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// Sin variables de entorno la app funciona en modo demostración (libros de muestra y datos en este dispositivo).
export const supabase = url && clave ? createClient(url, clave) : null
export const modoDemo = !supabase
