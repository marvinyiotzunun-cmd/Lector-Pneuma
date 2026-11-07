import { applyD1Migrations, env, type D1Migration } from 'cloudflare:test'

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database
      ARCHIVOS: R2Bucket
      MIGRACIONES: D1Migration[]
      LLAVE_MAESTRA: string
      INTERNAL_TOKEN: string
    }
  }
}

await applyD1Migrations(env.DB, env.MIGRACIONES)
