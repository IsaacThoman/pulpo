import { defineConfig } from 'vite'

// The `pulpo` CLI (src/computer/pulpo-cli.ts) runs under ELECTRON_RUN_AS_NODE outside the app,
// so it gets no Electron and needs no source map.
export default defineConfig({
  build: { sourcemap: false },
})
