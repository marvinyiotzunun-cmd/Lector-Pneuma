// Lógica compartida de la ventanilla: código de expediente, archivos, historial y avisos por correo.
import type { Context } from 'hono'
import type { Env, Variables } from '../env'
import { enviarCorreo } from '../lib/correo'
import { correoAvisoEtapa, correoDocumentoNuevo, correoNuevaSolicitud } from './correos'

export type Ctx = Context<{ Bindings: Env; Variables: Variables }>

export const ESTADOS = ['en_curso', 'requiere_cambios', 'en_pausa', 'rechazado', 'publicado'] as const
export type EstadoExpediente = (typeof ESTADOS)[number]

export const TIPOS_DOCUMENTO = ['manuscrito', 'carta_autorizacion', 'creditos', 'dictamen', 'portada', 'pruebas', 'otro'] as const
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number]

export const NOMBRE_ESTADO: Record<EstadoExpediente, string> = {
  en_curso: 'En curso',
  requiere_cambios: 'Requiere cambios del ministerio',
  en_pausa: 'En pausa',
  rechazado: 'No aprobada',
  publicado: 'Publicada',
}

export const MB = 1024 * 1024
export const TAMANO_MAXIMO = 40 * MB

const EXTENSIONES: Record<string, string[]> = {
  manuscrito: ['doc', 'docx', 'odt', 'rtf', 'pdf', 'txt'],
  portada: ['jpg', 'jpeg', 'png', 'webp', 'pdf', 'tif', 'tiff', 'psd', 'ai'],
  otro: ['pdf', 'doc', 'docx', 'odt', 'jpg', 'jpeg', 'png', 'webp', 'zip', 'xlsx', 'txt'],
}
const extensionesDe = (tipo: TipoDocumento) => EXTENSIONES[tipo] ?? ['pdf', 'doc', 'docx', 'odt', 'jpg', 'jpeg', 'png', 'webp']

export const ahora = () => new Date().toISOString()
export const nuevoId = () => crypto.randomUUID()

/** Error con el formato del contrato: {"error": {"codigo", "mensaje"}}. */
export class ErrorVentanilla extends Error {
  constructor(public estado: 400 | 403 | 404 | 409 | 413, mensaje: string, public codigo = CODIGOS[estado]) { super(mensaje) }
}
const CODIGOS = { 400: 'datos_invalidos', 403: 'sin_permiso', 404: 'no_encontrado', 409: 'conflicto', 413: 'archivo_grande' } as const

export function responderError(err: Error, c: Ctx) {
  if (err instanceof ErrorVentanilla) return c.json({ error: { codigo: err.codigo, mensaje: err.message } }, err.estado)
  throw err
}

/** Siguiente código del año: PNE-2026-0001. El correlativo se incrementa de forma atómica en D1. */
export async function siguienteCodigo(db: D1Database, fecha = new Date()): Promise<string> {
  const anio = fecha.getUTCFullYear()
  const fila = await db
    .prepare(`INSERT INTO expediente_secuencia (anio, ultimo) VALUES (?1, 1)
              ON CONFLICT (anio) DO UPDATE SET ultimo = ultimo + 1 RETURNING ultimo`)
    .bind(anio)
    .first<{ ultimo: number }>()
  return `PNE-${anio}-${String(fila!.ultimo).padStart(4, '0')}`
}

/** Limpia el nombre de archivo para usarlo en la ruta de R2 y en la descarga. */
export function nombreSeguro(nombre: string): string {
  const limpio = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '_')
  return (limpio || 'archivo').slice(-120)
}

export function validarArchivo(archivo: File, tipo: TipoDocumento) {
  if (archivo.size === 0) throw new ErrorVentanilla(400, `El archivo «${archivo.name}» está vacío.`)
  if (archivo.size > TAMANO_MAXIMO)
    throw new ErrorVentanilla(413, `«${archivo.name}» pesa más de ${TAMANO_MAXIMO / MB} MB.`)
  const ext = archivo.name.split('.').pop()?.toLowerCase() ?? ''
  if (!extensionesDe(tipo).includes(ext))
    throw new ErrorVentanilla(400, `«${archivo.name}» no es un formato aceptado (${extensionesDe(tipo).join(', ')}).`)
}

/** Sube un documento a R2 y devuelve la sentencia para registrarlo (se ejecuta en lote con lo demás). */
export async function guardarDocumento(
  env: Env, expedienteId: string, archivo: File, tipo: TipoDocumento, usuarioId: string,
): Promise<{ id: string; sentencia: D1PreparedStatement }> {
  validarArchivo(archivo, tipo)
  const id = nuevoId()
  const nombre = nombreSeguro(archivo.name)
  const ruta = `expedientes/${expedienteId}/${id}-${nombre}`
  await env.ARCHIVOS.put(ruta, archivo.stream(), {
    httpMetadata: { contentType: archivo.type || 'application/octet-stream' },
    customMetadata: { expediente: expedienteId, tipo },
  })
  const sentencia = env.DB
    .prepare(`INSERT INTO expediente_documentos (id, expediente_id, tipo, nombre, ruta, tipo_mime, tamano, subido_por)
              VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`)
    .bind(id, expedienteId, tipo, archivo.name.slice(0, 200), ruta, archivo.type || null, archivo.size, usuarioId)
  return { id, sentencia }
}

/** Entrega un documento desde R2 como descarga. */
export async function descargarDocumento(env: Env, doc: { ruta: string; nombre: string; tipo_mime: string | null }) {
  const objeto = await env.ARCHIVOS.get(doc.ruta)
  if (!objeto) throw new ErrorVentanilla(404, 'El archivo ya no está disponible.')
  const encabezados = new Headers()
  objeto.writeHttpMetadata(encabezados)
  encabezados.set('Content-Type', doc.tipo_mime || encabezados.get('Content-Type') || 'application/octet-stream')
  encabezados.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(doc.nombre)}`)
  encabezados.set('Cache-Control', 'private, no-store')
  return new Response(objeto.body, { headers: encabezados })
}

export interface ExpedienteFila {
  id: string; codigo: string; ministerio_id: string; ministerio: string; solicitante_id: string
  titulo: string; subtitulo: string | null; autores: string; genero: string | null; publico: string | null
  sinopsis: string; paginas_aprox: number | null; modalidad: string; tiraje_estimado: number | null
  revision: string | null; etapa: number; etapa_nombre: string; estado: EstadoExpediente
  responsable_id: string | null; libro_id: string | null; creado_en: string; actualizado_en: string
}

export const SELECT_EXPEDIENTE = `
  SELECT e.*, m.nombre AS ministerio, et.nombre AS etapa_nombre
  FROM expedientes e
  JOIN ministerios m ON m.id = e.ministerio_id
  JOIN etapas_editoriales et ON et.numero = e.etapa`

/** Correos del ministerio que deben recibir los avisos: solicitante, miembros y contacto. */
export async function correosDelMinisterio(db: D1Database, expediente: { ministerio_id: string; solicitante_id: string }) {
  const { results } = await db
    .prepare(`SELECT u.correo FROM usuarios u WHERE u.id = ?2
              UNION SELECT u.correo FROM ministerio_miembros mm JOIN usuarios u ON u.id = mm.usuario_id WHERE mm.ministerio_id = ?1
              UNION SELECT contacto_correo FROM ministerios WHERE id = ?1 AND contacto_correo IS NOT NULL`)
    .bind(expediente.ministerio_id, expediente.solicitante_id)
    .all<{ correo: string }>()
  return [...new Set(results.map((r) => r.correo?.trim().toLowerCase()).filter(Boolean))]
}

/** Correos de la Dirección Editorial: el ajuste correo_editorial o, si está vacío, todos los editores. */
export async function correosEditoriales(env: Env): Promise<string[]> {
  const ajuste = await env.DB.prepare(`SELECT valor FROM ajustes WHERE clave = 'correo_editorial'`).first<{ valor: string }>()
  const fijos = (ajuste?.valor ?? '').split(',').map((c) => c.trim()).filter((c) => c.includes('@'))
  if (fijos.length) return fijos
  const { results } = await env.DB
    .prepare(`SELECT correo FROM usuarios WHERE rol IN ('editor', 'admin')`)
    .all<{ correo: string }>()
  return results.map((r) => r.correo)
}

/** Enlace a una pantalla del panel (panel.html, rutas con #). */
export function urlPanel(env: Env, ruta: string) {
  const base = env.SITIO_URL || 'https://pneuma.gt'
  return `${base.replace(/\/$/, '')}/panel#${ruta}`
}

async function enviarATodos(env: Env, para: string[], asunto: string, html: string, texto: string) {
  const resultados = await Promise.allSettled(para.map((p) => enviarCorreo(env, { para: p, asunto, html, texto })))
  return resultados.some((r) => r.status === 'fulfilled')
}

/** Aviso de solicitud nueva: confirmación al ministerio y alerta a la Dirección Editorial. */
export async function avisarSolicitudNueva(env: Env, expediente: ExpedienteFila, historialId: string) {
  const alMinisterio = correoAvisoEtapa({
    expediente, etapa: 1, etapaNombre: expediente.etapa_nombre, estado: expediente.estado,
    nota: 'Recibimos su solicitud. La Dirección Editorial la revisará y le avisaremos de cada avance por este medio.',
    url: urlPanel(env, `/ventanilla/${expediente.codigo}`),
  })
  const aEditorial = correoNuevaSolicitud({ expediente, url: urlPanel(env, `/editorial/${expediente.id}`) })
  const [ok] = await Promise.all([
    enviarATodos(env, await correosDelMinisterio(env.DB, expediente), alMinisterio.asunto, alMinisterio.html, alMinisterio.texto),
    enviarATodos(env, await correosEditoriales(env), aEditorial.asunto, aEditorial.html, aEditorial.texto),
  ])
  if (ok) await env.DB.prepare('UPDATE expediente_historial SET correo_enviado = 1 WHERE id = ?').bind(historialId).run()
}

/** Aviso a la Dirección Editorial cuando el ministerio agrega documentos. */
export async function avisarDocumentos(env: Env, exp: ExpedienteFila, archivos: string[], nota: string | null) {
  const correo = correoDocumentoNuevo({ expediente: exp, archivos, nota, url: urlPanel(env, `/editorial/${exp.id}`) })
  await enviarATodos(env, await correosEditoriales(env), correo.asunto, correo.html, correo.texto)
}

/** Aviso al ministerio por cada cambio de etapa o de estado. */
export async function avisarCambio(env: Env, expedienteId: string, historialId: string, nota: string | null) {
  const exp = await env.DB.prepare(`${SELECT_EXPEDIENTE} WHERE e.id = ?`).bind(expedienteId).first<ExpedienteFila>()
  if (!exp) return
  const correo = correoAvisoEtapa({
    expediente: exp, etapa: exp.etapa, etapaNombre: exp.etapa_nombre, estado: exp.estado, nota,
    url: urlPanel(env, `/ventanilla/${exp.codigo}`),
  })
  const ok = await enviarATodos(env, await correosDelMinisterio(env.DB, exp), correo.asunto, correo.html, correo.texto)
  if (ok) await env.DB.prepare('UPDATE expediente_historial SET correo_enviado = 1 WHERE id = ?').bind(historialId).run()
}

/** Ejecuta una tarea después de responder, sin bloquear la respuesta (y sin fallar si no hay contexto). */
export function despues(c: Ctx, tarea: Promise<unknown>) {
  const conError = tarea.catch((e) => console.error('ventanilla: aviso por correo falló', e))
  try { c.executionCtx.waitUntil(conError) } catch { /* fuera de un Worker (pruebas) */ }
}

export function texto(v: unknown, max = 2000): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}

export function entero(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}
