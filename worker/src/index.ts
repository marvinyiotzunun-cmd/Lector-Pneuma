import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { App, Env } from './env'
import { cargarSesion } from './lib/sesion'
import { ahora, ErrorApi } from './lib/util'
import { admin } from './rutas/admin'
import { asistente } from './rutas/asistente'
import { auth } from './rutas/auth'
import { catalogo } from './rutas/catalogo'
import { lector } from './rutas/lector'
import { interno, pedidos } from './rutas/pedidos'

export { enviarCorreo } from './lib/correo'
export { requiereRol, requiereSesion, usuarioDeSesion } from './lib/sesion'

const app = new Hono<App>().basePath('/api')

// La API comparte dominio con el sitio; CORS solo para desarrollo local y la app (Capacitor).
app.use(
  '*',
  cors({
    origin: (origen, c) => {
      const permitidos = [c.env.SITIO_URL, 'http://localhost:5173', 'http://localhost:4321', 'capacitor://localhost', 'https://localhost']
      return permitidos.includes(origen) ? origen : null
    },
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    exposeHeaders: ['X-Pneuma-Huella', 'X-Pneuma-Tipo'],
  }),
)
app.use('*', cargarSesion)

app.get('/salud', (c) => c.json({ ok: true, hora: ahora() }))
app.route('/', auth)
app.route('/', catalogo)
app.route('/', lector)
app.route('/', pedidos)
app.route('/', asistente)
app.route('/interno', interno)
app.route('/admin', admin)
// Ventanilla y paneles (otro módulo): app.route('/ventanilla', ventanilla); app.route('/admin', adminVentanilla)

app.notFound((c) => c.json({ error: { codigo: 'no_existe', mensaje: 'Ruta no encontrada.' } }, 404))
app.onError((e, c) => {
  if (e instanceof ErrorApi) {
    return c.json({ error: { codigo: e.codigo, mensaje: e.message }, ...(e.extra ?? {}) }, e.status)
  }
  console.error(e)
  return c.json({ error: { codigo: 'error_interno', mensaje: 'Algo salió mal. Intenta de nuevo.' } }, 500)
})

/** Tarea diaria: vence suscripciones y limpia datos temporales. */
async function mantenimiento(env: Env) {
  const t = ahora()
  const hace90 = new Date(Date.now() - 90 * 86_400_000).toISOString()
  const hace2 = new Date(Date.now() - 2 * 86_400_000).toISOString()
  await env.DB.batch([
    env.DB.prepare("UPDATE suscripciones SET estado = 'vencida' WHERE estado = 'activa' AND vence_en <= ?").bind(t),
    env.DB.prepare('DELETE FROM enlaces_acceso WHERE expira_en < ?').bind(hace2),
    env.DB.prepare('DELETE FROM sesiones WHERE expira_en < ?').bind(t),
    // Las huellas se conservan 90 días para rastrear filtraciones.
    env.DB.prepare('DELETE FROM eventos_lectura WHERE creado_en < ?').bind(hace90),
    // Pedidos con tarjeta o PayPal que nadie pagó en 3 días.
    env.DB.prepare(
      "UPDATE pedidos SET estado = 'cancelado', notas = COALESCE(notas || char(10), '') || 'Vencido sin pago' WHERE estado = 'pendiente' AND metodo IN ('recurrente','paypal') AND creado_en < ?",
    ).bind(new Date(Date.now() - 3 * 86_400_000).toISOString()),
  ])
}

export default {
  fetch: app.fetch,
  scheduled: async (_ev: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(mantenimiento(env))
  },
} satisfies ExportedHandler<Env>

export { app }
