export type Rol = 'lector' | 'ministerio' | 'editor' | 'admin'

export interface Usuario {
  id: string
  correo: string
  nombre: string | null
  telefono: string | null
  rol: Rol
}

export interface Env {
  DB: D1Database
  ARCHIVOS: R2Bucket
  EMAIL?: SendEmail
  // Variables
  SITIO_URL: string
  CORREO_REMITENTE: string
  CORREO_PROVEEDOR: string
  ADMIN_CORREOS: string
  WHATSAPP_WORKER_URL: string
  PAYPAL_MODO: string
  ASISTENTE_MODELO: string
  PAGES_DEPLOY_HOOK?: string
  // Secretos
  LLAVE_MAESTRA: string
  INTERNAL_TOKEN?: string
  RECURRENTE_PUBLIC_KEY?: string
  RECURRENTE_SECRET_KEY?: string
  RECURRENTE_WEBHOOK_SECRET?: string
  PAYPAL_CLIENT_ID?: string
  PAYPAL_SECRET?: string
  PAYPAL_WEBHOOK_ID?: string
  ANTHROPIC_API_KEY?: string
  RESEND_API_KEY?: string
}

export interface Variables {
  usuario: Usuario | null
  dispositivoId: string | null
  sesionHash: string | null
}

export type App = { Bindings: Env; Variables: Variables }
