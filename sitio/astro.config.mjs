import { defineConfig } from 'astro/config'

// Sitio estático para Cloudflare Pages. La API vive en el mismo dominio bajo /api (Worker del backend).
export default defineConfig({
  site: process.env.SITIO_URL || 'https://pneuma.gt',
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file' },
  devToolbar: { enabled: false },
})
