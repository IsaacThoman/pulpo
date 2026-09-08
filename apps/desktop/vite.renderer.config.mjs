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
  server: {
    port: 5174,
    strictPort: true,
  },
})
