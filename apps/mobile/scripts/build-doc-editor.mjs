#!/usr/bin/env node
// Builds each live format's editor that runs in the app's web view (editor/ for Markdown,
// editor/<format>/ for the others) into one self-contained HTML page, and writes it into its
// generated module under src/features/files/editor/, which ships inside the JavaScript bundle.
// Run `npm run build:editor -w @pulpo/mobile` after changing an editor, the shared schemas, or
// their dependencies; a test checks every bundle is current.
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { clientCoreSource, EDITOR_BUNDLES, editorInputHash, mobileRoot } from './doc-editor-inputs.mjs'

/** A format's editor page as built from the current sources; the test compares it with the committed one. */
export async function buildEditorPage(format) {
  const spec = EDITOR_BUNDLES[format]
  const result = await build({
    configFile: false,
    root: spec.root,
    logLevel: 'warn',
    // Built from client-core's sources, so the bundle never depends on a stale dist/.
    resolve: {
      alias: [
        { find: /^@pulpo\/client-core\/doc-editor$/, replacement: join(clientCoreSource, 'doc-editor/index.ts') },
        { find: /^@pulpo\/client-core\/doc-schema$/, replacement: join(clientCoreSource, 'doc-schema/index.ts') },
        { find: /^@pulpo\/client-core\/office\/text$/, replacement: join(clientCoreSource, 'office/text/index.ts') },
        { find: /^@pulpo\/client-core\/office\/text\/view$/, replacement: join(clientCoreSource, 'office/text/view/index.ts') },
        { find: /^@pulpo\/client-core\/office\/presentation$/, replacement: join(clientCoreSource, 'office/presentation/index.ts') },
        { find: /^@pulpo\/client-core\/office\/presentation\/view$/, replacement: join(clientCoreSource, 'office/presentation/view/index.ts') },
        { find: /^@pulpo\/client-core\/office$/, replacement: join(clientCoreSource, 'office/index.ts') },
      ],
    },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      write: false,
      target: ['safari17', 'chrome110'],
      minify: true,
      cssCodeSplit: false,
      sourcemap: false,
      // An IIFE is one script: languages the web loads on demand are inlined here.
      lib: { entry: join(spec.root, spec.entry), formats: ['iife'], name: 'PulpoDocEditor', fileName: () => 'editor.js' },
    },
  })

  const outputs = (Array.isArray(result) ? result : [result]).flatMap((entry) => entry.output)
  const script = outputs.find((item) => item.type === 'chunk')?.code
  const style = outputs.find((item) => item.type === 'asset' && item.fileName.endsWith('.css'))?.source
  if (!script || style === undefined) throw new Error('The editor build produced no script or stylesheet')
  // `</script` inside the bundle would end the inline script early.
  const safeScript = script.replace(/<\/(script)/gi, '<\\/$1')
  const scriptHash = createHash('sha256').update(safeScript).digest('base64')
  // Nothing loads from anywhere: the editor's only input is the bridge.
  const csp = [
    "default-src 'none'",
    `script-src 'sha256-${scriptHash}'`,
    "style-src 'unsafe-inline'",
    'img-src data:',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
  const template = readFileSync(join(spec.root, 'index.html'), 'utf8')
  const entry = `<script type="module" src="./${spec.entry}"></script>`
  if (!template.includes(entry) || !template.includes('%CSP%')) throw new Error('The editor template no longer matches the build script')
  // Function replacements: the bundle contains `$` sequences that string replacements would expand.
  const html = template
    .replace('%CSP%', () => csp)
    .replace(entry, () => `<style>${String(style)}</style>\n<script>${safeScript}</script>`)

  const schemaVersion = Number(spec.schemaVersion.pattern.exec(readFileSync(spec.schemaVersion.file, 'utf8'))?.[1])
  const protocolVersion = Number(/EDITOR_PROTOCOL_VERSION = (\d+)/.exec(readFileSync(join(mobileRoot, 'src/features/files/editor/protocol.ts'), 'utf8'))?.[1])
  if (!schemaVersion || !protocolVersion) throw new Error('Could not read the schema or protocol version')
  return { html, schemaVersion, protocolVersion }
}

/** The Markdown editor page, as the bundle test has always built it. */
export function buildDocEditorPage() {
  return buildEditorPage('markdown')
}

// Run as a script (not imported by the test): write the modules, or only the formats named.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const formats = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(EDITOR_BUNDLES)
  for (const format of formats) {
    const spec = EDITOR_BUNDLES[format]
    if (!spec) throw new Error(`No editor bundle for ${format}`)
    const { html, schemaVersion, protocolVersion } = await buildEditorPage(format)
    writeFileSync(spec.output, `// Generated by scripts/build-doc-editor.mjs from ${format === 'markdown' ? 'editor/' : `editor/${format}/`} and @pulpo/client-core. Do not edit.
export const ${spec.exportName} = {
  format: '${format}',
  schemaVersion: ${schemaVersion},
  protocolVersion: ${protocolVersion},
  inputHash: '${editorInputHash(format)}',
  html: ${JSON.stringify(html)},
} as const
`)
    console.log(`Wrote ${spec.output} (${Math.round(html.length / 1024)} KiB)`)
  }
}
