import type { EntradaIndice, Preferencias, Subrayado } from '../lib/tipos'

export interface Posicion {
  ubicacion: string
  porcentaje: number
  etiqueta: string // capítulo o página, para mostrar al lector
  pagina?: string // "3 de 12" cuando se conoce
}

export interface Seleccion {
  ubicacion: string
  texto: string
  x: number
  y: number
}

export interface PropsMotor {
  archivo: ArrayBuffer
  ubicacionInicial: string | null
  preferencias: Preferencias
  subrayados: Subrayado[]
  onPosicion: (p: Posicion) => void
  onIndice: (indice: EntradaIndice[]) => void
  onSeleccion: (s: Seleccion | null) => void
  onAbrirSubrayado: (id: string) => void
}

export interface Motor {
  siguiente(): void
  anterior(): void
  ir(ubicacion: string): void
  irPorcentaje(porcentaje: number): void
}

export const COLORES_TEMA = {
  claro: { fondo: '#FFFFFF', texto: '#22262E', subrayado: 'rgba(250, 214, 92, 0.55)' },
  sepia: { fondo: '#F4ECD8', texto: '#3B3024', subrayado: 'rgba(214, 167, 52, 0.45)' },
  noche: { fondo: '#111317', texto: '#C9CCD2', subrayado: 'rgba(160, 130, 40, 0.55)' },
} as const

export const FUENTES = {
  serif: '"Literata", Georgia, "Times New Roman", serif',
  sans: '"Figtree", system-ui, -apple-system, "Segoe UI", sans-serif',
} as const
