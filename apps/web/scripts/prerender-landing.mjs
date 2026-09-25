// Writes dist/landing.html: the built index.html with the signed-out landing page pre-rendered,
// served by nginx at exactly `/` so crawlers and link previews see content without JavaScript.
// Runs after `vite build` as part of `npm run build -w @pulpo/web`.
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'

const root = new URL('..', import.meta.url).pathname
// Inside the package so the SSR bundle resolves its externalized dependencies from node_modules.
const outDir = join(root, 'dist-ssr')

try {
  await build({
    root,
    logLevel: 'warn',
    build: {
      ssr: true,
      outDir,
      emptyOutDir: true,
      rollupOptions: { input: join(root, 'src/prerender.tsx'), output: { entryFileNames: 'prerender.mjs' } },
    },
  })
  const { renderLandingDocument } = await import(pathToFileURL(join(outDir, 'prerender.mjs')).href)
  const indexHtml = readFileSync(join(root, 'dist/index.html'), 'utf8')
  writeFileSync(join(root, 'dist/landing.html'), await renderLandingDocument(indexHtml))
  console.log('Pre-rendered dist/landing.html')
} finally {
  rmSync(outDir, { recursive: true, force: true })
}
