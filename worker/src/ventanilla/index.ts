// Punto de montaje de la ventanilla y los paneles. En worker/src/index.ts basta con: montarVentanilla(app)
import type { Hono } from 'hono'
import type { Env, Variables } from '../env'
import { adminContenidos, contenidosPublicos } from '../admin/contenidos'
import { adminExpedientes } from '../admin/expedientes'
import { adminPersonas } from '../admin/personas'
import { ventanilla } from './rutas'

export function montarVentanilla(app: Hono<{ Bindings: Env; Variables: Variables }>) {
  app.route('/api/ventanilla', ventanilla)
  app.route('/api', contenidosPublicos)       // /api/contenidos, /api/formatos
  app.route('/api/admin', adminExpedientes)   // /api/admin/expedientes, /api/admin/etapas
  app.route('/api/admin', adminContenidos)    // /api/admin/contenidos, /api/admin/formatos
  app.route('/api/admin', adminPersonas)      // /api/admin/ministerios, usuarios, accesos, lecturas
}
