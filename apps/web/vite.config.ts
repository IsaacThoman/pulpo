import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const apiTarget = process.env.PULPO_DEV_API_TARGET || 'http://127.0.0.1:3000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: new URL('./index.html', import.meta.url).pathname,
        // Isolated runner for code previews; loaded in an opaque-origin iframe.
        sandbox: new URL('./sandbox.html', import.meta.url).pathname,
      },
    },
  },
  server: {
    // Vite's default localhost origins, plus the opaque origin of the preview sandbox.
    cors: { origin: [/^https?:\/\/(?:(?:[^:]+\.)?localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/, 'null'] },
    proxy: {
      '/api/auth/search/authorize': { target: apiTarget, changeOrigin: false },
      '/api': apiTarget,
      '/v1': apiTarget,
      '/health': apiTarget,
      '/socket.io': {
        target: apiTarget.replace(/^http/, 'ws'),
        ws: true,
      },
    },
  },
})
