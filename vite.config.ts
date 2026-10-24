import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base relativa para que el mismo build sirva en la web y dentro de Capacitor.
export default defineConfig({
  base: './',
  plugins: [react()],
})
