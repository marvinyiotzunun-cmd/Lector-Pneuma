import { Hono, type Context } from 'hono'
import type { App } from '../env'
import { accesoALibro, type Acceso } from '../lib/acceso'
import { ajusteNum } from '../lib/ajustes'
import { cifrarAesGcm, claveLibro, envolverClave, huella } from '../lib/cripto'
import { libroPorId } from '../lib/libros'
import { paginaHtml, paginaSvg } from '../lib/marca'
import { requiereDispositivo, requiereSesion, usuarioActual } from '../lib/sesion'
import { ahora, enDias, entero, falla, ip, leerJson, nuevoId, texto } from '../lib/util'

export interface Manifiesto {
  formato: 'pdf' | 'epub'
  tipo_pagina: 'webp' | 'html' | 'png' | 'jpeg'
  total_paginas: number
  ancho?: number
  alto?: number
  indice?: { etiqueta: string; pagina: number; nivel: number }[]
}

export const claveManifiesto = (libroId: string) => `obras/${libroId}/manifiesto.json`
export const clavePagina = (libroId: string, n: number, tipo: string) =>
  `obras/${libroId}/p/${String(n).padStart(4, '0')}.${tipo === 'jpeg' ? 'jpg' : tipo}`

const TIPOS_MIME: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpeg: 'image/jpeg' }

export const lector = new Hono<App>()

async function libroDigital(c: Context<App>) {
  const libro = await libroPorId(c.env, c.req.param('id')!)
  if (!libro || !libro.formato_digital || (!libro.digital_activo && !['editor', 'admin'].includes(usuarioActual(c).rol))) {
    throw falla(404, 'no_existe', 'Ese libro no está disponible en el lector.')
  }
  return libro
}

async function leerManifiesto(c: Context<App>, libroId: string): Promise<Manifiesto> {
  const obj = await c.env.ARCHIVOS.get(claveManifiesto(libroId))
  if (!obj) throw falla(404, 'sin_contenido', 'Este libro todavía no tiene páginas cargadas.')
  return obj.json<Manifiesto>()
}

lector.get('/obras/:id/manifiesto', requiereSesion, async (c) => {
  const libro = await libroDigital(c)
  const m = await leerManifiesto(c, libro.id)
  const acceso = await accesoALibro(c.env, usuarioActual(c), libro.id)
  c.header('Cache-Control', 'private, no-store')
  return c.json({
    libro_id: libro.id,
    titulo: libro.titulo,
    autor: libro.autor,
    ...m,
    acceso,
    paginas_permitidas: acceso ? m.total_paginas : Math.min(libro.paginas_muestra, m.total_paginas),
  })
})

/** Prepara una página con su marca de agua y registra quién la pidió. */
async function prepararPagina(c: Context<App>, libroId: string, n: number, m: Manifiesto) {
  const u = usuarioActual(c)
  const dispositivo = c.get('dispositivoId')
  const limite = await ajusteNum(c.env, 'paginas_por_minuto', 40)
  const recientes = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM eventos_lectura WHERE usuario_id = ? AND creado_en > ?',
  )
    .bind(u.id, new Date(Date.now() - 60_000).toISOString())
    .first<{ n: number }>()
  if ((recientes?.n ?? 0) >= limite) {
    throw falla(429, 'demasiadas_paginas', 'Vas muy rápido. Espera un momento para seguir leyendo.')
  }
  const obj = await c.env.ARCHIVOS.get(clavePagina(libroId, n, m.tipo_pagina))
  if (!obj) throw falla(404, 'sin_pagina', 'Esa página no existe.')
  const codigo = await huella(c.env.LLAVE_MAESTRA, [u.id, libroId, String(n), dispositivo ?? '', String(Date.now())])
  await c.env.DB.prepare(
    'INSERT INTO eventos_lectura (usuario_id, dispositivo_id, libro_id, pagina, huella, ip) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(u.id, dispositivo, libroId, n, codigo, ip(c.req.raw))
    .run()

  if (m.tipo_pagina === 'html') {
    const html = paginaHtml(await obj.text(), u.correo, codigo)
    return { cuerpo: new TextEncoder().encode(html), tipo: 'text/html; charset=utf-8', codigo }
  }
  const bytes = new Uint8Array(await obj.arrayBuffer())
  const svg = paginaSvg(bytes, TIPOS_MIME[m.tipo_pagina] ?? 'image/webp', m.ancho ?? 1240, m.alto ?? 1754, u.correo, codigo)
  return { cuerpo: new TextEncoder().encode(svg), tipo: 'image/svg+xml', codigo }
}

const cabecerasProtegidas = (tipo: string, codigo: string) => ({
  'Content-Type': tipo,
  'Cache-Control': 'private, no-store',
  'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'",
  'X-Content-Type-Options': 'nosniff',
  'X-Pneuma-Huella': codigo,
})

lector.get('/obras/:id/paginas/:n', requiereDispositivo, async (c) => {
  const libro = await libroDigital(c)
  const m = await leerManifiesto(c, libro.id)
  const n = entero(c.req.param('n'), 1, m.total_paginas)
  const acceso = await accesoALibro(c.env, usuarioActual(c), libro.id)
  if (!acceso && n > libro.paginas_muestra) {
    throw falla(403, 'sin_acceso', 'Esta página no está en la muestra gratuita. Consigue el libro para seguir leyendo.')
  }
  const p = await prepararPagina(c, libro.id, n, m)
  return new Response(p.cuerpo, { headers: cabecerasProtegidas(p.tipo, p.codigo) })
})

/* ---------- Progreso, marcadores y subrayados ---------- */

async function exigirAccesoOMuestra(c: Context<App>): Promise<Acceso | null> {
  const libro = await libroDigital(c)
  const acceso = await accesoALibro(c.env, usuarioActual(c), libro.id)
  if (!acceso && !libro.paginas_muestra) throw falla(403, 'sin_acceso', 'No tienes este libro.')
  return acceso
}

lector.get('/obras/:id/progreso', requiereSesion, async (c) => {
  const p = await c.env.DB.prepare(
    'SELECT ubicacion, porcentaje, actualizado_en FROM progreso_lectura WHERE usuario_id = ? AND libro_id = ?',
  )
    .bind(usuarioActual(c).id, c.req.param('id'))
    .first()
  return c.json(p ?? null)
})

lector.put('/obras/:id/progreso', requiereSesion, async (c) => {
  await exigirAccesoOMuestra(c)
  const b = await leerJson(c.req.raw)
  const ubicacion = texto(b.ubicacion, 300)
  const porcentaje = Number(b.porcentaje ?? 0)
  if (!ubicacion || !Number.isFinite(porcentaje) || porcentaje < 0 || porcentaje > 100) {
    throw falla(400, 'progreso_invalido', 'Progreso inválido.')
  }
  const t = ahora()
  await c.env.DB.prepare(
    `INSERT INTO progreso_lectura (usuario_id, libro_id, ubicacion, porcentaje, actualizado_en) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT (usuario_id, libro_id) DO UPDATE SET ubicacion = ?3, porcentaje = ?4, actualizado_en = ?5`,
  )
    .bind(usuarioActual(c).id, c.req.param('id'), ubicacion, porcentaje, t)
    .run()
  return c.json({ ubicacion, porcentaje, actualizado_en: t })
})

function idCliente(v: unknown, prefijo: string) {
  const s = texto(v, 60)
  if (s && /^[A-Za-z0-9_-]{6,60}$/.test(s)) return s
  return nuevoId(prefijo)
}

lector.get('/obras/:id/marcadores', requiereSesion, async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, ubicacion, etiqueta, creado_en FROM marcadores WHERE usuario_id = ? AND libro_id = ? ORDER BY creado_en',
  )
    .bind(usuarioActual(c).id, c.req.param('id'))
    .all()
  return c.json(results)
})

lector.post('/obras/:id/marcadores', requiereSesion, async (c) => {
  await exigirAccesoOMuestra(c)
  const b = await leerJson(c.req.raw)
  const ubicacion = texto(b.ubicacion, 300)
  if (!ubicacion) throw falla(400, 'ubicacion_invalida', 'Falta la ubicación.')
  const fila = { id: idCliente(b.id, 'mar'), ubicacion, etiqueta: texto(b.etiqueta, 200) ?? '', creado_en: ahora() }
  await c.env.DB.prepare(
    `INSERT INTO marcadores (id, usuario_id, libro_id, ubicacion, etiqueta, creado_en) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
  )
    .bind(fila.id, usuarioActual(c).id, c.req.param('id'), fila.ubicacion, fila.etiqueta, fila.creado_en)
    .run()
  return c.json(fila, 201)
})

lector.delete('/obras/:id/marcadores/:mid', requiereSesion, async (c) => {
  await c.env.DB.prepare('DELETE FROM marcadores WHERE id = ? AND usuario_id = ? AND libro_id = ?')
    .bind(c.req.param('mid'), usuarioActual(c).id, c.req.param('id'))
    .run()
  return c.json({ ok: true })
})

lector.get('/obras/:id/subrayados', requiereSesion, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, ubicacion, texto, nota, color, creado_en, actualizado_en FROM subrayados
      WHERE usuario_id = ? AND libro_id = ? ORDER BY creado_en`,
  )
    .bind(usuarioActual(c).id, c.req.param('id'))
    .all()
  return c.json(results)
})

lector.post('/obras/:id/subrayados', requiereSesion, async (c) => {
  await exigirAccesoOMuestra(c)
  const b = await leerJson(c.req.raw)
  const ubicacion = texto(b.ubicacion, 300)
  const txt = texto(b.texto, 2000)
  if (!ubicacion || !txt) throw falla(400, 'subrayado_invalido', 'Falta la ubicación o el texto.')
  const t = ahora()
  const fila = {
    id: idCliente(b.id, 'sub'),
    ubicacion,
    texto: txt,
    nota: texto(b.nota, 4000) ?? '',
    color: texto(b.color, 20) ?? 'amarillo',
    creado_en: t,
    actualizado_en: t,
  }
  await c.env.DB.prepare(
    `INSERT INTO subrayados (id, usuario_id, libro_id, ubicacion, texto, nota, color, creado_en, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
  )
    .bind(fila.id, usuarioActual(c).id, c.req.param('id'), fila.ubicacion, fila.texto, fila.nota, fila.color, t, t)
    .run()
  return c.json(fila, 201)
})

lector.patch('/obras/:id/subrayados/:sid', requiereSesion, async (c) => {
  const b = await leerJson(c.req.raw)
  const r = await c.env.DB.prepare(
    `UPDATE subrayados SET nota = COALESCE(?, nota), color = COALESCE(?, color), actualizado_en = ?
      WHERE id = ? AND usuario_id = ? AND libro_id = ?`,
  )
    .bind(
      'nota' in b ? (texto(b.nota, 4000) ?? '') : null,
      texto(b.color, 20),
      ahora(),
      c.req.param('sid'),
      usuarioActual(c).id,
      c.req.param('id'),
    )
    .run()
  if (!r.meta.changes) throw falla(404, 'no_existe', 'Ese subrayado no existe.')
  return c.json({ ok: true })
})

lector.delete('/obras/:id/subrayados/:sid', requiereSesion, async (c) => {
  await c.env.DB.prepare('DELETE FROM subrayados WHERE id = ? AND usuario_id = ? AND libro_id = ?')
    .bind(c.req.param('sid'), usuarioActual(c).id, c.req.param('id'))
    .run()
  return c.json({ ok: true })
})

/* ---------- Lectura sin conexión ---------- */

lector.post('/obras/:id/licencia-offline', requiereDispositivo, async (c) => {
  const u = usuarioActual(c)
  const libro = await libroDigital(c)
  const b = await leerJson(c.req.raw)
  const dispositivo = c.get('dispositivoId')!
  if (b.id_dispositivo && b.id_dispositivo !== dispositivo) {
    throw falla(400, 'dispositivo_distinto', 'El dispositivo no coincide con el de la sesión.')
  }
  const clavePublica = texto(b.clave_publica, 2000)
  if (!clavePublica) throw falla(400, 'clave_invalida', 'Falta la clave pública del dispositivo.')
  const plataforma = await c.env.DB.prepare('SELECT plataforma FROM dispositivos WHERE id = ?').bind(dispositivo).first<{ plataforma: string }>()
  if (plataforma?.plataforma === 'web') throw falla(403, 'solo_app', 'La lectura sin conexión es solo para la aplicación.')
  const acceso = await accesoALibro(c.env, u, libro.id)
  if (!acceso) throw falla(403, 'sin_acceso', 'Necesitas tener el libro para leerlo sin conexión.')
  const m = await leerManifiesto(c, libro.id)

  const t = ahora()
  const existente = await c.env.DB.prepare(
    'SELECT id FROM licencias_sin_conexion WHERE dispositivo_id = ? AND libro_id = ? AND revocada_en IS NULL AND vence_en > ?',
  )
    .bind(dispositivo, libro.id, t)
    .first<{ id: string }>()
  if (!existente) {
    const max = await ajusteNum(c.env, 'obras_sin_conexion_por_dispositivo', 5)
    const usadas = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM licencias_sin_conexion WHERE dispositivo_id = ? AND revocada_en IS NULL AND vence_en > ?',
    )
      .bind(dispositivo, t)
      .first<{ n: number }>()
    if ((usadas?.n ?? 0) >= max) {
      throw falla(409, 'limite_sin_conexion', `Ya tienes ${max} libros sin conexión en este dispositivo. Quita uno primero.`, { limite: max })
    }
  }
  const dias = await ajusteNum(c.env, 'dias_licencia_sin_conexion', 14)
  let vence = enDias(dias)
  // Un alquiler o suscripción que vence antes acorta la licencia.
  if (acceso.vence_en && acceso.vence_en < vence) vence = acceso.vence_en
  const id = existente?.id ?? nuevoId('lic')
  let claveEnvuelta: string
  try {
    claveEnvuelta = await envolverClave(clavePublica, await claveLibro(c.env.LLAVE_MAESTRA, libro.id))
  } catch {
    throw falla(400, 'clave_invalida', 'La clave pública no es RSA-OAEP SHA-256 en formato SPKI base64.')
  }
  await c.env.DB.prepare(
    `INSERT INTO licencias_sin_conexion (id, usuario_id, dispositivo_id, libro_id, emitida_en, vence_en) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT (dispositivo_id, libro_id) DO UPDATE SET id = ?1, usuario_id = ?2, emitida_en = ?5, vence_en = ?6, revocada_en = NULL`,
  )
    .bind(id, u.id, dispositivo, libro.id, t, vence)
    .run()
  return c.json({ licencia_id: id, clave_envuelta: claveEnvuelta, vence_en: vence, total_paginas: m.total_paginas, manifiesto: m })
})

lector.get('/obras/:id/paquete/:n', requiereDispositivo, async (c) => {
  const libro = await libroDigital(c)
  const lic = await c.env.DB.prepare(
    'SELECT id FROM licencias_sin_conexion WHERE dispositivo_id = ? AND libro_id = ? AND usuario_id = ? AND revocada_en IS NULL AND vence_en > ?',
  )
    .bind(c.get('dispositivoId'), libro.id, usuarioActual(c).id, ahora())
    .first()
  if (!lic) throw falla(403, 'sin_licencia', 'Este dispositivo no tiene permiso vigente para este libro.')
  const m = await leerManifiesto(c, libro.id)
  const n = entero(c.req.param('n'), 1, m.total_paginas)
  const p = await prepararPagina(c, libro.id, n, m)
  const cifrado = await cifrarAesGcm(await claveLibro(c.env.LLAVE_MAESTRA, libro.id), p.cuerpo)
  return new Response(cifrado, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'private, no-store',
      'X-Pneuma-Tipo': p.tipo,
      'X-Pneuma-Huella': p.codigo,
    },
  })
})

lector.delete('/obras/:id/licencia-offline', requiereDispositivo, async (c) => {
  await c.env.DB.prepare(
    'UPDATE licencias_sin_conexion SET revocada_en = ? WHERE dispositivo_id = ? AND libro_id = ? AND usuario_id = ? AND revocada_en IS NULL',
  )
    .bind(ahora(), c.get('dispositivoId'), c.req.param('id'), usuarioActual(c).id)
    .run()
  return c.json({ ok: true })
})

lector.get('/licencias-offline', requiereDispositivo, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT l.id, l.libro_id, b.titulo, l.emitida_en, l.vence_en FROM licencias_sin_conexion l JOIN libros b ON b.id = l.libro_id
      WHERE l.dispositivo_id = ? AND l.usuario_id = ? AND l.revocada_en IS NULL ORDER BY l.vence_en`,
  )
    .bind(c.get('dispositivoId'), usuarioActual(c).id)
    .all()
  return c.json(results)
})
