// /api/admin/expedientes y /api/admin/etapas: tablero de la Dirección Editorial.
import { Hono } from 'hono'
import type { Env, Variables } from '../env'
import { requiereRol } from '../lib/sesion'
import {
  DICTAMENES, ESTADOS, ErrorVentanilla, REVISIONES, SELECT_EXPEDIENTE, TIPOS_DOCUMENTO, avisarCambio, descargarDocumento, despues,
  NOMBRE_DICTAMEN, entero, infoEtapas, guardarDocumento, nuevoId, texto,
  type EstadoExpediente, type ExpedienteFila, type TipoDocumento,
} from '../ventanilla/servicio'

export const adminExpedientes = new Hono<{ Bindings: Env; Variables: Variables }>()
adminExpedientes.use('*', requiereRol('editor', 'admin'))

const AHORA_SQL = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`

// Días que lleva el expediente en su etapa actual (desde el último cambio de etapa o su creación).
const DIAS_EN_ETAPA = `CAST(julianday('now') - julianday(COALESCE(
  (SELECT MAX(h.creado_en) FROM expediente_historial h WHERE h.expediente_id = e.id AND h.tipo IN ('creado', 'etapa')),
  e.creado_en)) AS INTEGER)`

/** Lista con filtros: ?etapa=3&estado=en_curso&ministerio=<id>&q=texto&atrasados=1 */
adminExpedientes.get('/expedientes', async (c) => {
  const q = c.req.query()
  const filtros: string[] = []
  const valores: unknown[] = []
  const etapa = entero(q.etapa)
  if (etapa) { filtros.push('e.etapa = ?'); valores.push(etapa) }
  if (q.estado && (ESTADOS as readonly string[]).includes(q.estado)) { filtros.push('e.estado = ?'); valores.push(q.estado) }
  if (q.abiertos === '1') filtros.push(`e.estado NOT IN ('rechazado', 'publicado')`)
  if (q.ministerio) { filtros.push('e.ministerio_id = ?'); valores.push(q.ministerio) }
  if (q.responsable) { filtros.push('e.responsable_id = ?'); valores.push(q.responsable) }
  if (q.q) {
    filtros.push('(e.codigo LIKE ? OR e.titulo LIKE ? OR e.autores LIKE ? OR m.nombre LIKE ?)')
    const like = `%${q.q.trim()}%`
    valores.push(like, like, like, like)
  }
  const sql = `SELECT * FROM (
      SELECT e.*, m.nombre AS ministerio, et.nombre AS etapa_nombre, et.dias_estimados, ${DIAS_EN_ETAPA} AS dias_en_etapa,
        r.nombre AS responsable
      FROM expedientes e
      JOIN ministerios m ON m.id = e.ministerio_id
      JOIN etapas_editoriales et ON et.numero = e.etapa
      LEFT JOIN usuarios r ON r.id = e.responsable_id
      ${filtros.length ? `WHERE ${filtros.join(' AND ')}` : ''}
    ) ${q.atrasados === '1' ? `WHERE estado = 'en_curso' AND dias_estimados IS NOT NULL AND dias_en_etapa > dias_estimados` : ''}
    ORDER BY actualizado_en DESC LIMIT 500`
  const { results } = await c.env.DB.prepare(sql).bind(...valores).all()
  return c.json(results)
})

/** Números para el tablero: por etapa, por estado, atrasados y actividad reciente. */
adminExpedientes.get('/expedientes/resumen', async (c) => {
  const db = c.env.DB
  const [porEtapa, porEstado, atrasados, recientes, anio] = await db.batch([
    db.prepare(`SELECT et.numero, et.nombre, et.dias_estimados, COUNT(e.id) AS total
      FROM etapas_editoriales et LEFT JOIN expedientes e ON e.etapa = et.numero AND e.estado IN ('en_curso', 'requiere_cambios', 'en_pausa')
      GROUP BY et.numero ORDER BY et.numero`),
    db.prepare(`SELECT estado, COUNT(*) AS total FROM expedientes GROUP BY estado`),
    db.prepare(`SELECT COUNT(*) AS total FROM (
      SELECT ${DIAS_EN_ETAPA} AS dias, et.dias_estimados FROM expedientes e JOIN etapas_editoriales et ON et.numero = e.etapa
      WHERE e.estado = 'en_curso') WHERE dias_estimados IS NOT NULL AND dias > dias_estimados`),
    db.prepare(`SELECT h.id, h.tipo, h.etapa_nueva, h.estado_nuevo, h.nota, h.creado_en, e.id AS expediente_id, e.codigo, e.titulo,
        u.nombre AS autor
      FROM expediente_historial h JOIN expedientes e ON e.id = h.expediente_id LEFT JOIN usuarios u ON u.id = h.autor_id
      ORDER BY h.creado_en DESC LIMIT 15`),
    db.prepare(`SELECT COUNT(*) AS recibidas, SUM(estado = 'publicado') AS publicadas FROM expedientes
      WHERE substr(creado_en, 1, 4) = strftime('%Y', 'now')`),
  ])
  return c.json({
    por_etapa: porEtapa.results,
    por_estado: Object.fromEntries((porEstado.results as { estado: string; total: number }[]).map((r) => [r.estado, r.total])),
    atrasados: (atrasados.results[0] as { total: number }).total,
    recientes: recientes.results,
    anio: anio.results[0],
  })
})

async function obtener(db: D1Database, id: string) {
  const exp = await db.prepare(`${SELECT_EXPEDIENTE} WHERE e.id = ?1 OR e.codigo = ?1`).bind(id).first<ExpedienteFila>()
  if (!exp) throw new ErrorVentanilla(404, 'Expediente no encontrado.')
  return exp
}

adminExpedientes.get('/expedientes/:id', async (c) => {
  const exp = await obtener(c.env.DB, c.req.param('id'))
  const [historial, documentos, solicitante] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT h.*, u.nombre AS autor, u.correo AS autor_correo FROM expediente_historial h
      LEFT JOIN usuarios u ON u.id = h.autor_id WHERE h.expediente_id = ? ORDER BY h.creado_en`).bind(exp.id),
    c.env.DB.prepare(`SELECT d.id, d.tipo, d.nombre, d.tipo_mime, d.tamano, d.creado_en, u.nombre AS subido_por
      FROM expediente_documentos d LEFT JOIN usuarios u ON u.id = d.subido_por WHERE d.expediente_id = ? ORDER BY d.creado_en`).bind(exp.id),
    c.env.DB.prepare(`SELECT id, nombre, correo, telefono FROM usuarios WHERE id = ?`).bind(exp.solicitante_id),
  ])
  return c.json({ ...exp, historial: historial.results, documentos: documentos.results, solicitante: solicitante.results[0] ?? null })
})

/** Cambia la etapa. Avisa por correo al ministerio. Llegar a una etapa que publica marca el expediente como publicado. */
adminExpedientes.post('/expedientes/:id/etapa', async (c) => {
  const u = c.get('usuario')!
  const exp = await obtener(c.env.DB, c.req.param('id'))
  const cuerpo = await c.req.json<{ etapa: number; nota?: string; avisar?: boolean }>()
  const etapa = entero(cuerpo.etapa)
  const fases = await infoEtapas(c.env.DB)
  if (!etapa || etapa < 1 || etapa > fases.ultima) throw new ErrorVentanilla(400, `La etapa debe ser de 1 a ${fases.ultima}.`)
  if (etapa === exp.etapa) throw new ErrorVentanilla(409, 'El expediente ya está en esa etapa.')
  if (exp.estado === 'rechazado') throw new ErrorVentanilla(409, 'El expediente fue rechazado; reanúdelo antes de moverlo.')
  const estado: EstadoExpediente = etapa >= fases.publica ? 'publicado' : 'en_curso'
  const nota = texto(cuerpo.nota, 4000)
  const hid = nuevoId('his')
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE expedientes SET etapa = ?1, estado = ?2, actualizado_en = ${AHORA_SQL} WHERE id = ?3`)
      .bind(etapa, estado, exp.id),
    c.env.DB.prepare(`INSERT INTO expediente_historial (id, expediente_id, tipo, etapa_anterior, etapa_nueva, estado_nuevo, nota, autor_id)
      VALUES (?1, ?2, 'etapa', ?3, ?4, ?5, ?6, ?7)`).bind(hid, exp.id, exp.etapa, etapa, estado, nota, u.id),
  ])
  if (cuerpo.avisar !== false) despues(c, avisarCambio(c.env, exp.id, hid, nota))
  return c.json(await obtener(c.env.DB, exp.id))
})

/** Cambia el estado sin mover la etapa: pedir cambios, pausar, rechazar o reanudar. Avisa por correo. */
adminExpedientes.post('/expedientes/:id/estado', async (c) => {
  const u = c.get('usuario')!
  const exp = await obtener(c.env.DB, c.req.param('id'))
  const cuerpo = await c.req.json<{ estado: EstadoExpediente; nota?: string; avisar?: boolean }>()
  if (!ESTADOS.includes(cuerpo.estado) || cuerpo.estado === 'publicado')
    throw new ErrorVentanilla(400, 'Estado no válido. Para publicar, pase el expediente a la etapa de publicación.')
  if (cuerpo.estado === exp.estado) throw new ErrorVentanilla(409, 'El expediente ya tiene ese estado.')
  const nota = texto(cuerpo.nota, 4000)
  if ((cuerpo.estado === 'requiere_cambios' || cuerpo.estado === 'rechazado') && !nota)
    throw new ErrorVentanilla(400, 'Explique al ministerio qué debe cambiar o por qué no se aprobó.')
  const hid = nuevoId('his')
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE expedientes SET estado = ?1, actualizado_en = ${AHORA_SQL} WHERE id = ?2`).bind(cuerpo.estado, exp.id),
    c.env.DB.prepare(`INSERT INTO expediente_historial (id, expediente_id, tipo, etapa_nueva, estado_nuevo, nota, autor_id)
      VALUES (?1, ?2, 'estado', ?3, ?4, ?5, ?6)`).bind(hid, exp.id, exp.etapa, cuerpo.estado, nota, u.id),
  ])
  if (cuerpo.avisar !== false) despues(c, avisarCambio(c.env, exp.id, hid, nota))
  return c.json(await obtener(c.env.DB, exp.id))
})

/** Nota en el historial: interna (solo Dirección Editorial) o visible para el ministerio (con aviso por correo). */
adminExpedientes.post('/expedientes/:id/notas', async (c) => {
  const u = c.get('usuario')!
  const exp = await obtener(c.env.DB, c.req.param('id'))
  const cuerpo = await c.req.json<{ nota: string; visible_ministerio?: boolean }>()
  const nota = texto(cuerpo.nota, 4000)
  if (!nota) throw new ErrorVentanilla(400, 'Escriba la nota.')
  const visible = cuerpo.visible_ministerio ? 1 : 0
  const hid = nuevoId('his')
  await c.env.DB.prepare(`INSERT INTO expediente_historial (id, expediente_id, tipo, nota, visible_ministerio, autor_id)
    VALUES (?1, ?2, 'nota', ?3, ?4, ?5)`).bind(hid, exp.id, nota, visible, u.id).run()
  if (visible) despues(c, avisarCambio(c.env, exp.id, hid, nota))
  return c.json({ ok: true, id: hid }, 201)
})

/** Datos que asigna la Dirección Editorial: modalidad de revisión, responsable y la obra del catálogo. */
adminExpedientes.patch('/expedientes/:id', async (c) => {
  const exp = await obtener(c.env.DB, c.req.param('id'))
  const cuerpo = await c.req.json<Record<string, unknown>>()
  const editables = ['revision', 'dictamen', 'responsable_id', 'libro_id', 'titulo', 'subtitulo', 'autores', 'genero', 'publico',
    'sinopsis', 'semblanza_autor', 'paginas_aprox', 'modalidad', 'tiraje_estimado'] as const
  const sets: string[] = []
  const valores: unknown[] = []
  for (const k of editables) {
    if (!(k in cuerpo)) continue
    let v = cuerpo[k]
    if (k === 'paginas_aprox' || k === 'tiraje_estimado') v = entero(v)
    else v = typeof v === 'string' ? (v.trim() || null) : null
    if (k === 'modalidad' && !['impreso', 'digital', 'ambos'].includes(String(v))) throw new ErrorVentanilla(400, 'Modalidad no válida.')
    if (k === 'revision' && v && !(REVISIONES as readonly string[]).includes(String(v))) throw new ErrorVentanilla(400, 'Modalidad de revisión no válida (A, B o C).')
    if (k === 'dictamen' && v && !(DICTAMENES as readonly string[]).includes(String(v))) throw new ErrorVentanilla(400, 'Resultado de dictamen no válido.')
    if ((k === 'titulo' || k === 'autores' || k === 'sinopsis') && !v) throw new ErrorVentanilla(400, `El campo ${k} no puede quedar vacío.`)
    sets.push(`${k} = ?`)
    valores.push(v)
  }
  if (!sets.length) throw new ErrorVentanilla(400, 'No hay cambios.')
  await c.env.DB.prepare(`UPDATE expedientes SET ${sets.join(', ')}, actualizado_en = ${AHORA_SQL} WHERE id = ?`)
    .bind(...valores, exp.id).run()
  // El resultado del dictamen queda en el historial y se avisa al ministerio.
  const dictamen = cuerpo.dictamen as (typeof DICTAMENES)[number] | undefined
  if (dictamen && dictamen !== exp.dictamen) {
    const hid = nuevoId('his')
    const nota = `Dictamen de la Junta Editorial: ${NOMBRE_DICTAMEN[dictamen]}.${typeof cuerpo.nota === 'string' && cuerpo.nota.trim() ? `\n\n${cuerpo.nota.trim().slice(0, 4000)}` : ''}`
    await c.env.DB.prepare(`INSERT INTO expediente_historial (id, expediente_id, tipo, nota, autor_id) VALUES (?1, ?2, 'nota', ?3, ?4)`)
      .bind(hid, exp.id, nota, c.get('usuario')!.id).run()
    despues(c, avisarCambio(c.env, exp.id, hid, nota))
  }
  return c.json(await obtener(c.env.DB, exp.id))
})

/** La Dirección Editorial adjunta documentos (dictamen, pruebas, portada...). */
adminExpedientes.post('/expedientes/:id/documentos', async (c) => {
  const u = c.get('usuario')!
  const exp = await obtener(c.env.DB, c.req.param('id'))
  const f = await c.req.formData()
  const tipo = (texto(f.get('tipo'), 30) ?? 'otro') as TipoDocumento
  if (!TIPOS_DOCUMENTO.includes(tipo)) throw new ErrorVentanilla(400, 'Tipo de documento no válido.')
  const archivos = f.getAll('archivo').filter((v): v is File => v instanceof File && v.size > 0)
  if (!archivos.length) throw new ErrorVentanilla(400, 'Adjunte al menos un archivo.')
  const subidos = []
  for (const a of archivos.slice(0, 6)) subidos.push(await guardarDocumento(c.env, exp.id, a, tipo, u.id))
  const visible = f.get('visible_ministerio') === '1' ? 1 : 0
  await c.env.DB.batch([
    ...subidos.map((s) => s.sentencia),
    c.env.DB.prepare(`INSERT INTO expediente_historial (id, expediente_id, tipo, nota, visible_ministerio, autor_id)
      VALUES (?1, ?2, 'documento', ?3, ?4, ?5)`)
      .bind(nuevoId('his'), exp.id, texto(f.get('nota'), 2000) ?? `Se adjuntó: ${archivos.map((a) => a.name).join(', ')}`, visible, u.id),
    c.env.DB.prepare(`UPDATE expedientes SET actualizado_en = ${AHORA_SQL} WHERE id = ?`).bind(exp.id),
  ])
  return c.json({ ok: true, documentos: subidos.map((s) => s.id) }, 201)
})

adminExpedientes.get('/expedientes/documentos/:doc', async (c) => {
  const doc = await c.env.DB.prepare('SELECT ruta, nombre, tipo_mime FROM expediente_documentos WHERE id = ?')
    .bind(c.req.param('doc')).first<{ ruta: string; nombre: string; tipo_mime: string | null }>()
  if (!doc) throw new ErrorVentanilla(404, 'Documento no encontrado.')
  return descargarDocumento(c.env, doc)
})

// ---------- Etapas (nombres y plazos editables) ----------
adminExpedientes.get('/etapas', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM etapas_editoriales ORDER BY numero').all()
  return c.json(results)
})

adminExpedientes.put('/etapas/:numero', async (c) => {
  const numero = entero(c.req.param('numero'))
  const cuerpo = await c.req.json<{ nombre: string; descripcion?: string; responsable?: string; dias_estimados?: number | null; publica?: boolean }>()
  const nombre = texto(cuerpo.nombre, 80)
  if (!nombre) throw new ErrorVentanilla(400, 'La etapa necesita un nombre.')
  const r = await c.env.DB.prepare('UPDATE etapas_editoriales SET nombre = ?, descripcion = ?, responsable = ?, dias_estimados = ?, publica = ? WHERE numero = ?')
    .bind(nombre, texto(cuerpo.descripcion, 500) ?? '', texto(cuerpo.responsable, 120), entero(cuerpo.dias_estimados), cuerpo.publica ? 1 : 0, numero).run()
  if (!r.meta.changes) throw new ErrorVentanilla(404, 'Etapa no encontrada.')
  return c.json({ ok: true })
})

/** Agrega una etapa al final. */
adminExpedientes.post('/etapas', async (c) => {
  const cuerpo = await c.req.json<{ nombre: string; descripcion?: string; dias_estimados?: number | null }>()
  const nombre = texto(cuerpo.nombre, 80)
  if (!nombre) throw new ErrorVentanilla(400, 'La etapa necesita un nombre.')
  const { ultima } = await infoEtapas(c.env.DB)
  await c.env.DB.prepare('INSERT INTO etapas_editoriales (numero, nombre, descripcion, dias_estimados, publica) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(publica), 0) FROM etapas_editoriales))')
    .bind(ultima + 1, nombre, texto(cuerpo.descripcion, 500) ?? '', entero(cuerpo.dias_estimados)).run()
  return c.json({ ok: true, numero: ultima + 1 }, 201)
})

/** Quita la última etapa, solo si ningún expediente está en ella ni la usó en su historial. */
adminExpedientes.delete('/etapas/:numero', async (c) => {
  const numero = entero(c.req.param('numero'))
  const { ultima, total } = await infoEtapas(c.env.DB)
  if (numero !== ultima) throw new ErrorVentanilla(409, 'Solo se puede quitar la última etapa.')
  if (total <= 2) throw new ErrorVentanilla(409, 'El proceso necesita al menos dos etapas.')
  const usada = await c.env.DB.prepare(`SELECT 1 FROM expedientes WHERE etapa = ?1
      UNION SELECT 1 FROM expediente_historial WHERE etapa_nueva = ?1 OR etapa_anterior = ?1 LIMIT 1`).bind(numero).first()
  if (usada) throw new ErrorVentanilla(409, 'Hay expedientes que pasaron por esta etapa; cámbiele el nombre en lugar de quitarla.')
  await c.env.DB.prepare('DELETE FROM etapas_editoriales WHERE numero = ?').bind(numero).run()
  return c.json({ ok: true })
})
