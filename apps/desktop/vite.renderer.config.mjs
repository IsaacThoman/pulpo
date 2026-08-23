import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  publicDir: '../web/public',
  resolve: {
    alias: { '@': new URL('../web/src', import.meta.url).pathname },
  },
  server: {
    port: 5174,
    strictPort: true,
  },
})
