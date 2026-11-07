// PROVISIONAL: Worker mínimo para probar la ventanilla. El backend tiene el index.ts real.
import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import type { Env, Variables } from './env'
import { hash, usuarioDeSesion } from './lib/sesion'
import { montarVentanilla } from './ventanilla'

const app = new Hono<{ Bindings: Env; Variables: Variables }>()

app.get('/api/yo', async (c) => {
  const u = await usuarioDeSesion(c)
  return u ? c.json(u) : c.json({ error: { codigo: 'sin_sesion', mensaje: 'Inicie sesión.' } }, 401)
})

// Solo en modo demo: entrar con un correo sin enlace mágico.
app.post('/api/demo/entrar', async (c) => {
  if (c.env.MODO_DEMO !== '1') return c.notFound()
  const { correo } = await c.req.json<{ correo: string }>()
  const u = await c.env.DB.prepare('SELECT id FROM usuarios WHERE correo = ?').bind(correo).first<{ id: string }>()
  if (!u) return c.json({ error: { codigo: 'no_encontrado', mensaje: 'No existe esa cuenta.' } }, 404)
  const token = crypto.randomUUID()
  await c.env.DB.prepare(`INSERT INTO sesiones (token_hash, usuario_id, expira_en) VALUES (?, ?, ?)`)
    .bind(await hash(token), u.id, new Date(Date.now() + 30 * 86_400_000).toISOString()).run()
  setCookie(c, 'pneuma_sesion', token, { httpOnly: true, sameSite: 'Lax', path: '/' })
  return c.json({ token })
})

montarVentanilla(app)
export default app
