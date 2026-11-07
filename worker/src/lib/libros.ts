import type { Env } from '../env'
import { aGtq } from './util'

export interface FilaLibro {
  id: string
  slug: string
  titulo: string
  autor: string
  ministerio: string | null
  sinopsis: string | null
  isbn: string | null
  paginas: number | null
  portada_clave: string | null
  color: string | null
  categoria: string | null
  impreso: number
  precio_impreso_centavos: number | null
  existencias: number | null
  formato_digital: 'epub' | 'pdf' | null
  digital_activo: number
  precio_compra_centavos: number | null
  precio_alquiler_centavos: number | null
  dias_alquiler: number
  en_suscripcion: number
  paginas_muestra: number
  total_paginas_digital: number | null
  url_amazon: string | null
  url_google_play: string | null
  publicado: number
  orden: number
  creado_en: string
  actualizado_en: string
}

export function apiUrl(env: Env, ruta: string) {
  return `${env.SITIO_URL}/api${ruta}`
}

/** Representación pública de un libro (catálogo, WhatsApp, tienda). */
export function libroPublico(env: Env, l: FilaLibro) {
  const digital = l.digital_activo && l.formato_digital
  return {
    id: l.id,
    slug: l.slug,
    titulo: l.titulo,
    autor: l.autor,
    ministerio: l.ministerio,
    sinopsis: l.sinopsis,
    isbn: l.isbn,
    paginas: l.paginas,
    categoria: l.categoria,
    color: l.color,
    portada_url: l.portada_clave ? apiUrl(env, `/portadas/${l.id}`) : null,
    ficha_url: `${env.SITIO_URL}/libros/${l.slug}`,
    impreso:
      l.impreso && l.precio_impreso_centavos != null
        ? { precio_gtq: aGtq(l.precio_impreso_centavos), disponible: l.existencias == null || l.existencias > 0 }
        : null,
    digital: digital
      ? {
          formato: l.formato_digital,
          precio_compra_gtq: aGtq(l.precio_compra_centavos),
          precio_alquiler_gtq: aGtq(l.precio_alquiler_centavos),
          dias_alquiler: l.dias_alquiler,
          en_suscripcion: !!l.en_suscripcion,
          paginas_muestra: l.paginas_muestra,
          total_paginas: l.total_paginas_digital,
        }
      : null,
    tiendas: { amazon: l.url_amazon, google_play: l.url_google_play },
  }
}

export async function libroPorId(env: Env, id: string): Promise<FilaLibro | null> {
  return env.DB.prepare('SELECT * FROM libros WHERE id = ?').bind(id).first<FilaLibro>()
}
