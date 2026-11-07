// Cliente de la API del Worker para la ventanilla y los paneles. La sesión viaja en la cookie pneuma_sesion.
export type Rol = 'lector' | 'ministerio' | 'editor' | 'admin'
export interface Usuario { id: string; correo: string; nombre: string | null; rol: Rol }
export interface Ministerio { id: string; nombre: string; siglas: string | null }

export type Estado = 'en_curso' | 'requiere_cambios' | 'en_pausa' | 'rechazado' | 'publicado'
export const NOMBRE_ESTADO: Record<Estado, string> = {
  en_curso: 'En curso',
  requiere_cambios: 'Requiere cambios',
  en_pausa: 'En pausa',
  rechazado: 'No aprobada',
  publicado: 'Publicada',
}

// Resultados del dictamen y modalidades de revisión (Manual General Administrativo).
export type Dictamen = 'aprobada' | 'aprobada_con_cambios' | 'devuelta' | 'no_aprobada'
export const NOMBRE_DICTAMEN: Record<Dictamen, string> = {
  aprobada: 'Aprobada', aprobada_con_cambios: 'Aprobada con cambios', devuelta: 'Devuelta para reelaboración', no_aprobada: 'No aprobada',
}
export const REVISION: Record<string, string> = {
  A: 'A · Revisión por capas', B: 'B · Revisión por áreas', C: 'C · Revisión por ejes', D: 'D · Revisión por tipo de corrección',
  E: 'E · Revisión por especialista o lector', F: 'F · Revisión por segmentos y por fases',
}

export interface Etapa { numero: number; nombre: string; descripcion: string; responsable: string | null; dias_estimados: number | null; publica: number }

export interface Expediente {
  id: string; codigo: string; ministerio_id: string; ministerio: string; solicitante_id: string
  titulo: string; subtitulo: string | null; autores: string; genero: string | null; publico: string | null
  sinopsis: string; semblanza_autor: string | null; dictamen: Dictamen | null; paginas_aprox: number | null; modalidad: 'impreso' | 'digital' | 'ambos'; tiraje_estimado: number | null
  revision: string | null; etapa: number; etapa_nombre: string; estado: Estado
  responsable_id: string | null; responsable?: string | null; libro_id: string | null
  creado_en: string; actualizado_en: string; dias_en_etapa?: number; dias_estimados?: number | null
}

export interface Movimiento {
  id: string; tipo: 'creado' | 'etapa' | 'estado' | 'nota' | 'documento'
  etapa_anterior: number | null; etapa_nueva: number | null; estado_nuevo: Estado | null; nota: string | null
  visible_ministerio: number; correo_enviado: number; autor: string | null; creado_en: string
}

export interface Documento { id: string; tipo: string; nombre: string; tipo_mime: string | null; tamano: number; creado_en: string; subido_por?: string | null }

export interface ExpedienteDetalle extends Expediente {
  historial: Movimiento[]; documentos: Documento[]
  solicitante?: { id: string; nombre: string | null; correo: string; telefono: string | null } | null
}

export const TIPO_DOCUMENTO: Record<string, string> = {
  manuscrito: 'Manuscrito', indice: 'Índice', curriculum: 'Currículum del autor', declaracion: 'Declaración de originalidad y uso de IA',
  carta_autorizacion: 'Carta de Autorización', creditos: 'Formato de Créditos', permisos: 'Permisos de terceros',
  foto_autor: 'Fotografía del autor', dictamen: 'Dictamen', portada: 'Propuesta de portada', pruebas: 'Pruebas', otro: 'Otro documento',
}

export class ErrorApi extends Error {
  estado: number
  codigo: string
  datos: unknown
  constructor(estado: number, codigo: string, mensaje: string, datos?: unknown) {
    super(mensaje)
    this.estado = estado
    this.codigo = codigo
    this.datos = datos
  }
}

/** Llama a la API. `cuerpo` puede ser un objeto (va como JSON), FormData o Blob. */
export async function api<T = unknown>(ruta: string, opciones: { metodo?: string; cuerpo?: unknown; tipo?: string } = {}): Promise<T> {
  const { metodo = opciones.cuerpo === undefined ? 'GET' : 'POST', cuerpo } = opciones
  const headers: Record<string, string> = {}
  let body: BodyInit | undefined
  if (cuerpo instanceof FormData || cuerpo instanceof Blob) {
    body = cuerpo
    if (cuerpo instanceof Blob && opciones.tipo) headers['Content-Type'] = opciones.tipo
  } else if (cuerpo !== undefined) {
    body = JSON.stringify(cuerpo)
    headers['Content-Type'] = 'application/json'
  }
  let r: Response
  try {
    r = await fetch(`/api${ruta}`, { method: metodo, body, headers, credentials: 'include' })
  } catch {
    throw new ErrorApi(0, 'sin_conexion', 'No hay conexión con el servidor. Revise su internet e intente de nuevo.')
  }
  const esJson = r.headers.get('Content-Type')?.includes('json')
  const datos = esJson ? await r.json().catch(() => null) : null
  if (!r.ok) {
    const e = (datos as { error?: { codigo?: string; mensaje?: string } } | null)?.error
    throw new ErrorApi(r.status, e?.codigo ?? 'error', e?.mensaje ?? `El servidor respondió ${r.status}.`, datos)
  }
  return datos as T
}

/** URL de descarga para un <a href>. */
export const urlApi = (ruta: string) => `/api${ruta}`

export const fecha = (iso: string | null | undefined, conHora = false) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('es-GT', { day: 'numeric', month: 'short', year: 'numeric', ...(conHora ? { hour: '2-digit', minute: '2-digit' } : {}) })
}

export const tamano = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

export const quetzales = (n: number | null | undefined) =>
  n == null ? '—' : `Q${n.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
