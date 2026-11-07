// PROVISIONAL: lo reemplaza el archivo del backend (rama claude/project-thread-unof8l).
export interface Env {
  DB: D1Database
  ARCHIVOS: R2Bucket
  SITIO_URL: string
  CORREO_PROVEEDOR?: string
  MODO_DEMO?: string
}
export interface Usuario { id: string; correo: string; nombre: string | null; rol: 'lector' | 'ministerio' | 'editor' | 'admin' }
export interface Variables { usuario: Usuario | null; dispositivoId: string | null }
