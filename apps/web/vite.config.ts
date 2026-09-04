import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/v1': 'http://127.0.0.1:3000',
      '/health': 'http://127.0.0.1:3000',
      '/socket.io': {
        target: 'ws://127.0.0.1:3000',
        ws: true,
      },
      '/notes-collaboration': {
        target: 'ws://127.0.0.1:3000',
        ws: true,
      },
    },
  },
})
