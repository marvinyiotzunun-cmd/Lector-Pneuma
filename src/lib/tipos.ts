export type Formato = 'epub' | 'pdf'

export interface Libro {
  id: string
  titulo: string
  autor: string
  descripcion: string | null
  formato: Formato
  archivo_ruta: string
  portada_ruta: string | null
  color: string | null
}

// "ubicacion" es un CFI en EPUB y el número de página en PDF.
export interface Progreso {
  ubicacion: string
  porcentaje: number
}

export interface Marcador {
  id: string
  ubicacion: string
  etiqueta: string
  creado_en: string
}

export interface Subrayado {
  id: string
  ubicacion: string
  texto: string
  nota: string
  creado_en: string
}

export interface EntradaIndice {
  etiqueta: string
  ubicacion: string
  nivel: number
}

export type Tema = 'claro' | 'sepia' | 'noche'
export type Fuente = 'serif' | 'sans'

export interface Preferencias {
  tema: Tema
  tamano: number
  fuente: Fuente
}
