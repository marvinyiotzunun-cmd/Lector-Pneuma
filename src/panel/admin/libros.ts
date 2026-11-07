// Forma de un libro en /api/admin/libros (backend). Dinero en quetzales en la API.
export interface LibroAdmin {
  id: string; slug: string; titulo: string; autor: string; ministerio: string | null; sinopsis: string | null
  isbn: string | null; paginas: number | null; categoria: string | null; color: string | null
  impreso: number | boolean; precio_impreso_gtq: number | null; existencias: number | null
  formato_digital: 'epub' | 'pdf' | null; digital_activo: number | boolean
  precio_compra_gtq: number | null; precio_alquiler_gtq: number | null; dias_alquiler: number
  en_suscripcion: number | boolean; paginas_muestra: number; total_paginas_digital: number | null
  url_amazon: string | null; url_google_play: string | null; publicado: number | boolean; orden: number
  portada_url?: string | null; creado_en: string; actualizado_en: string
}

export const siNo = (v: unknown) => v === true || v === 1 || v === '1'
