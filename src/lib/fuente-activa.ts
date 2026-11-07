import { fuenteApi } from './fuente-api'
import { fuenteDemo } from './fuente-demo'

// VITE_DEMO=1 (modo de desarrollo y build:demo) usa los libros de muestra; si no, la API de Cloudflare.
export const modoDemo = import.meta.env.VITE_DEMO === '1'
export const fuente = modoDemo ? fuenteDemo : fuenteApi
