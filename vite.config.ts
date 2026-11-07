import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// base relativa para que el mismo build sirva en la web y dentro de Capacitor.
// Dos entradas: el lector (index.html) y la ventanilla con los paneles (panel.html).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      input: { lector: fileURLToPath(new URL('./index.html', import.meta.url)), panel: fileURLToPath(new URL('./panel.html', import.meta.url)) },
    },
  },
  // En desarrollo, /api va al Worker local (cd worker && npm run dev).
  server: { proxy: { '/api': 'http://localhost:8787' } },
})
