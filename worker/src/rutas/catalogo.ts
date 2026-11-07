import { Hono, type Context } from 'hono'
import type { App } from '../env'
import { biblioteca, suscripcionVigente } from '../lib/acceso'
import { libroPublico, type FilaLibro } from '../lib/libros'
import { requiereSesion, usuarioActual } from '../lib/sesion'
import { aGtq, ahora, enDias, falla, leerJson, normalizarCorreo, nuevoId, texto } from '../lib/util'

export const catalogo = new Hono<App>()

catalogo.get('/catalogo', async (c) => {
  const q = texto(c.req.query('q'), 80)
  const categoria = texto(c.req.query('categoria'), 80)
  const formato = c.req.query('formato')
  let sql = 'SELECT * FROM libros WHERE publicado = 1'
  const args: unknown[] = []
  if (q) {
    sql += ' AND (titulo LIKE ?1 OR autor LIKE ?1 OR ministerio LIKE ?1 OR isbn LIKE ?1)'
    args.push(`%${q}%`)
  }
  if (categoria) {
    sql += ` AND categoria = ?${args.length + 1}`
    args.push(categoria)
  }
  if (formato === 'impreso') sql += ' AND impreso = 1'
  if (formato === 'digital') sql += " AND digital_activo = 1 AND formato_digital IS NOT NULL"
  sql += ' ORDER BY orden, titulo'
  const { results } = await c.env.DB.prepare(sql).bind(...args).all<FilaLibro>()
  c.header('Cache-Control', 'public, max-age=60')
  return c.json(results.map((l) => libroPublico(c.env, l)))
})

catalogo.get('/catalogo/:clave', async (c) => {
  const k = c.req.param('clave')
  const l = await c.env.DB.prepare('SELECT * FROM libros WHERE (id = ?1 OR slug = ?1) AND publicado = 1')
    .bind(k)
    .first<FilaLibro>()
  if (!l) throw falla(404, 'no_existe', 'Ese libro no existe.')
  return c.json(libroPublico(c.env, l))
})

catalogo.get('/planes', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, nombre, tipo, precio_centavos, dias, max_miembros, descripcion FROM planes WHERE activo = 1 ORDER BY precio_centavos',
  ).all<{ id: string; nombre: string; tipo: string; precio_centavos: number; dias: number; max_miembros: number; descripcion: string | null }>()
  return c.json(results.map(({ precio_centavos, ...p }) => ({ ...p, precio_gtq: aGtq(precio_centavos) })))
})

catalogo.get('/portadas/:id', async (c) => {
  const l = await c.env.DB.prepare('SELECT portada_clave FROM libros WHERE id = ?').bind(c.req.param('id')).first<{
    portada_clave: string | null
  }>()
  if (!l?.portada_clave) throw falla(404, 'no_existe', 'Sin portada.')
  const obj = await c.env.ARCHIVOS.get(l.portada_clave)
  if (!obj) throw falla(404, 'no_existe', 'Sin portada.')
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'image/webp',
      'Cache-Control': 'public, max-age=86400',
      ETag: obj.httpEtag,
    },
  })
})

/* ---------- Biblioteca y canjes ---------- */

catalogo.get('/biblioteca', requiereSesion, async (c) => {
  const u = usuarioActual(c)
  const mapa = await biblioteca(c.env, u)
  if (!mapa.size) return c.json([])
  const ids = [...mapa.keys()]
  const marcas = ids.map(() => '?').join(',')
  const [{ results: libros }, { results: progresos }] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM libros WHERE id IN (${marcas})`).bind(...ids).all<FilaLibro>(),
    c.env.DB.prepare(
      `SELECT libro_id, ubicacion, porcentaje, actualizado_en FROM progreso_lectura WHERE usuario_id = ? AND libro_id IN (${marcas})`,
    )
      .bind(u.id, ...ids)
      .all<{ libro_id: string; ubicacion: string; porcentaje: number; actualizado_en: string }>(),
  ])
  const prog = new Map(progresos.map((p) => [p.libro_id, p]))
  const salida = libros.map((l) => {
    const p = prog.get(l.id)
    return {
      libro: libroPublico(c.env, l),
      acceso: mapa.get(l.id)!,
      progreso: p ? { ubicacion: p.ubicacion, porcentaje: p.porcentaje, actualizado_en: p.actualizado_en } : null,
    }
  })
  salida.sort((a, b) => (b.progreso?.actualizado_en ?? '').localeCompare(a.progreso?.actualizado_en ?? ''))
  return c.json(salida)
})

catalogo.post('/canjear', requiereSesion, async (c) => {
  const u = usuarioActual(c)
  const b = await leerJson(c.req.raw)
  const codigo = texto(b.codigo, 40)?.toUpperCase().replace(/\s+/g, '')
  if (!codigo) throw falla(400, 'codigo_invalido', 'Escribe el código.')
  const t = ahora()
  const cod = await c.env.DB.prepare('SELECT * FROM codigos_canje WHERE codigo = ?').bind(codigo).first<{
    codigo: string
    libro_id: string | null
    plan_id: string | null
    dias: number | null
    usos_max: number
    usos: number
    vence_en: string | null
  }>()
  if (!cod) throw falla(404, 'codigo_invalido', 'Ese código no existe.')
  if (cod.vence_en && cod.vence_en <= t) throw falla(410, 'codigo_vencido', 'Ese código ya venció.')
  const ya = await c.env.DB.prepare('SELECT 1 FROM canjes WHERE codigo = ? AND usuario_id = ?').bind(cod.codigo, u.id).first()
  if (ya) throw falla(409, 'codigo_usado', 'Ya usaste este código.')
  // Reserva un uso de forma atómica.
  const r = await c.env.DB.prepare('UPDATE codigos_canje SET usos = usos + 1 WHERE codigo = ? AND usos < usos_max')
    .bind(cod.codigo)
    .run()
  if (!r.meta.changes) throw falla(410, 'codigo_agotado', 'Ese código ya se usó por completo.')

  const stmts = [c.env.DB.prepare('INSERT INTO canjes (codigo, usuario_id) VALUES (?, ?)').bind(cod.codigo, u.id)]
  let salida: Record<string, unknown>
  if (cod.libro_id) {
    const vence = cod.dias ? enDias(cod.dias) : null
    stmts.push(
      c.env.DB.prepare(
        "INSERT INTO accesos (id, usuario_id, libro_id, tipo, vence_en, codigo) VALUES (?, ?, ?, 'canje', ?, ?)",
      ).bind(nuevoId('acc'), u.id, cod.libro_id, vence, cod.codigo),
    )
    const l = await c.env.DB.prepare('SELECT * FROM libros WHERE id = ?').bind(cod.libro_id).first<FilaLibro>()
    salida = { tipo: 'libro', libro: l ? libroPublico(c.env, l) : null, vence_en: vence }
  } else {
    const plan = await c.env.DB.prepare('SELECT id, dias FROM planes WHERE id = ?').bind(cod.plan_id).first<{ id: string; dias: number }>()
    if (!plan) throw falla(404, 'codigo_invalido', 'El plan de este código ya no existe.')
    const actual = await suscripcionVigente(c.env, u)
    const inicia = actual && !actual.iglesia_id ? actual.vence_en : t
    const vence = enDias(cod.dias ?? plan.dias, new Date(inicia))
    const id = nuevoId('sus')
    stmts.push(
      c.env.DB.prepare(
        'INSERT INTO suscripciones (id, plan_id, usuario_id, inicia_en, vence_en) VALUES (?, ?, ?, ?, ?)',
      ).bind(id, plan.id, u.id, inicia, vence),
    )
    salida = { tipo: 'plan', suscripcion: { id, plan_id: plan.id, inicia_en: inicia, vence_en: vence } }
  }
  await c.env.DB.batch(stmts)
  return c.json(salida)
})

catalogo.get('/suscripciones', requiereSesion, async (c) => {
  const u = usuarioActual(c)
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.plan_id, p.nombre AS plan, p.tipo, s.iglesia_id, i.nombre AS iglesia, s.estado, s.inicia_en, s.vence_en,
            (i.titular_id = ?1) AS soy_titular
       FROM suscripciones s JOIN planes p ON p.id = s.plan_id LEFT JOIN iglesias i ON i.id = s.iglesia_id
      WHERE s.usuario_id = ?1 OR i.titular_id = ?1
         OR s.iglesia_id IN (SELECT iglesia_id FROM iglesia_miembros WHERE correo = ?2)
      ORDER BY s.vence_en DESC`,
  )
    .bind(u.id, u.correo)
    .all()
  return c.json(results.map((r) => ({ ...r, soy_titular: !!r.soy_titular })))
})

/* ---------- Iglesias (suscripción por iglesia) ---------- */

async function iglesiaDelTitular(c: Context<App>, id: string) {
  const u = usuarioActual(c)
  const ig = await c.env.DB.prepare('SELECT id, nombre, titular_id, creado_en FROM iglesias WHERE id = ?').bind(id).first<{
    id: string
    nombre: string
    titular_id: string
    creado_en: string
  }>()
  if (!ig) throw falla(404, 'no_existe', 'Esa iglesia no existe.')
  if (ig.titular_id !== u.id && u.rol !== 'admin' && u.rol !== 'editor') throw falla(403, 'sin_permiso', 'Solo el titular puede hacer esto.')
  return ig
}

async function cupoIglesia(c: Context<App>, iglesiaId: string) {
  const s = await c.env.DB.prepare(
    `SELECT p.max_miembros, s.vence_en, p.nombre FROM suscripciones s JOIN planes p ON p.id = s.plan_id
      WHERE s.iglesia_id = ? AND s.estado = 'activa' AND s.vence_en > ? ORDER BY s.vence_en DESC LIMIT 1`,
  )
    .bind(iglesiaId, ahora())
    .first<{ max_miembros: number; vence_en: string; nombre: string }>()
  return s
}

catalogo.get('/iglesias/:id', requiereSesion, async (c) => {
  const ig = await iglesiaDelTitular(c, c.req.param('id'))
  const [plan, { results: miembros }] = await Promise.all([
    cupoIglesia(c, ig.id),
    c.env.DB.prepare('SELECT correo, agregado_en FROM iglesia_miembros WHERE iglesia_id = ? ORDER BY agregado_en').bind(ig.id).all(),
  ])
  return c.json({ ...ig, plan: plan ?? null, miembros })
})

catalogo.post('/iglesias/:id/miembros', requiereSesion, async (c) => {
  const ig = await iglesiaDelTitular(c, c.req.param('id'))
  const b = await leerJson<{ correos?: unknown }>(c.req.raw)
  if (!Array.isArray(b.correos) || !b.correos.length) throw falla(400, 'correos_invalidos', 'Envía una lista de correos.')
  const correos = [...new Set(b.correos.map(normalizarCorreo))]
  const plan = await cupoIglesia(c, ig.id)
  if (!plan) throw falla(409, 'sin_suscripcion', 'Esta iglesia no tiene una suscripción vigente.')
  const actual = await c.env.DB.prepare('SELECT correo FROM iglesia_miembros WHERE iglesia_id = ?').bind(ig.id).all<{ correo: string }>()
  const ya = new Set(actual.results.map((r) => r.correo))
  const nuevos = correos.filter((x) => !ya.has(x))
  if (ya.size + nuevos.length > plan.max_miembros) {
    throw falla(409, 'cupo_lleno', `El plan permite ${plan.max_miembros} miembros; ya hay ${ya.size}.`, {
      max_miembros: plan.max_miembros,
      miembros: ya.size,
    })
  }
  if (nuevos.length) {
    await c.env.DB.batch(
      nuevos.map((x) => c.env.DB.prepare('INSERT INTO iglesia_miembros (iglesia_id, correo) VALUES (?, ?)').bind(ig.id, x)),
    )
  }
  return c.json({ agregados: nuevos, total: ya.size + nuevos.length, max_miembros: plan.max_miembros })
})

catalogo.delete('/iglesias/:id/miembros/:correo', requiereSesion, async (c) => {
  const ig = await iglesiaDelTitular(c, c.req.param('id'))
  await c.env.DB.prepare('DELETE FROM iglesia_miembros WHERE iglesia_id = ? AND correo = ?')
    .bind(ig.id, normalizarCorreo(decodeURIComponent(c.req.param('correo'))))
    .run()
  return c.json({ ok: true })
})
