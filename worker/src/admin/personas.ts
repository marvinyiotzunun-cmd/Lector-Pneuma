// /api/admin/ministerios, /api/admin/usuarios, /api/admin/accesos y /api/admin/lecturas.
import { Hono } from 'hono'
import type { Env, Variables } from '../env'
import { requiereRol } from '../lib/sesion'
import { enviarCorreo } from '../lib/correo'
import { correoInvitacionMinisterio } from '../ventanilla/correos'
import { ErrorVentanilla, despues, entero, nuevoId, responderError, texto, urlPanel } from '../ventanilla/servicio'

type App = { Bindings: Env; Variables: Variables }
type Rol = 'lector' | 'ministerio' | 'editor' | 'admin'
const ROLES: Rol[] = ['lector', 'ministerio', 'editor', 'admin']

export const adminPersonas = new Hono<App>()
adminPersonas.onError(responderError)
adminPersonas.use('*', requiereRol('editor', 'admin'))

const correoValido = (v: unknown): string | null => {
  const c = typeof v === 'string' ? v.trim().toLowerCase() : ''
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c) && c.length <= 200 ? c : null
}

/** Busca la cuenta por correo o la crea con el rol indicado. Nunca baja el rol de una cuenta existente. */
async function cuentaPorCorreo(db: D1Database, correo: string, nombre: string | null, rol: Rol) {
  const existe = await db.prepare('SELECT id, correo, nombre, rol FROM usuarios WHERE correo = ?').bind(correo)
    .first<{ id: string; correo: string; nombre: string | null; rol: Rol }>()
  if (existe) {
    if (existe.rol === 'lector' && rol !== 'lector') {
      await db.prepare('UPDATE usuarios SET rol = ? WHERE id = ?').bind(rol, existe.id).run()
      existe.rol = rol
    }
    if (!existe.nombre && nombre) await db.prepare('UPDATE usuarios SET nombre = ? WHERE id = ?').bind(nombre, existe.id).run()
    return { ...existe, nueva: false }
  }
  const id = nuevoId()
  await db.prepare('INSERT INTO usuarios (id, correo, nombre, rol) VALUES (?, ?, ?, ?)').bind(id, correo, nombre, rol).run()
  return { id, correo, nombre, rol, nueva: true }
}

// ---------- Ministerios ----------
adminPersonas.get('/ministerios', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT m.*,
      (SELECT COUNT(*) FROM ministerio_miembros mm WHERE mm.ministerio_id = m.id) AS cuentas,
      (SELECT COUNT(*) FROM expedientes e WHERE e.ministerio_id = m.id) AS expedientes,
      (SELECT COUNT(*) FROM expedientes e WHERE e.ministerio_id = m.id AND e.estado NOT IN ('rechazado', 'publicado')) AS abiertos
    FROM ministerios m ORDER BY m.activo DESC, m.nombre`).all()
  return c.json(results)
})

adminPersonas.post('/ministerios', async (c) => {
  const b = await c.req.json<Record<string, string>>()
  const nombre = texto(b.nombre, 160)
  if (!nombre) throw new ErrorVentanilla(400, 'El ministerio necesita un nombre.')
  const id = nuevoId()
  try {
    await c.env.DB.prepare(`INSERT INTO ministerios (id, nombre, siglas, contacto_nombre, contacto_correo, contacto_telefono)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(id, nombre, texto(b.siglas, 20), texto(b.contacto_nombre, 120), correoValido(b.contacto_correo), texto(b.contacto_telefono, 40)).run()
  } catch (e) {
    if (String(e).includes('UNIQUE')) throw new ErrorVentanilla(409, 'Ya existe un ministerio con ese nombre.')
    throw e
  }
  return c.json({ id }, 201)
})

adminPersonas.patch('/ministerios/:id', async (c) => {
  const b = await c.req.json<Record<string, unknown>>()
  const sets: string[] = []
  const vals: unknown[] = []
  for (const k of ['nombre', 'siglas', 'contacto_nombre', 'contacto_correo', 'contacto_telefono', 'activo'] as const) {
    if (!(k in b)) continue
    let v: unknown = b[k]
    if (k === 'activo') v = v ? 1 : 0
    else if (k === 'contacto_correo') v = v ? correoValido(v) : null
    else v = texto(v as string, 160)
    if (k === 'nombre' && !v) throw new ErrorVentanilla(400, 'El nombre no puede quedar vacío.')
    sets.push(`${k} = ?`); vals.push(v)
  }
  if (!sets.length) throw new ErrorVentanilla(400, 'No hay cambios.')
  const r = await c.env.DB.prepare(`UPDATE ministerios SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, c.req.param('id')).run()
  if (!r.meta.changes) throw new ErrorVentanilla(404, 'Ministerio no encontrado.')
  return c.json({ ok: true })
})

adminPersonas.get('/ministerios/:id/miembros', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT u.id, u.correo, u.nombre, u.rol, u.ultimo_ingreso, mm.cargo, mm.agregado_en
    FROM ministerio_miembros mm JOIN usuarios u ON u.id = mm.usuario_id WHERE mm.ministerio_id = ? ORDER BY u.nombre, u.correo`)
    .bind(c.req.param('id')).all()
  return c.json(results)
})

/** Abre una cuenta para el ministerio: {correo, nombre?, cargo?, invitar?}. Crea la cuenta si no existe y avisa por correo. */
adminPersonas.post('/ministerios/:id/miembros', async (c) => {
  const b = await c.req.json<{ correo: string; nombre?: string; cargo?: string; invitar?: boolean }>()
  const correo = correoValido(b.correo)
  if (!correo) throw new ErrorVentanilla(400, 'Correo no válido.')
  const m = await c.env.DB.prepare('SELECT id, nombre FROM ministerios WHERE id = ?').bind(c.req.param('id')).first<{ id: string; nombre: string }>()
  if (!m) throw new ErrorVentanilla(404, 'Ministerio no encontrado.')
  const cuenta = await cuentaPorCorreo(c.env.DB, correo, texto(b.nombre, 120), 'ministerio')
  await c.env.DB.prepare(`INSERT INTO ministerio_miembros (ministerio_id, usuario_id, cargo) VALUES (?, ?, ?)
    ON CONFLICT DO UPDATE SET cargo = excluded.cargo`).bind(m.id, cuenta.id, texto(b.cargo, 80)).run()
  if (b.invitar !== false) {
    const correoInv = correoInvitacionMinisterio({ ministerio: m.nombre, nombre: cuenta.nombre, url: urlPanel(c.env, '/ventanilla') })
    despues(c, enviarCorreo(c.env, { para: correo, ...correoInv }))
  }
  return c.json({ ok: true, usuario: cuenta }, 201)
})

adminPersonas.delete('/ministerios/:id/miembros/:usuario', async (c) => {
  await c.env.DB.prepare('DELETE FROM ministerio_miembros WHERE ministerio_id = ? AND usuario_id = ?')
    .bind(c.req.param('id'), c.req.param('usuario')).run()
  return c.json({ ok: true })
})

// ---------- Usuarios ----------
adminPersonas.get('/usuarios', async (c) => {
  const { q, rol } = c.req.query()
  const filtros: string[] = []
  const vals: unknown[] = []
  if (q) { filtros.push('(u.correo LIKE ? OR u.nombre LIKE ?)'); vals.push(`%${q.trim()}%`, `%${q.trim()}%`) }
  if (rol && ROLES.includes(rol as Rol)) { filtros.push('u.rol = ?'); vals.push(rol) }
  const { results } = await c.env.DB.prepare(`SELECT u.id, u.correo, u.nombre, u.telefono, u.rol, u.creado_en, u.ultimo_ingreso,
      (SELECT COUNT(*) FROM accesos a WHERE a.usuario_id = u.id AND a.revocado_en IS NULL) AS accesos,
      (SELECT group_concat(m.nombre, ', ') FROM ministerio_miembros mm JOIN ministerios m ON m.id = mm.ministerio_id WHERE mm.usuario_id = u.id) AS ministerios
    FROM usuarios u ${filtros.length ? `WHERE ${filtros.join(' AND ')}` : ''} ORDER BY u.creado_en DESC LIMIT 300`).bind(...vals).all()
  return c.json(results)
})

/** Crea una cuenta sin esperar a que la persona entre: {correo, nombre?, rol?}. */
adminPersonas.post('/usuarios', async (c) => {
  const yo = c.get('usuario')!
  const b = await c.req.json<{ correo: string; nombre?: string; rol?: Rol }>()
  const correo = correoValido(b.correo)
  if (!correo) throw new ErrorVentanilla(400, 'Correo no válido.')
  const rol = b.rol && ROLES.includes(b.rol) ? b.rol : 'lector'
  if ((rol === 'editor' || rol === 'admin') && yo.rol !== 'admin') throw new ErrorVentanilla(403, 'Solo un administrador asigna ese rol.')
  return c.json(await cuentaPorCorreo(c.env.DB, correo, texto(b.nombre, 120), rol), 201)
})

/** Cambia nombre o rol. Solo un administrador da o quita los roles de editor y administrador. */
adminPersonas.patch('/usuarios/:id', async (c) => {
  const yo = c.get('usuario')!
  const b = await c.req.json<{ nombre?: string; rol?: Rol }>()
  const u = await c.env.DB.prepare('SELECT id, rol FROM usuarios WHERE id = ?').bind(c.req.param('id')).first<{ id: string; rol: Rol }>()
  if (!u) throw new ErrorVentanilla(404, 'Usuario no encontrado.')
  if (b.rol !== undefined) {
    if (!ROLES.includes(b.rol)) throw new ErrorVentanilla(400, 'Rol no válido.')
    const tocaPrivilegio = [b.rol, u.rol].some((r) => r === 'editor' || r === 'admin')
    if (tocaPrivilegio && yo.rol !== 'admin') throw new ErrorVentanilla(403, 'Solo un administrador cambia ese rol.')
    if (u.id === yo.id && b.rol !== 'admin' && yo.rol === 'admin') throw new ErrorVentanilla(409, 'No puede quitarse a sí mismo el rol de administrador.')
    await c.env.DB.prepare('UPDATE usuarios SET rol = ? WHERE id = ?').bind(b.rol, u.id).run()
  }
  if (b.nombre !== undefined) await c.env.DB.prepare('UPDATE usuarios SET nombre = ? WHERE id = ?').bind(texto(b.nombre, 120), u.id).run()
  return c.json({ ok: true })
})

// ---------- Accesos a libros (otorgar y quitar) ----------
adminPersonas.get('/accesos', async (c) => {
  const { usuario, libro, q } = c.req.query()
  const filtros = ['1 = 1']
  const vals: unknown[] = []
  if (usuario) { filtros.push('a.usuario_id = ?'); vals.push(usuario) }
  if (libro) { filtros.push('a.libro_id = ?'); vals.push(libro) }
  if (q) { filtros.push('(u.correo LIKE ? OR u.nombre LIKE ? OR l.titulo LIKE ?)'); vals.push(`%${q}%`, `%${q}%`, `%${q}%`) }
  const { results } = await c.env.DB.prepare(`SELECT a.*, u.correo, u.nombre, l.titulo,
      CASE WHEN a.revocado_en IS NOT NULL THEN 'revocado'
           WHEN a.vence_en IS NOT NULL AND a.vence_en < strftime('%Y-%m-%dT%H:%M:%fZ', 'now') THEN 'vencido'
           ELSE 'vigente' END AS vigencia
    FROM accesos a JOIN usuarios u ON u.id = a.usuario_id JOIN libros l ON l.id = a.libro_id
    WHERE ${filtros.join(' AND ')} ORDER BY a.creado_en DESC LIMIT 500`).bind(...vals).all()
  return c.json(results)
})

/** Otorga acceso de cortesía: {correos: [...], libro_id, dias?: número | null}. Crea las cuentas que falten. */
adminPersonas.post('/accesos', async (c) => {
  const b = await c.req.json<{ correos: string[] | string; libro_id: string; dias?: number | null }>()
  const lista = (Array.isArray(b.correos) ? b.correos : String(b.correos ?? '').split(/[\s,;]+/)).map(correoValido)
  const correos = [...new Set(lista.filter((x): x is string => !!x))]
  if (!correos.length) throw new ErrorVentanilla(400, 'Escriba al menos un correo válido.')
  if (correos.length > 200) throw new ErrorVentanilla(400, 'Máximo 200 correos a la vez.')
  const libro = await c.env.DB.prepare('SELECT id FROM libros WHERE id = ?').bind(b.libro_id).first()
  if (!libro) throw new ErrorVentanilla(404, 'Libro no encontrado.')
  const dias = entero(b.dias)
  const vence = dias ? new Date(Date.now() + dias * 86_400_000).toISOString() : null
  const otorgados: string[] = []
  for (const correo of correos) {
    const u = await cuentaPorCorreo(c.env.DB, correo, null, 'lector')
    const vigente = await c.env.DB.prepare(`SELECT id FROM accesos WHERE usuario_id = ? AND libro_id = ? AND revocado_en IS NULL
        AND (vence_en IS NULL OR vence_en > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`).bind(u.id, b.libro_id).first()
    if (vigente) continue
    await c.env.DB.prepare(`INSERT INTO accesos (id, usuario_id, libro_id, tipo, vence_en) VALUES (?, ?, ?, 'cortesia', ?)`)
      .bind(nuevoId(), u.id, b.libro_id, vence).run()
    otorgados.push(correo)
  }
  return c.json({ ok: true, otorgados, ya_tenian: correos.filter((x) => !otorgados.includes(x)) }, 201)
})

adminPersonas.delete('/accesos/:id', async (c) => {
  const r = await c.env.DB.prepare(`UPDATE accesos SET revocado_en = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND revocado_en IS NULL`)
    .bind(c.req.param('id')).run()
  if (!r.meta.changes) throw new ErrorVentanilla(404, 'Acceso no encontrado o ya revocado.')
  return c.json({ ok: true })
})

// ---------- Quién lee qué ----------
/** Resumen por libro: lectores con acceso, lectores activos (30 días) y páginas servidas. */
adminPersonas.get('/lecturas', async (c) => {
  const dias = Math.min(entero(c.req.query('dias')) ?? 30, 365)
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString()
  const { results } = await c.env.DB.prepare(`SELECT l.id, l.titulo, l.autor,
      (SELECT COUNT(DISTINCT a.usuario_id) FROM accesos a WHERE a.libro_id = l.id AND a.revocado_en IS NULL) AS con_acceso,
      (SELECT COUNT(DISTINCT ev.usuario_id) FROM eventos_lectura ev WHERE ev.libro_id = l.id AND ev.creado_en >= ?1) AS lectores_activos,
      (SELECT COUNT(*) FROM eventos_lectura ev WHERE ev.libro_id = l.id AND ev.creado_en >= ?1) AS paginas_servidas,
      (SELECT ROUND(AVG(p.porcentaje), 1) FROM progreso_lectura p WHERE p.libro_id = l.id) AS avance_promedio
    FROM libros l WHERE l.formato_digital IS NOT NULL ORDER BY lectores_activos DESC, l.titulo`).bind(desde).all()
  return c.json({ dias, libros: results })
})

/** Detalle de un libro: cada lector, su acceso, su avance y su última lectura. */
adminPersonas.get('/lecturas/libros/:id', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT u.id AS usuario_id, u.correo, u.nombre,
      p.porcentaje, p.actualizado_en AS ultimo_avance,
      (SELECT MAX(ev.creado_en) FROM eventos_lectura ev WHERE ev.usuario_id = u.id AND ev.libro_id = ?1) AS ultima_pagina_en,
      (SELECT COUNT(*) FROM eventos_lectura ev WHERE ev.usuario_id = u.id AND ev.libro_id = ?1) AS paginas_servidas,
      (SELECT a.tipo FROM accesos a WHERE a.usuario_id = u.id AND a.libro_id = ?1 AND a.revocado_en IS NULL ORDER BY a.creado_en DESC LIMIT 1) AS acceso
    FROM usuarios u LEFT JOIN progreso_lectura p ON p.usuario_id = u.id AND p.libro_id = ?1
    WHERE u.id IN (SELECT usuario_id FROM progreso_lectura WHERE libro_id = ?1
                   UNION SELECT usuario_id FROM eventos_lectura WHERE libro_id = ?1
                   UNION SELECT usuario_id FROM accesos WHERE libro_id = ?1 AND revocado_en IS NULL)
    ORDER BY ultima_pagina_en DESC NULLS LAST LIMIT 1000`).bind(c.req.param('id')).all()
  return c.json(results)
})

/** Detalle de un lector: qué libros tiene y cuánto ha leído de cada uno. */
adminPersonas.get('/lecturas/usuarios/:id', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT l.id AS libro_id, l.titulo, p.porcentaje, p.actualizado_en AS ultimo_avance,
      (SELECT COUNT(*) FROM eventos_lectura ev WHERE ev.usuario_id = ?1 AND ev.libro_id = l.id) AS paginas_servidas,
      (SELECT MAX(ev.creado_en) FROM eventos_lectura ev WHERE ev.usuario_id = ?1 AND ev.libro_id = l.id) AS ultima_pagina_en,
      (SELECT a.tipo FROM accesos a WHERE a.usuario_id = ?1 AND a.libro_id = l.id AND a.revocado_en IS NULL ORDER BY a.creado_en DESC LIMIT 1) AS acceso
    FROM libros l LEFT JOIN progreso_lectura p ON p.libro_id = l.id AND p.usuario_id = ?1
    WHERE l.id IN (SELECT libro_id FROM progreso_lectura WHERE usuario_id = ?1
                   UNION SELECT libro_id FROM eventos_lectura WHERE usuario_id = ?1
                   UNION SELECT libro_id FROM accesos WHERE usuario_id = ?1)
    ORDER BY ultima_pagina_en DESC NULLS LAST`).bind(c.req.param('id')).all()
  return c.json(results)
})
