import { fuenteApi, sinConexionApi } from './fuente-api'
import { fuenteDemo, sinConexionDemo } from './fuente-demo'
import { conSinConexion } from '../sinconexion/sin-conexion'
import { esApp } from './dispositivo'

// VITE_DEMO=1 (modo de desarrollo y build:demo) usa los libros de muestra; si no, la API de Cloudflare.
export const modoDemo = import.meta.env.VITE_DEMO === '1'
export const red = modoDemo ? sinConexionDemo : sinConexionApi
export const fuente = conSinConexion(modoDemo ? fuenteDemo : fuenteApi)
// La descarga cifrada es de la app Android; en la demostración también se muestra en el navegador.
export const permiteSinConexion = () => esApp() || modoDemo
