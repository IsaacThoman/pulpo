import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5175,
      strictPort: true,
      proxy: {
        '/api': {
          target: env.SEARCH_API_TARGET || 'http://127.0.0.1:3000',
          changeOrigin: false,
        },
      },
    },
  }
})
