import { defineConfig } from 'vitest/config'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import path from 'node:path'

export default defineConfig(async () => {
  const migraciones = await readD1Migrations(path.join(import.meta.dirname, 'migrations'))
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: {
            MIGRACIONES: migraciones,
            LLAVE_MAESTRA: 'llave-de-pruebas-llave-de-pruebas-0123456789',
            INTERNAL_TOKEN: 'token-interno-pruebas',
            ADMIN_CORREOS: 'admin@pneuma.gt',
            SITIO_URL: 'https://pneuma.test',
          },
        },
      }),
    ],
    test: { setupFiles: ['./test/preparar.ts'] },
  }
})
