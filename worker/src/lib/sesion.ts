// PROVISIONAL para probar la ventanilla sin el backend: lee la sesión de la tabla "sesiones" (token en cookie o Bearer).
import type { Context, MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import type { Env, Usuario, Variables } from '../env'

type C = Context<{ Bindings: Env; Variables: Variables }>

export async function hash(token: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function usuarioDeSesion(c: C): Promise<Usuario | null> {
  const token = c.req.header('Authorization')?.replace(/^Bearer /, '') || getCookie(c, 'pneuma_sesion')
  if (!token) return null
  return c.env.DB.prepare(`SELECT u.id, u.correo, u.nombre, u.rol FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token_hash = ? AND s.expira_en > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`).bind(await hash(token)).first<Usuario>()
}

const sinSesion = (c: C) => c.json({ error: { codigo: 'sin_sesion', mensaje: 'Inicie sesión.' } }, 401)

export const requiereSesion: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (c, next) => {
  const u = c.get('usuario') ?? (await usuarioDeSesion(c))
  if (!u) return sinSesion(c)
  c.set('usuario', u)
  await next()
}

export const requiereRol = (...roles: Usuario['rol'][]): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> =>
  async (c, next) => {
    const u = c.get('usuario') ?? (await usuarioDeSesion(c))
    if (!u) return sinSesion(c)
    if (!roles.includes(u.rol)) return c.json({ error: { codigo: 'sin_permiso', mensaje: 'Su cuenta no tiene permiso.' } }, 403)
    c.set('usuario', u)
    await next()
  }
