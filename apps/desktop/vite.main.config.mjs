import { defineConfig } from 'vite'
import { rgPath } from '@vscode/ripgrep'

export default defineConfig({
  define: { PULPO_DEVELOPMENT_RG_PATH: JSON.stringify(rgPath) },
  build: { sourcemap: true },
})
