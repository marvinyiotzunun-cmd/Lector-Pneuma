// Punto de montaje de la ventanilla y los paneles. En worker/src/index.ts basta con: montarVentanilla(app)
import type { Hono, Schema } from 'hono'
import type { App } from '../env'
import { adminContenidos, contenidosPublicos } from '../admin/contenidos'
import { adminExpedientes } from '../admin/expedientes'
import { adminPersonas } from '../admin/personas'
import { ventanilla } from './rutas'

/** Recibe la app con basePath('/api'). */
export function montarVentanilla(app: Hono<App, Schema, '/api'>) {
  app.route('/ventanilla', ventanilla)
  app.route('/', contenidosPublicos)          // /api/contenidos, /api/formatos, /api/proceso/etapas
  app.route('/admin', adminExpedientes)   // /api/admin/expedientes, /api/admin/etapas
  app.route('/admin', adminContenidos)    // /api/admin/contenidos, /api/admin/formatos
  app.route('/admin', adminPersonas)      // /api/admin/ministerios, usuarios, accesos, lecturas
}
