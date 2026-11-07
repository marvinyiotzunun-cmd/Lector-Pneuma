import { Hono } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'
import type { App, Rol } from '../env'
import { sha256, tokenAleatorio } from '../lib/cripto'
import { enviarCorreo, marcoCorreo } from '../lib/correo'
import { registrarDispositivo, validarDispositivo, listarDispositivos, revocarDispositivo } from '../lib/dispositivos'
import { COOKIE_SESION, DIAS_SESION, requiereSesion, usuarioActual } from '../lib/sesion'
import { ahora, enDias, enMinutos, ErrorApi, escaparHtml, falla, leerJson, normalizarCorreo, nuevoId, texto } from '../lib/util'

const MINUTOS_ENLACE = 15
const ENLACES_POR_HORA = 5

function destinoSeguro(d: unknown): string | null {
  const s = texto(d, 300)
  // Solo rutas internas del sitio (evita redirecciones abiertas).
  return s && s.startsWith('/') && !s.startsWith('//') ? s : null
}

export const auth = new Hono<App>()

auth.post('/auth/enlace', async (c) => {
  const b = await leerJson(c.req.raw)
  const correo = normalizarCorreo(b.correo)
  const nombre = texto(b.nombre, 120)
  const destino = destinoSeguro(b.destino)

  const recientes = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM enlaces_acceso WHERE correo = ? AND creado_en > ?',
  )
    .bind(correo, new Date(Date.now() - 3_600_000).toISOString())
    .first<{ n: number }>()
  if ((recientes?.n ?? 0) >= ENLACES_POR_HORA) {
    throw falla(429, 'demasiados_enlaces', 'Ya enviamos varios enlaces. Revisa tu correo o intenta en una hora.')
  }

  const token = tokenAleatorio(32)
  await c.env.DB.prepare('INSERT INTO enlaces_acceso (token_hash, correo, destino, expira_en) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), correo, destino, enMinutos(MINUTOS_ENLACE))
    .run()
  if (nombre) {
    await c.env.DB.prepare('UPDATE usuarios SET nombre = COALESCE(nombre, ?) WHERE correo = ?').bind(nombre, correo).run()
  }

  // El panel editorial verifica el enlace por su cuenta; el resto pasa por la página /entrar del sitio.
  const pagina = destino?.startsWith('/panel') ? '/panel' : '/entrar'
  const url = `${c.env.SITIO_URL}${pagina}?token=${encodeURIComponent(token)}`
  await enviarCorreo(c.env, {
    para: correo,
    asunto: 'Tu enlace para entrar a Publicaciones Pneuma',
    plantilla: 'enlace_acceso',
    html: marcoCorreo(
      'Entra a tu cuenta',
      `<p>Hola${nombre ? ' ' + escaparHtml(nombre) : ''}. Toca el botón para entrar. El enlace sirve una sola vez y vence en ${MINUTOS_ENLACE} minutos.</p>
       <p style="color:#666;font-size:13px">Si no pediste este correo, ignóralo: nadie puede entrar sin él.</p>`,
      { texto: 'Entrar', url },
    ),
  })
  return c.json({ ok: true })
})

auth.post('/auth/verificar', async (c) => {
  const b = await leerJson(c.req.raw)
  const token = texto(b.token, 200)
  if (!token) throw falla(400, 'token_invalido', 'Enlace inválido.')
  const hash = await sha256(token)
  const t = ahora()
  // Consumir el enlace de forma atómica.
  const enlace = await c.env.DB.prepare(
    'UPDATE enlaces_acceso SET usado_en = ? WHERE token_hash = ? AND usado_en IS NULL AND expira_en > ? RETURNING correo, destino',
  )
    .bind(t, hash, t)
    .first<{ correo: string; destino: string | null }>()
  if (!enlace) throw falla(400, 'enlace_vencido', 'El enlace ya se usó o venció. Pide uno nuevo.')

  let usuario = await c.env.DB.prepare('SELECT id, correo, nombre, telefono, rol FROM usuarios WHERE correo = ?')
    .bind(enlace.correo)
    .first<{ id: string; correo: string; nombre: string | null; telefono: string | null; rol: Rol }>()
  if (!usuario) {
    const admins = (c.env.ADMIN_CORREOS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    const rol: Rol = admins.includes(enlace.correo) ? 'admin' : 'lector'
    const id = nuevoId('usr')
    await c.env.DB.prepare('INSERT INTO usuarios (id, correo, rol) VALUES (?, ?, ?)').bind(id, enlace.correo, rol).run()
    usuario = { id, correo: enlace.correo, nombre: null, telefono: null, rol }
    // Liga pedidos hechos antes de tener cuenta (por ejemplo, por WhatsApp con correo).
    await c.env.DB.prepare('UPDATE pedidos SET usuario_id = ? WHERE usuario_id IS NULL AND correo = ?')
      .bind(id, enlace.correo)
      .run()
  }

  const sesionToken = tokenAleatorio(32)
  const sesionHash = await sha256(sesionToken)
  const expira = enDias(DIAS_SESION)
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO sesiones (token_hash, usuario_id, expira_en, ultimo_uso) VALUES (?, ?, ?, ?)').bind(
      sesionHash,
      usuario.id,
      expira,
      t,
    ),
    c.env.DB.prepare('UPDATE usuarios SET ultimo_ingreso = ? WHERE id = ?').bind(t, usuario.id),
  ])
  setCookie(c, COOKIE_SESION, sesionToken, {
    httpOnly: true,
    secure: c.env.SITIO_URL.startsWith('https'),
    sameSite: 'Lax',
    path: '/',
    maxAge: DIAS_SESION * 86_400,
  })

  const respuesta = { usuario, sesion: { token: sesionToken, expira_en: expira }, destino: enlace.destino }
  if (b.dispositivo) {
    try {
      await registrarDispositivo(c.env, usuario.id, validarDispositivo(b.dispositivo), sesionHash)
      return c.json({ ...respuesta, dispositivo_id: (b.dispositivo as { id: string }).id })
    } catch (e) {
      if (e instanceof ErrorApi && e.codigo === 'limite_dispositivos') {
        // La sesión queda creada sin dispositivo: el cliente muestra la lista para quitar uno.
        return c.json({ ...respuesta, error: { codigo: e.codigo, mensaje: e.message }, ...e.extra }, 409)
      }
      throw e
    }
  }
  return c.json(respuesta)
})

auth.post('/auth/salir', async (c) => {
  const h = c.get('sesionHash')
  if (h) await c.env.DB.prepare('DELETE FROM sesiones WHERE token_hash = ?').bind(h).run()
  deleteCookie(c, COOKIE_SESION, { path: '/' })
  return c.json({ ok: true })
})

auth.get('/yo', requiereSesion, (c) => c.json({ ...usuarioActual(c), dispositivo_id: c.get('dispositivoId') }))

auth.patch('/yo', requiereSesion, async (c) => {
  const u = usuarioActual(c)
  const b = await leerJson(c.req.raw)
  const nombre = 'nombre' in b ? texto(b.nombre, 120) : u.nombre
  const telefono = 'telefono' in b ? texto(b.telefono, 30) : u.telefono
  await c.env.DB.prepare('UPDATE usuarios SET nombre = ?, telefono = ? WHERE id = ?').bind(nombre, telefono, u.id).run()
  return c.json({ ...u, nombre, telefono })
})

/* ---------- Dispositivos ---------- */

auth.get('/dispositivos', requiereSesion, async (c) => {
  const lista = await listarDispositivos(c.env, usuarioActual(c).id)
  const actual = c.get('dispositivoId')
  return c.json(lista.map((d) => ({ ...d, actual: d.id === actual })))
})

auth.post('/dispositivos', requiereSesion, async (c) => {
  const d = validarDispositivo(await leerJson(c.req.raw))
  await registrarDispositivo(c.env, usuarioActual(c).id, d, c.get('sesionHash'))
  return c.json({ ok: true, dispositivo_id: d.id })
})

auth.delete('/dispositivos/:id', requiereSesion, async (c) => {
  await revocarDispositivo(c.env, usuarioActual(c).id, c.req.param('id'))
  return c.json({ ok: true })
})
