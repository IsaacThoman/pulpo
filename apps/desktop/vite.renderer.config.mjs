import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // The renderer uses an HTTPS origin and BrowserRouter. Forge's default './'
  // resolves assets under the current route after a reload (e.g. /c/assets/).
  base: '/',
  plugins: [react(), tailwindcss()],
  publicDir: '../web/public',
  resolve: {
    alias: { '@': new URL('../web/src', import.meta.url).pathname },
  },
  build: {
    rollupOptions: {
      input: {
        // Relative to Forge's renderer root.
        main_window: 'index.html',
        // Isolated runner for code previews; loaded in an opaque-origin iframe.
        sandbox: 'sandbox.html',
      },
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    // Vite's default localhost origins, plus the opaque origin of the preview sandbox.
    cors: { origin: [/^https?:\/\/(?:(?:[^:]+\.)?localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/, 'null'] },
  },
})
