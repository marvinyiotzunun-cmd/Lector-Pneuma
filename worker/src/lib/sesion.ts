import type { Context, MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import type { App, Rol, Usuario } from '../env'
import { sha256 } from './cripto'
import { ahora, falla } from './util'

export const COOKIE_SESION = 'pneuma_sesion'
export const DIAS_SESION = 30

function tokenDeLaPeticion(c: Context<App>): string | null {
  const auth = c.req.header('authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim() || null
  return getCookie(c, COOKIE_SESION) ?? null
}

/**
 * Lee la sesión (cookie pneuma_sesion o Authorization: Bearer) y deja el usuario en c.get('usuario').
 * Se monta una vez en /api/*; los módulos usan requiereSesion / requiereRol.
 */
export const cargarSesion: MiddlewareHandler<App> = async (c, next) => {
  c.set('usuario', null)
  c.set('dispositivoId', null)
  c.set('sesionHash', null)
  const token = tokenDeLaPeticion(c)
  // El token interno no es una sesión de usuario.
  if (token && token !== c.env.INTERNAL_TOKEN) {
    const hash = await sha256(token)
    const fila = await c.env.DB.prepare(
      `SELECT u.id, u.correo, u.nombre, u.telefono, u.rol, s.dispositivo_id, s.ultimo_uso, d.revocado_en
         FROM sesiones s
         JOIN usuarios u ON u.id = s.usuario_id
         LEFT JOIN dispositivos d ON d.id = s.dispositivo_id
        WHERE s.token_hash = ? AND s.expira_en > ?`,
    )
      .bind(hash, ahora())
      .first<Usuario & { dispositivo_id: string | null; ultimo_uso: string | null; revocado_en: string | null }>()
    if (fila && !fila.revocado_en) {
      c.set('usuario', { id: fila.id, correo: fila.correo, nombre: fila.nombre, telefono: fila.telefono, rol: fila.rol })
      c.set('dispositivoId', fila.dispositivo_id)
      c.set('sesionHash', hash)
      // Actualiza el último uso como mucho cada 10 minutos.
      if (!fila.ultimo_uso || Date.now() - Date.parse(fila.ultimo_uso) > 600_000) {
        const t = ahora()
        const stmts = [c.env.DB.prepare('UPDATE sesiones SET ultimo_uso = ? WHERE token_hash = ?').bind(t, hash)]
        if (fila.dispositivo_id) {
          stmts.push(c.env.DB.prepare('UPDATE dispositivos SET ultimo_uso = ? WHERE id = ?').bind(t, fila.dispositivo_id))
        }
        c.executionCtx.waitUntil(c.env.DB.batch(stmts))
      }
    }
  }
  await next()
}

export async function usuarioDeSesion(c: Context<App>): Promise<Usuario | null> {
  return c.get('usuario') ?? null
}

export const requiereSesion: MiddlewareHandler<App> = async (c, next) => {
  if (!c.get('usuario')) throw falla(401, 'sin_sesion', 'Inicia sesión para continuar.')
  await next()
}

export function requiereRol(...roles: Rol[]): MiddlewareHandler<App> {
  return async (c, next) => {
    const u = c.get('usuario')
    if (!u) throw falla(401, 'sin_sesion', 'Inicia sesión para continuar.')
    if (!roles.includes(u.rol)) throw falla(403, 'sin_permiso', 'No tienes permiso para esto.')
    await next()
  }
}

export const requiereDispositivo: MiddlewareHandler<App> = async (c, next) => {
  if (!c.get('usuario')) throw falla(401, 'sin_sesion', 'Inicia sesión para continuar.')
  if (!c.get('dispositivoId')) {
    throw falla(428, 'sin_dispositivo', 'Registra este dispositivo para leer (POST /api/dispositivos).')
  }
  await next()
}

export const requiereInterno: MiddlewareHandler<App> = async (c, next) => {
  const auth = c.req.header('authorization') ?? ''
  const esperado = c.env.INTERNAL_TOKEN
  if (!esperado || auth !== `Bearer ${esperado}`) throw falla(401, 'token_interno', 'Token interno inválido.')
  await next()
}

export function usuarioActual(c: Context<App>): Usuario {
  const u = c.get('usuario')
  if (!u) throw falla(401, 'sin_sesion', 'Inicia sesión para continuar.')
  return u
}
