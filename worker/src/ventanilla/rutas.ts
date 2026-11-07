// /api/ventanilla: lo que ven y hacen las cuentas de los ministerios.
import { Hono } from 'hono'
import type { Env, Variables } from '../env'
import { requiereSesion } from '../lib/sesion'
import {
  DOCUMENTOS_SOLICITUD, ErrorVentanilla, SELECT_EXPEDIENTE, TIPOS_DOCUMENTO, avisarDocumentos, avisarSolicitudNueva, descargarDocumento, despues,
  entero, guardarDocumento, nuevoId, responderError, siguienteCodigo, texto, validarArchivo, type Ctx, type ExpedienteFila, type TipoDocumento,
} from './servicio'

export const ventanilla = new Hono<{ Bindings: Env; Variables: Variables }>()

ventanilla.onError(responderError)

ventanilla.use('*', requiereSesion)

const esEditorial = (rol: string) => rol === 'editor' || rol === 'admin'

/** Ministerios a los que pertenece el usuario. Editores y administradores ven todos. */
async function misMinisterios(c: Ctx) {
  const u = c.get('usuario')!
  const sql = esEditorial(u.rol)
    ? `SELECT id, nombre, siglas FROM ministerios WHERE activo = 1 ORDER BY nombre`
    : `SELECT m.id, m.nombre, m.siglas FROM ministerio_miembros mm JOIN ministerios m ON m.id = mm.ministerio_id
       WHERE mm.usuario_id = ?1 AND m.activo = 1 ORDER BY m.nombre`
  const st = c.env.DB.prepare(sql)
  const { results } = await (esEditorial(u.rol) ? st : st.bind(u.id)).all<{ id: string; nombre: string; siglas: string | null }>()
  return results
}

/** Busca un expediente por código y verifica que el usuario pueda verlo. */
async function expedienteVisible(c: Ctx, codigo: string): Promise<ExpedienteFila> {
  const u = c.get('usuario')!
  const exp = await c.env.DB.prepare(`${SELECT_EXPEDIENTE} WHERE e.codigo = ?`).bind(codigo.toUpperCase()).first<ExpedienteFila>()
  if (!exp) throw new ErrorVentanilla(404, 'No encontramos ese expediente.')
  if (esEditorial(u.rol) || exp.solicitante_id === u.id) return exp
  const miembro = await c.env.DB
    .prepare('SELECT 1 FROM ministerio_miembros WHERE ministerio_id = ? AND usuario_id = ?')
    .bind(exp.ministerio_id, u.id).first()
  if (!miembro) throw new ErrorVentanilla(404, 'No encontramos ese expediente.')
  return exp
}

ventanilla.get('/yo', async (c) => {
  const u = c.get('usuario')!
  return c.json({ usuario: u, ministerios: await misMinisterios(c) })
})

ventanilla.get('/etapas', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM etapas_editoriales ORDER BY numero').all()
  return c.json(results)
})

/** Lista de documentos de la solicitud, para que el formulario muestre cuáles son obligatorios. */
ventanilla.get('/documentos-solicitud', (c) => c.json(DOCUMENTOS_SOLICITUD))

ventanilla.get('/expedientes', async (c) => {
  const u = c.get('usuario')!
  const { results } = await c.env.DB
    .prepare(`${SELECT_EXPEDIENTE}
      WHERE e.solicitante_id = ?1 OR e.ministerio_id IN (SELECT ministerio_id FROM ministerio_miembros WHERE usuario_id = ?1)
      ORDER BY e.actualizado_en DESC`)
    .bind(u.id).all<ExpedienteFila>()
  return c.json(results)
})

/**
 * Solicitud nueva (multipart/form-data).
 * Campos: ministerio_id, titulo, subtitulo, autores, genero, publico, sinopsis, paginas_aprox, modalidad, tiraje_estimado.
 * Archivos: los de DOCUMENTOS_SOLICITUD (manuscrito en Word, currículum, declaración, Carta de Autorización y
 * Formato de Créditos obligatorios; índice, permisos, foto del autor, propuesta de portada y otros opcionales).
 */
ventanilla.post('/expedientes', async (c) => {
  const u = c.get('usuario')!
  const f = await c.req.formData()
  const ministerioId = texto(f.get('ministerio_id'), 64)
  const ministerios = await misMinisterios(c)
  if (!ministerioId || !ministerios.some((m) => m.id === ministerioId))
    throw new ErrorVentanilla(403, 'Su cuenta no está ligada a ese ministerio. Pida a la Dirección Editorial que la agregue.')

  const titulo = texto(f.get('titulo'), 200)
  const autores = texto(f.get('autores'), 300)
  const sinopsis = texto(f.get('sinopsis'), 4000)
  if (!titulo || !autores || !sinopsis) throw new ErrorVentanilla(400, 'Faltan el título, los autores o la sinopsis.')
  const modalidad = texto(f.get('modalidad'), 10) ?? 'impreso'
  if (!['impreso', 'digital', 'ambos'].includes(modalidad)) throw new ErrorVentanilla(400, 'Modalidad no válida.')

  const archivos: { archivo: File; tipo: TipoDocumento }[] = []
  for (const d of DOCUMENTOS_SOLICITUD) {
    for (const v of f.getAll(d.tipo)) if (v instanceof File && v.size > 0) archivos.push({ archivo: v, tipo: d.tipo })
  }
  const faltan = DOCUMENTOS_SOLICITUD.filter((d) => d.obligatorio && !archivos.some((a) => a.tipo === d.tipo)).map((d) => d.nombre)
  if (faltan.length) throw new ErrorVentanilla(400, `Falta adjuntar ${faltan.join(', ')}.`)
  if (archivos.length > 20) throw new ErrorVentanilla(400, 'Máximo 20 archivos por solicitud.')

  // Se valida todo antes de tomar el correlativo, para no dejar huecos en la numeración.
  for (const a of archivos) validarArchivo(a.archivo, a.tipo)
  const id = nuevoId()
  const codigo = await siguienteCodigo(c.env.DB)
  // Primero los archivos; si alguno falla, se borran los que ya subieron y no queda expediente a medias.
  const subidos: { id: string; sentencia: D1PreparedStatement }[] = []
  try {
    for (const a of archivos) subidos.push(await guardarDocumento(c.env, id, a.archivo, a.tipo, u.id))
  } catch (e) {
    const { objects } = await c.env.ARCHIVOS.list({ prefix: `expedientes/${id}/` })
    if (objects.length) await c.env.ARCHIVOS.delete(objects.map((o) => o.key))
    throw e
  }

  const historialId = nuevoId()
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO expedientes (id, codigo, ministerio_id, solicitante_id, titulo, subtitulo, autores, genero,
        publico, sinopsis, semblanza_autor, paginas_aprox, modalidad, tiraje_estimado) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)`)
      .bind(id, codigo, ministerioId, u.id, titulo, texto(f.get('subtitulo'), 200), autores, texto(f.get('genero'), 80),
        texto(f.get('publico'), 200), sinopsis, texto(f.get('semblanza_autor'), 3000), entero(f.get('paginas_aprox')), modalidad,
        entero(f.get('tiraje_estimado'))),
    ...subidos.map((s) => s.sentencia),
    c.env.DB.prepare(`INSERT INTO expediente_historial (id, expediente_id, tipo, etapa_nueva, estado_nuevo, nota, autor_id)
        VALUES (?1, ?2, 'creado', 1, 'en_curso', ?3, ?4)`)
      .bind(historialId, id, texto(f.get('mensaje'), 2000), u.id),
  ])

  const exp = (await c.env.DB.prepare(`${SELECT_EXPEDIENTE} WHERE e.id = ?`).bind(id).first<ExpedienteFila>())!
  despues(c, avisarSolicitudNueva(c.env, exp, historialId))
  return c.json(exp, 201)
})

ventanilla.get('/expedientes/:codigo', async (c) => {
  const exp = await expedienteVisible(c, c.req.param('codigo'))
  const interno = esEditorial(c.get('usuario')!.rol)
  const [historial, documentos] = await Promise.all([
    c.env.DB.prepare(`SELECT h.id, h.tipo, h.etapa_anterior, h.etapa_nueva, h.estado_nuevo, h.nota, h.creado_en,
        h.visible_ministerio, h.correo_enviado, u.nombre AS autor
      FROM expediente_historial h LEFT JOIN usuarios u ON u.id = h.autor_id
      WHERE h.expediente_id = ?1 ${interno ? '' : 'AND h.visible_ministerio = 1'} ORDER BY h.creado_en`).bind(exp.id).all(),
    c.env.DB.prepare(`SELECT id, tipo, nombre, tipo_mime, tamano, creado_en FROM expediente_documentos
      WHERE expediente_id = ? ORDER BY creado_en`).bind(exp.id).all(),
  ])
  return c.json({ ...exp, historial: historial.results, documentos: documentos.results })
})

/** El ministerio agrega documentos (por ejemplo, el manuscrito corregido cuando se le piden cambios). */
ventanilla.post('/expedientes/:codigo/documentos', async (c) => {
  const u = c.get('usuario')!
  const exp = await expedienteVisible(c, c.req.param('codigo'))
  if (exp.estado === 'rechazado' || exp.estado === 'publicado')
    throw new ErrorVentanilla(409, 'Este expediente ya está cerrado.')
  const f = await c.req.formData()
  const tipo = (texto(f.get('tipo'), 30) ?? 'otro') as TipoDocumento
  const permitidos: TipoDocumento[] = [...DOCUMENTOS_SOLICITUD.map((d) => d.tipo), 'pruebas']
  if (!TIPOS_DOCUMENTO.includes(tipo) || !permitidos.includes(tipo)) throw new ErrorVentanilla(400, 'Tipo de documento no válido.')
  const archivos = f.getAll('archivo').filter((v): v is File => v instanceof File && v.size > 0)
  if (!archivos.length) throw new ErrorVentanilla(400, 'Adjunte al menos un archivo.')
  if (archivos.length > 6) throw new ErrorVentanilla(400, 'Máximo 6 archivos a la vez.')
  for (const a of archivos) validarArchivo(a, tipo)
  const subidos = []
  for (const a of archivos) subidos.push(await guardarDocumento(c.env, exp.id, a, tipo, u.id))
  const nota = texto(f.get('nota'), 2000)
  await c.env.DB.batch([
    ...subidos.map((s) => s.sentencia),
    c.env.DB.prepare(`INSERT INTO expediente_historial (id, expediente_id, tipo, nota, autor_id) VALUES (?1, ?2, 'documento', ?3, ?4)`)
      .bind(nuevoId(), exp.id, nota ?? `Se agregó: ${archivos.map((a) => a.name).join(', ')}`, u.id),
    c.env.DB.prepare(`UPDATE expedientes SET actualizado_en = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).bind(exp.id),
  ])
  despues(c, avisarDocumentos(c.env, exp, archivos.map((a) => a.name), nota))
  return c.json({ ok: true, documentos: subidos.map((s) => s.id) }, 201)
})

ventanilla.get('/documentos/:id', async (c) => {
  const doc = await c.env.DB
    .prepare(`SELECT d.ruta, d.nombre, d.tipo_mime, e.codigo FROM expediente_documentos d
      JOIN expedientes e ON e.id = d.expediente_id WHERE d.id = ?`)
    .bind(c.req.param('id')).first<{ ruta: string; nombre: string; tipo_mime: string | null; codigo: string }>()
  if (!doc) throw new ErrorVentanilla(404, 'Documento no encontrado.')
  await expedienteVisible(c, doc.codigo)
  return descargarDocumento(c.env, doc)
})
