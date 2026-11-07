// Contenidos editables del sitio y formatos oficiales descargables.
// Público: /api/contenidos, /api/contenidos/:clave, /api/formatos, /api/formatos/:id/archivo
// Admin:   /api/admin/contenidos[/:clave], /api/admin/formatos[/:id]
import { Hono } from 'hono'
import type { Env, Variables } from '../env'
import { requiereRol } from '../lib/sesion'
import { ErrorVentanilla, MB, descargarDocumento, entero, nombreSeguro, nuevoId, texto } from '../ventanilla/servicio'

type App = { Bindings: Env; Variables: Variables }

export const contenidosPublicos = new Hono<App>()

contenidosPublicos.get('/contenidos', async (c) => {
  const { results } = await c.env.DB
    .prepare('SELECT clave, titulo, cuerpo, actualizado_en FROM contenidos_sitio WHERE publicado = 1 ORDER BY clave').all()
  c.header('Cache-Control', 'public, max-age=60')
  return c.json(results)
})

contenidosPublicos.get('/contenidos/:clave', async (c) => {
  const fila = await c.env.DB
    .prepare('SELECT clave, titulo, cuerpo, actualizado_en FROM contenidos_sitio WHERE clave = ? AND publicado = 1')
    .bind(c.req.param('clave')).first()
  if (!fila) throw new ErrorVentanilla(404, 'Página no encontrada.')
  c.header('Cache-Control', 'public, max-age=60')
  return c.json(fila)
})

/** Las etapas del proceso editorial, para la página "Proceso de publicación" del sitio. */
contenidosPublicos.get('/proceso/etapas', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT numero, nombre, descripcion, responsable FROM etapas_editoriales ORDER BY numero').all()
  c.header('Cache-Control', 'public, max-age=60')
  return c.json(results)
})

contenidosPublicos.get('/formatos', async (c) => {
  const { results } = await c.env.DB
    .prepare(`SELECT id, nombre, descripcion, nombre_archivo, tipo_mime AS tipo, tamano AS tamano_bytes
      FROM formatos_oficiales WHERE publicado = 1 ORDER BY orden, nombre`)
    .all<{ id: string }>()
  const base = new URL(c.req.url).origin
  c.header('Cache-Control', 'public, max-age=60')
  return c.json(results.map((f) => ({ ...f, url: `${base}/api/formatos/${f.id}/archivo` })))
})

contenidosPublicos.get('/formatos/:id/archivo', async (c) => {
  const f = await c.env.DB
    .prepare('SELECT ruta, nombre_archivo AS nombre, tipo_mime FROM formatos_oficiales WHERE id = ? AND publicado = 1')
    .bind(c.req.param('id')).first<{ ruta: string; nombre: string; tipo_mime: string | null }>()
  if (!f) throw new ErrorVentanilla(404, 'Formato no encontrado.')
  const r = await descargarDocumento(c.env, f)
  r.headers.set('Cache-Control', 'public, max-age=300')
  return r
})

// ---------- Administración ----------
export const adminContenidos = new Hono<App>()
adminContenidos.use('*', requiereRol('editor', 'admin'))

adminContenidos.get('/contenidos', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT s.*, u.nombre AS actualizado_por_nombre FROM contenidos_sitio s
    LEFT JOIN usuarios u ON u.id = s.actualizado_por ORDER BY s.clave`).all()
  return c.json(results)
})

/** Crea o reemplaza una página: {titulo, cuerpo (Markdown), publicado?}. */
adminContenidos.put('/contenidos/:clave', async (c) => {
  const clave = c.req.param('clave').toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(clave)) throw new ErrorVentanilla(400, 'La clave solo lleva minúsculas, números y guiones.')
  const cuerpo = await c.req.json<{ titulo: string; cuerpo: string; publicado?: boolean }>()
  const titulo = texto(cuerpo.titulo, 200)
  if (!titulo) throw new ErrorVentanilla(400, 'La página necesita un título.')
  const md = typeof cuerpo.cuerpo === 'string' ? cuerpo.cuerpo.slice(0, 100_000) : ''
  await c.env.DB.prepare(`INSERT INTO contenidos_sitio (clave, titulo, cuerpo, publicado, actualizado_por, actualizado_en)
      VALUES (?1, ?2, ?3, ?4, ?5, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT (clave) DO UPDATE SET titulo = ?2, cuerpo = ?3, publicado = ?4, actualizado_por = ?5, actualizado_en = excluded.actualizado_en`)
    .bind(clave, titulo, md, cuerpo.publicado === false ? 0 : 1, c.get('usuario')!.id).run()
  return c.json({ ok: true, clave })
})

adminContenidos.delete('/contenidos/:clave', async (c) => {
  await c.env.DB.prepare('DELETE FROM contenidos_sitio WHERE clave = ?').bind(c.req.param('clave')).run()
  return c.json({ ok: true })
})

adminContenidos.get('/formatos', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM formatos_oficiales ORDER BY orden, nombre').all()
  return c.json(results)
})

/** Sube un formato oficial (multipart: nombre, descripcion, orden, archivo). */
adminContenidos.post('/formatos', async (c) => {
  const f = await c.req.formData()
  const nombre = texto(f.get('nombre'), 120)
  const archivo = f.get('archivo')
  if (!nombre || !(archivo instanceof File) || !archivo.size) throw new ErrorVentanilla(400, 'Falta el nombre o el archivo.')
  if (archivo.size > 20 * MB) throw new ErrorVentanilla(413, 'El formato pesa más de 20 MB.')
  const id = nuevoId('fmt')
  const ruta = `formatos/${id}-${nombreSeguro(archivo.name)}`
  await c.env.ARCHIVOS.put(ruta, archivo.stream(), { httpMetadata: { contentType: archivo.type || 'application/octet-stream' } })
  await c.env.DB.prepare(`INSERT INTO formatos_oficiales (id, nombre, descripcion, ruta, nombre_archivo, tipo_mime, tamano, orden)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, nombre, texto(f.get('descripcion'), 500) ?? '', ruta, archivo.name.slice(0, 200), archivo.type || null, archivo.size,
      entero(f.get('orden')) ?? 0)
    .run()
  return c.json({ ok: true, id }, 201)
})

adminContenidos.patch('/formatos/:id', async (c) => {
  const cuerpo = await c.req.json<{ nombre?: string; descripcion?: string; orden?: number; publicado?: boolean }>()
  const actual = await c.env.DB.prepare('SELECT * FROM formatos_oficiales WHERE id = ?').bind(c.req.param('id'))
    .first<{ nombre: string; descripcion: string; orden: number; publicado: number }>()
  if (!actual) throw new ErrorVentanilla(404, 'Formato no encontrado.')
  await c.env.DB.prepare('UPDATE formatos_oficiales SET nombre = ?, descripcion = ?, orden = ?, publicado = ? WHERE id = ?')
    .bind(texto(cuerpo.nombre, 120) ?? actual.nombre, cuerpo.descripcion !== undefined ? (texto(cuerpo.descripcion, 500) ?? '') : actual.descripcion,
      entero(cuerpo.orden) ?? actual.orden, cuerpo.publicado === undefined ? actual.publicado : cuerpo.publicado ? 1 : 0, c.req.param('id'))
    .run()
  return c.json({ ok: true })
})

adminContenidos.delete('/formatos/:id', async (c) => {
  const f = await c.env.DB.prepare('SELECT ruta FROM formatos_oficiales WHERE id = ?').bind(c.req.param('id')).first<{ ruta: string }>()
  if (!f) throw new ErrorVentanilla(404, 'Formato no encontrado.')
  await c.env.ARCHIVOS.delete(f.ruta)
  await c.env.DB.prepare('DELETE FROM formatos_oficiales WHERE id = ?').bind(c.req.param('id')).run()
  return c.json({ ok: true })
})
