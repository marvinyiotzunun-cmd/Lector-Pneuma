import { Hono } from 'hono'
import type { App } from '../env'
import { AJUSTES_NUMERICOS, todosLosAjustes } from '../lib/ajustes'
import { tokenAleatorio } from '../lib/cripto'
import { libroPorId, type FilaLibro } from '../lib/libros'
import { requiereRol, usuarioActual } from '../lib/sesion'
import { aCentavos, aGtq, ahora, entero, falla, leerJson, nuevoId, slugificar, texto } from '../lib/util'
import { cambiarEstado, pedidoPublico, type Estado } from '../servicios/pedidos'
import { claveManifiesto, clavePagina, type Manifiesto } from './lector'

export const admin = new Hono<App>()
admin.use('*', requiereRol('editor', 'admin'))

/* ---------- Libros ---------- */

// Campos editables: nombre en la API → columna y conversión.
const CAMPOS_LIBRO: Record<string, (v: unknown) => [string, unknown]> = {
  titulo: (v) => ['titulo', texto(v, 300)],
  autor: (v) => ['autor', texto(v, 300)],
  ministerio: (v) => ['ministerio', texto(v, 200)],
  sinopsis: (v) => ['sinopsis', texto(v, 5000)],
  isbn: (v) => ['isbn', texto(v, 30)],
  paginas: (v) => ['paginas', v == null ? null : entero(v, 1, 100000)],
  color: (v) => ['color', texto(v, 20)],
  categoria: (v) => ['categoria', texto(v, 80)],
  impreso: (v) => ['impreso', v ? 1 : 0],
  precio_impreso_gtq: (v) => ['precio_impreso_centavos', v == null ? null : aCentavos(Number(v))],
  existencias: (v) => ['existencias', v == null ? null : entero(v, 0)],
  formato_digital: (v) => {
    if (v != null && v !== 'pdf' && v !== 'epub') throw falla(400, 'formato_invalido', 'Formato digital: pdf o epub.')
    return ['formato_digital', v ?? null]
  },
  digital_activo: (v) => ['digital_activo', v ? 1 : 0],
  precio_compra_gtq: (v) => ['precio_compra_centavos', v == null ? null : aCentavos(Number(v))],
  precio_alquiler_gtq: (v) => ['precio_alquiler_centavos', v == null ? null : aCentavos(Number(v))],
  dias_alquiler: (v) => ['dias_alquiler', entero(v, 1, 3650)],
  en_suscripcion: (v) => ['en_suscripcion', v ? 1 : 0],
  paginas_muestra: (v) => ['paginas_muestra', entero(v, 0, 10000)],
  url_amazon: (v) => ['url_amazon', texto(v, 500)],
  url_google_play: (v) => ['url_google_play', texto(v, 500)],
  publicado: (v) => ['publicado', v ? 1 : 0],
  orden: (v) => ['orden', entero(v, -100000, 100000)],
}

function libroAdmin(l: FilaLibro) {
  const { precio_impreso_centavos, precio_compra_centavos, precio_alquiler_centavos, ...resto } = l
  return {
    ...resto,
    impreso: !!l.impreso,
    digital_activo: !!l.digital_activo,
    en_suscripcion: !!l.en_suscripcion,
    publicado: !!l.publicado,
    precio_impreso_gtq: aGtq(precio_impreso_centavos),
    precio_compra_gtq: aGtq(precio_compra_centavos),
    precio_alquiler_gtq: aGtq(precio_alquiler_centavos),
  }
}

function camposDe(b: Record<string, unknown>) {
  const cols: string[] = []
  const vals: unknown[] = []
  for (const [k, conv] of Object.entries(CAMPOS_LIBRO)) {
    if (k in b) {
      const [col, val] = conv(b[k])
      if ((col === 'titulo' || col === 'autor') && !val) throw falla(400, 'dato_invalido', `Falta ${k}.`)
      if (typeof val === 'number' && Number.isNaN(val)) throw falla(400, 'numero_invalido', `Número inválido en ${k}.`)
      cols.push(col)
      vals.push(val)
    }
  }
  return { cols, vals }
}

admin.get('/libros', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM libros ORDER BY orden, titulo').all<FilaLibro>()
  return c.json(results.map(libroAdmin))
})

admin.post('/libros', async (c) => {
  const b = await leerJson(c.req.raw)
  if (!texto(b.titulo) || !texto(b.autor)) throw falla(400, 'dato_invalido', 'Faltan título y autor.')
  const id = nuevoId('lib')
  let slug = slugificar(texto(b.slug, 80) ?? texto(b.titulo)!) || id
  if (await c.env.DB.prepare('SELECT 1 FROM libros WHERE slug = ?').bind(slug).first()) slug = `${slug}-${id.slice(-5)}`
  const { cols, vals } = camposDe(b)
  await c.env.DB.prepare(
    `INSERT INTO libros (id, slug, ${cols.join(', ')}) VALUES (?, ?, ${cols.map(() => '?').join(', ')})`,
  )
    .bind(id, slug, ...vals)
    .run()
  return c.json(libroAdmin((await libroPorId(c.env, id))!), 201)
})

admin.get('/libros/:id', async (c) => {
  const l = await libroPorId(c.env, c.req.param('id'))
  if (!l) throw falla(404, 'no_existe', 'Ese libro no existe.')
  const m = await c.env.ARCHIVOS.get(claveManifiesto(l.id))
  return c.json({ ...libroAdmin(l), manifiesto: m ? await m.json() : null })
})

admin.patch('/libros/:id', async (c) => {
  const b = await leerJson(c.req.raw)
  const { cols, vals } = camposDe(b)
  if ('slug' in b) {
    cols.push('slug')
    vals.push(slugificar(texto(b.slug, 80) ?? ''))
  }
  if (!cols.length) throw falla(400, 'sin_cambios', 'No hay cambios.')
  const r = await c.env.DB.prepare(
    `UPDATE libros SET ${cols.map((k) => `${k} = ?`).join(', ')}, actualizado_en = ? WHERE id = ?`,
  )
    .bind(...vals, ahora(), c.req.param('id'))
    .run()
  if (!r.meta.changes) throw falla(404, 'no_existe', 'Ese libro no existe.')
  return c.json(libroAdmin((await libroPorId(c.env, c.req.param('id')))!))
})

admin.delete('/libros/:id', requiereRol('admin'), async (c) => {
  const id = c.req.param('id')
  const vendido = await c.env.DB.prepare('SELECT 1 FROM pedido_items WHERE libro_id = ? LIMIT 1').bind(id).first()
  if (vendido) throw falla(409, 'libro_con_ventas', 'Este libro tiene ventas: despublícalo en lugar de borrarlo.')
  await c.env.DB.prepare('DELETE FROM libros WHERE id = ?').bind(id).run()
  // Borra sus archivos en R2.
  let cursor: string | undefined
  do {
    const lista = await c.env.ARCHIVOS.list({ prefix: `obras/${id}/`, cursor })
    if (lista.objects.length) await c.env.ARCHIVOS.delete(lista.objects.map((o) => o.key))
    cursor = lista.truncated ? lista.cursor : undefined
  } while (cursor)
  await c.env.ARCHIVOS.delete(`portadas/${id}`)
  return c.json({ ok: true })
})

const IMAGENES = ['image/webp', 'image/png', 'image/jpeg']

admin.put('/libros/:id/portada', async (c) => {
  const l = await libroPorId(c.env, c.req.param('id'))
  if (!l) throw falla(404, 'no_existe', 'Ese libro no existe.')
  const tipo = (c.req.header('content-type') ?? '').split(';')[0]
  if (!IMAGENES.includes(tipo)) throw falla(415, 'tipo_invalido', 'La portada debe ser WEBP, PNG o JPG.')
  const datos = await c.req.arrayBuffer()
  if (datos.byteLength > 5 * 1024 * 1024) throw falla(413, 'muy_grande', 'La portada pesa más de 5 MB.')
  const clave = `portadas/${l.id}`
  await c.env.ARCHIVOS.put(clave, datos, { httpMetadata: { contentType: tipo } })
  await c.env.DB.prepare('UPDATE libros SET portada_clave = ?, actualizado_en = ? WHERE id = ?').bind(clave, ahora(), l.id).run()
  return c.json({ ok: true, portada_url: `${c.env.SITIO_URL}/api/portadas/${l.id}` })
})

admin.put('/libros/:id/manifiesto', async (c) => {
  const l = await libroPorId(c.env, c.req.param('id'))
  if (!l) throw falla(404, 'no_existe', 'Ese libro no existe.')
  const m = await leerJson<Manifiesto>(c.req.raw)
  if (!['pdf', 'epub'].includes(m.formato) || !['webp', 'html', 'png', 'jpeg'].includes(m.tipo_pagina)) {
    throw falla(400, 'manifiesto_invalido', 'Manifiesto inválido: formato pdf|epub y tipo_pagina webp|html|png|jpeg.')
  }
  const total = entero(m.total_paginas, 1, 20000)
  const limpio: Manifiesto = {
    formato: m.formato,
    tipo_pagina: m.tipo_pagina,
    total_paginas: total,
    ancho: m.ancho ? entero(m.ancho, 1, 10000) : undefined,
    alto: m.alto ? entero(m.alto, 1, 10000) : undefined,
    indice: Array.isArray(m.indice)
      ? m.indice.slice(0, 2000).map((e) => ({ etiqueta: String(e.etiqueta ?? '').slice(0, 300), pagina: entero(e.pagina, 1, total), nivel: entero(e.nivel ?? 0, 0, 10) }))
      : [],
  }
  await c.env.ARCHIVOS.put(claveManifiesto(l.id), JSON.stringify(limpio), { httpMetadata: { contentType: 'application/json' } })
  await c.env.DB.prepare('UPDATE libros SET total_paginas_digital = ?, formato_digital = ?, actualizado_en = ? WHERE id = ?')
    .bind(total, limpio.formato, ahora(), l.id)
    .run()
  return c.json(limpio)
})

admin.put('/libros/:id/paginas/:n', async (c) => {
  const id = c.req.param('id')
  const n = entero(c.req.param('n'), 1, 20000)
  const tipo = (c.req.header('content-type') ?? '').split(';')[0]
  const ext = tipo === 'text/html' ? 'html' : tipo === 'image/webp' ? 'webp' : tipo === 'image/png' ? 'png' : tipo === 'image/jpeg' ? 'jpeg' : null
  if (!ext) throw falla(415, 'tipo_invalido', 'Página: image/webp, image/png, image/jpeg o text/html.')
  if (!(await c.env.DB.prepare('SELECT 1 FROM libros WHERE id = ?').bind(id).first())) throw falla(404, 'no_existe', 'Ese libro no existe.')
  const datos = await c.req.arrayBuffer()
  if (datos.byteLength > 10 * 1024 * 1024) throw falla(413, 'muy_grande', 'La página pesa más de 10 MB.')
  await c.env.ARCHIVOS.put(clavePagina(id, n, ext), datos, { httpMetadata: { contentType: tipo } })
  return c.json({ ok: true, pagina: n })
})

/* ---------- Pedidos ---------- */

admin.get('/pedidos', async (c) => {
  const estado = c.req.query('estado')
  const canal = c.req.query('canal')
  const q = texto(c.req.query('q'), 80)
  const limite = Math.min(Number(c.req.query('limite') ?? 100) || 100, 500)
  const cond: string[] = []
  const args: unknown[] = []
  if (estado) (cond.push('estado = ?'), args.push(estado))
  if (canal) (cond.push('canal = ?'), args.push(canal))
  if (q) (cond.push('(codigo LIKE ? OR correo LIKE ? OR nombre LIKE ? OR telefono LIKE ? OR referencia LIKE ?)'), args.push(...Array(5).fill(`%${q}%`)))
  const { results } = await c.env.DB.prepare(
    `SELECT id, codigo, estado, metodo, canal, correo, nombre, telefono, total_centavos, referencia, comprobante_clave, creado_en, pagado_en
       FROM pedidos ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY creado_en DESC LIMIT ?`,
  )
    .bind(...args, limite)
    .all<Record<string, unknown> & { total_centavos: number; comprobante_clave: string | null }>()
  return c.json(results.map(({ total_centavos, comprobante_clave, ...p }) => ({ ...p, total_gtq: aGtq(total_centavos), tiene_comprobante: !!comprobante_clave })))
})

admin.get('/pedidos/:id', async (c) => {
  const p = await pedidoPublico(c.env, c.req.param('id'))
  const extra = await c.env.DB.prepare('SELECT notas, confirmado_por, proveedor_id, actualizado_en FROM pedidos WHERE id = ?').bind(p.id).first()
  return c.json({ ...p, ...extra })
})

admin.get('/pedidos/:id/comprobante', async (c) => {
  const p = await c.env.DB.prepare('SELECT comprobante_clave FROM pedidos WHERE id = ?').bind(c.req.param('id')).first<{ comprobante_clave: string | null }>()
  const obj = p?.comprobante_clave ? await c.env.ARCHIVOS.get(p.comprobante_clave) : null
  if (!obj) throw falla(404, 'no_existe', 'Este pedido no tiene comprobante.')
  return new Response(obj.body, { headers: { 'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream', 'Cache-Control': 'private, no-store' } })
})

admin.post('/pedidos/:id/estado', async (c) => {
  const b = await leerJson(c.req.raw)
  const estado = b.estado as Estado
  if (!['pendiente', 'pagado', 'enviado', 'entregado', 'cancelado', 'reembolsado'].includes(estado)) {
    throw falla(400, 'estado_invalido', 'Estado inválido.')
  }
  const u = usuarioActual(c)
  await cambiarEstado(c.env, c.req.param('id'), estado, {
    nota: `${u.correo}: ${estado}${texto(b.nota, 500) ? ' · ' + texto(b.nota, 500) : ''}`,
    por: estado === 'pagado' ? u.id : null,
    referencia: texto(b.referencia, 80),
  })
  return c.json(await pedidoPublico(c.env, c.req.param('id')))
})

/* ---------- Planes ---------- */

admin.get('/planes', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM planes ORDER BY activo DESC, precio_centavos').all<{ precio_centavos: number; activo: number }>()
  return c.json(results.map(({ precio_centavos, ...p }) => ({ ...p, activo: !!p.activo, precio_gtq: aGtq(precio_centavos) })))
})

admin.post('/planes', async (c) => {
  const b = await leerJson(c.req.raw)
  const nombre = texto(b.nombre, 120)
  if (!nombre || (b.tipo !== 'individual' && b.tipo !== 'iglesia')) throw falla(400, 'plan_invalido', 'Faltan nombre y tipo (individual o iglesia).')
  const id = nuevoId('pln')
  await c.env.DB.prepare('INSERT INTO planes (id, nombre, tipo, precio_centavos, dias, max_miembros, descripcion) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(
      id,
      nombre,
      b.tipo,
      aCentavos(Number(b.precio_gtq ?? 0)),
      entero(b.dias ?? 30, 1, 3650),
      b.tipo === 'iglesia' ? entero(b.max_miembros ?? 25, 1, 100000) : 1,
      texto(b.descripcion, 1000),
    )
    .run()
  return c.json({ id }, 201)
})

admin.patch('/planes/:id', async (c) => {
  const b = await leerJson(c.req.raw)
  const sets: string[] = []
  const vals: unknown[] = []
  if ('nombre' in b) (sets.push('nombre = ?'), vals.push(texto(b.nombre, 120)))
  if ('precio_gtq' in b) (sets.push('precio_centavos = ?'), vals.push(aCentavos(Number(b.precio_gtq))))
  if ('dias' in b) (sets.push('dias = ?'), vals.push(entero(b.dias, 1, 3650)))
  if ('max_miembros' in b) (sets.push('max_miembros = ?'), vals.push(entero(b.max_miembros, 1, 100000)))
  if ('descripcion' in b) (sets.push('descripcion = ?'), vals.push(texto(b.descripcion, 1000)))
  if ('activo' in b) (sets.push('activo = ?'), vals.push(b.activo ? 1 : 0))
  if (!sets.length) throw falla(400, 'sin_cambios', 'No hay cambios.')
  await c.env.DB.prepare(`UPDATE planes SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, c.req.param('id')).run()
  return c.json({ ok: true })
})

/* ---------- Códigos de canje ---------- */

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function generarCodigo(prefijo: string) {
  const b = crypto.getRandomValues(new Uint8Array(8))
  const cuerpo = [...b].map((x) => ALFABETO[x % ALFABETO.length]).join('')
  return `${prefijo}${cuerpo.slice(0, 4)}-${cuerpo.slice(4)}`
}

admin.get('/codigos', async (c) => {
  const lote = c.req.query('lote')
  const { results } = await c.env.DB.prepare(
    `SELECT k.*, l.titulo AS libro, p.nombre AS plan FROM codigos_canje k
       LEFT JOIN libros l ON l.id = k.libro_id LEFT JOIN planes p ON p.id = k.plan_id
      ${lote ? 'WHERE k.lote = ?' : ''} ORDER BY k.creado_en DESC LIMIT 2000`,
  )
    .bind(...(lote ? [lote] : []))
    .all()
  return c.json(results)
})

admin.post('/codigos', async (c) => {
  const b = await leerJson(c.req.raw)
  const libroId = texto(b.libro_id, 40)
  const planId = texto(b.plan_id, 40)
  if (!libroId === !planId) throw falla(400, 'codigo_invalido', 'Indica libro_id o plan_id (uno de los dos).')
  if (libroId && !(await libroPorId(c.env, libroId))) throw falla(404, 'no_existe', 'Ese libro no existe.')
  if (planId && !(await c.env.DB.prepare('SELECT 1 FROM planes WHERE id = ?').bind(planId).first())) throw falla(404, 'no_existe', 'Ese plan no existe.')
  const cantidad = entero(b.cantidad ?? 1, 1, 1000)
  const prefijo = (texto(b.prefijo, 6) ?? 'PN').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const lote = texto(b.lote, 60) ?? `lote-${ahora().slice(0, 10)}-${tokenAleatorio(3)}`
  const codigos = Array.from({ length: cantidad }, () => generarCodigo(prefijo ? `${prefijo}-` : ''))
  const u = usuarioActual(c)
  const stmts = codigos.map((k) =>
    c.env.DB.prepare(
      'INSERT INTO codigos_canje (codigo, libro_id, plan_id, dias, usos_max, vence_en, lote, nota, creado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(k, libroId, planId, b.dias == null ? null : entero(b.dias, 1, 3650), entero(b.usos_max ?? 1, 1, 100000), texto(b.vence_en, 40), lote, texto(b.nota, 300), u.id),
  )
  for (let i = 0; i < stmts.length; i += 100) await c.env.DB.batch(stmts.slice(i, i + 100))
  return c.json({ lote, codigos }, 201)
})

admin.delete('/codigos/:codigo', async (c) => {
  // Anular = dejarlo sin usos restantes (se conserva el historial de canjes).
  await c.env.DB.prepare('UPDATE codigos_canje SET usos_max = usos WHERE codigo = ?').bind(c.req.param('codigo')).run()
  return c.json({ ok: true })
})

/* ---------- Preguntas frecuentes del asistente ---------- */

admin.get('/faq', async (c) => c.json((await c.env.DB.prepare('SELECT * FROM asistente_faq ORDER BY tema, orden').all()).results))

admin.post('/faq', async (c) => {
  const b = await leerJson(c.req.raw)
  const pregunta = texto(b.pregunta, 500)
  const respuesta = texto(b.respuesta, 4000)
  if (!pregunta || !respuesta) throw falla(400, 'faq_invalida', 'Faltan pregunta y respuesta.')
  const id = nuevoId('faq')
  await c.env.DB.prepare('INSERT INTO asistente_faq (id, pregunta, respuesta, tema, orden) VALUES (?, ?, ?, ?, ?)')
    .bind(id, pregunta, respuesta, texto(b.tema, 40) ?? 'general', Number(b.orden ?? 0) || 0)
    .run()
  return c.json({ id }, 201)
})

admin.patch('/faq/:id', async (c) => {
  const b = await leerJson(c.req.raw)
  await c.env.DB.prepare(
    `UPDATE asistente_faq SET pregunta = COALESCE(?, pregunta), respuesta = COALESCE(?, respuesta), tema = COALESCE(?, tema),
            activo = COALESCE(?, activo), orden = COALESCE(?, orden), actualizado_en = ? WHERE id = ?`,
  )
    .bind(texto(b.pregunta, 500), texto(b.respuesta, 4000), texto(b.tema, 40), 'activo' in b ? (b.activo ? 1 : 0) : null, b.orden ?? null, ahora(), c.req.param('id'))
    .run()
  return c.json({ ok: true })
})

admin.delete('/faq/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM asistente_faq WHERE id = ?').bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

/* ---------- Ajustes, rastreo y resumen ---------- */

admin.get('/ajustes', requiereRol('admin'), async (c) => c.json(await todosLosAjustes(c.env)))

admin.patch('/ajustes', requiereRol('admin'), async (c) => {
  const b = await leerJson(c.req.raw)
  const actuales = await todosLosAjustes(c.env)
  const stmts: D1PreparedStatement[] = []
  for (const [k, v] of Object.entries(b)) {
    if (!(k in actuales)) throw falla(400, 'ajuste_desconocido', `Ajuste desconocido: ${k}`)
    const valor = typeof v === 'string' ? v : JSON.stringify(v)
    if ((AJUSTES_NUMERICOS as readonly string[]).includes(k) && !Number.isFinite(Number(valor))) throw falla(400, 'numero_invalido', `${k} debe ser número.`)
    if (['cuentas_bancarias', 'billeteras'].includes(k)) {
      try {
        if (!Array.isArray(JSON.parse(valor))) throw new Error()
      } catch {
        throw falla(400, 'json_invalido', `${k} debe ser una lista JSON.`)
      }
    }
    stmts.push(c.env.DB.prepare('UPDATE ajustes SET valor = ? WHERE clave = ?').bind(valor, k))
  }
  if (stmts.length) await c.env.DB.batch(stmts)
  return c.json(await todosLosAjustes(c.env))
})

admin.get('/huella/:huella', async (c) => {
  const h = c.req.param('huella').toUpperCase()
  const ev = await c.env.DB.prepare(
    `SELECT e.huella, e.pagina, e.creado_en, e.ip, e.dispositivo_id, u.correo, u.nombre, l.titulo, d.nombre AS dispositivo, d.plataforma
       FROM eventos_lectura e JOIN usuarios u ON u.id = e.usuario_id JOIN libros l ON l.id = e.libro_id
       LEFT JOIN dispositivos d ON d.id = e.dispositivo_id WHERE e.huella = ?`,
  )
    .bind(h)
    .first()
  if (!ev) throw falla(404, 'no_existe', 'No hay ninguna página servida con esa huella.')
  return c.json(ev)
})

admin.get('/resumen', async (c) => {
  const mes = new Date().toISOString().slice(0, 7)
  const [ventas, porRevisar, lectores, porMetodo, asistente] = await Promise.all([
    c.env.DB.prepare(
      "SELECT COUNT(*) AS pedidos, COALESCE(SUM(total_centavos), 0) AS total FROM pedidos WHERE pagado_en >= ? AND estado IN ('pagado','enviado','entregado')",
    )
      .bind(`${mes}-01`)
      .first<{ pedidos: number; total: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM pedidos WHERE estado = 'en_revision'").first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(DISTINCT usuario_id) AS n FROM eventos_lectura WHERE creado_en >= ?')
      .bind(new Date(Date.now() - 30 * 86_400_000).toISOString())
      .first<{ n: number }>(),
    c.env.DB.prepare(
      "SELECT metodo, COUNT(*) AS pedidos, SUM(total_centavos) AS total FROM pedidos WHERE pagado_en >= ? AND estado IN ('pagado','enviado','entregado') GROUP BY metodo",
    )
      .bind(`${mes}-01`)
      .all<{ metodo: string; pedidos: number; total: number }>(),
    c.env.DB.prepare('SELECT consultas, costo_microdolares FROM asistente_uso WHERE mes = ?').bind(mes).first<{ consultas: number; costo_microdolares: number }>(),
  ])
  return c.json({
    mes,
    ventas_gtq: aGtq(ventas?.total ?? 0),
    pedidos_pagados: ventas?.pedidos ?? 0,
    por_metodo: porMetodo.results.map((r) => ({ metodo: r.metodo, pedidos: r.pedidos, total_gtq: aGtq(r.total) })),
    pedidos_por_revisar: porRevisar?.n ?? 0,
    lectores_activos_30_dias: lectores?.n ?? 0,
    asistente: { consultas: asistente?.consultas ?? 0, gasto_usd: (asistente?.costo_microdolares ?? 0) / 1_000_000 },
  })
})

admin.post('/sitio/reconstruir', async (c) => {
  if (!c.env.PAGES_DEPLOY_HOOK) throw falla(503, 'sin_hook', 'Falta configurar PAGES_DEPLOY_HOOK.')
  const r = await fetch(c.env.PAGES_DEPLOY_HOOK, { method: 'POST' })
  if (!r.ok) throw falla(502, 'hook_error', 'Cloudflare Pages no aceptó la reconstrucción.')
  return c.json({ ok: true })
})
