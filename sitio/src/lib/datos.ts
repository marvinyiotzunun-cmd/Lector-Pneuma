// Fuente de datos del sitio. Al construir, si existe PNEUMA_API_URL (por ejemplo https://pneuma.gt),
// se leen el catálogo, los contenidos, las etapas y los formatos del backend; si no, los datos de ejemplo.
import librosEjemplo from '../datos/libros.json'
import etapasEjemplo from '../datos/etapas.json'
import formatosEjemplo from '../datos/formatos.json'
import contenidosEjemplo from '../datos/contenidos.json'

export type Libro = {
  id: string; slug: string; titulo: string; autor: string; ministerio: string | null; sinopsis: string | null
  isbn: string | null; paginas: number | null; categoria: string | null; portada_url: string | null
  impreso: { precio_gtq: number; disponible: boolean } | null
  digital: { formato: string; precio_compra_gtq: number | null; precio_alquiler_gtq: number | null; dias_alquiler: number | null; en_suscripcion: boolean; paginas_muestra: number } | null
  tiendas: { amazon: string | null; google_play: string | null }
}
export type Etapa = { numero: number; nombre: string; descripcion: string }
export type Formato = { id: string; nombre: string; descripcion: string; nombre_archivo: string; tipo: string; tamano_bytes: number | null; url: string }

const API = process.env.PNEUMA_API_URL?.replace(/\/$/, '')
export const usandoEjemplo = !API

async function api<T>(ruta: string, respaldo: T): Promise<T> {
  if (!API) return respaldo
  try {
    const r = await fetch(`${API}/api${ruta}`, { headers: { accept: 'application/json' } })
    if (!r.ok) throw new Error(`${r.status}`)
    return (await r.json()) as T
  } catch (e) {
    console.warn(`[datos] ${ruta} no respondió (${e}); uso datos de ejemplo.`)
    return respaldo
  }
}

let cacheLibros: Promise<Libro[]> | null = null
export function libros(): Promise<Libro[]> {
  cacheLibros ??= api<Libro[] | { libros: Libro[] }>('/catalogo', librosEjemplo as Libro[]).then((r) => (Array.isArray(r) ? r : r.libros))
  return cacheLibros
}
export const etapas = () => api<Etapa[]>('/proceso/etapas', etapasEjemplo).then((e) => [...e].sort((a, b) => a.numero - b.numero))
export const formatos = () => api<Formato[]>('/formatos', formatosEjemplo as Formato[])

const contenidosLocales = contenidosEjemplo as Record<string, string>
export async function contenido(clave: string): Promise<string> {
  if (!API) return contenidosLocales[clave] ?? ''
  const r = await api<{ cuerpo?: string } | null>(`/contenidos/${clave}`, null)
  return r?.cuerpo ?? contenidosLocales[clave] ?? ''
}

export const quetzales = (n: number) => 'Q' + n.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Markdown mínimo para los contenidos editables (párrafos, negrita, cursiva, enlaces y listas).
export function markdown(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const linea = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, '<a href="$2">$1</a>')
  return md
    .trim()
    .split(/\n{2,}/)
    .map((b) => {
      if (/^#{2,3} /.test(b)) return `<h3>${linea(b.replace(/^#+ /, ''))}</h3>`
      if (/^[-*] /m.test(b)) return '<ul>' + b.split('\n').map((l) => `<li>${linea(l.replace(/^[-*] /, ''))}</li>`).join('') + '</ul>'
      return `<p>${linea(b).replace(/\n/g, '<br>')}</p>`
    })
    .join('')
}
