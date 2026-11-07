export type Formato = 'epub' | 'pdf'

export interface EntradaIndice {
  etiqueta: string
  pagina: number // desde 1
  nivel: number
}

// manifiesto.json de cada obra en R2 (docs/api.md). titulo y autor son extras que el panel usa para prellenar la ficha.
export interface Manifiesto {
  formato: Formato
  tipo_pagina: 'webp' | 'html'
  total_paginas: number
  ancho?: number // tamaño de las páginas de PDF, para reservar espacio antes de que lleguen
  alto?: number
  indice: EntradaIndice[]
  titulo?: string
  autor?: string
}

export type TipoAcceso = 'compra' | 'alquiler' | 'suscripcion' | 'canje' | 'cortesia' | 'muestra'

export interface Obra {
  id: string
  titulo: string
  autor: string
  formato: Formato
  portada_url: string | null
  color: string | null
  acceso: TipoAcceso
  vence_en: string | null // alquiler o suscripción
  paginas_muestra: number | null // solo si acceso = muestra
}

export type Pagina =
  | { tipo: 'html'; html: string }
  | { tipo: 'imagen'; imagen: Blob }

export interface Progreso {
  pagina: number
  porcentaje: number
}

export interface Marcador {
  id: string
  pagina: number
  etiqueta: string
  creado_en: string
}

// Un subrayado se ubica por página, bloque (párrafo) y posición de los caracteres dentro del bloque.
export interface Subrayado {
  id: string
  pagina: number
  bloque: number
  inicio: number
  fin: number
  texto: string
  nota: string
  creado_en: string
}

export interface Dispositivo {
  id: string
  nombre: string
  plataforma: string
  ultimo_uso: string
}

export interface Usuario {
  correo: string
}

export type Tema = 'claro' | 'sepia' | 'noche'
export type Fuente = 'serif' | 'sans'

export interface Preferencias {
  tema: Tema
  tamano: number
  fuente: Fuente
}
