import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    sourcemap: true,
    // ripgrep ships a platform binary that must stay in node_modules (and outside the asar).
    rollupOptions: { external: ['@vscode/ripgrep'] },
  },
})
