// The inputs each editor bundle is built from, and their combined hash. The build script records
// the hash in the generated module; a test fails when it no longer matches, so a changed editor,
// schema, or dependency cannot ship with a stale bundle.
//
// Each live format with a mobile editor has an entry in EDITOR_BUNDLES: its page (editor/…), the
// sources and packages it bundles, and the generated module it is written to.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const repositoryRoot = resolve(mobileRoot, '../..')
export const clientCoreSource = join(repositoryRoot, 'packages/client-core/src')

const editorRoot = join(mobileRoot, 'editor')
const generated = (name) => join(mobileRoot, 'src/features/files/editor', name)

/** Shared by every page: the bridge protocol and its helpers, and this build. */
const COMMON_FILES = [
  join(mobileRoot, 'src/features/files/editor/protocol.ts'),
  join(mobileRoot, 'src/features/files/editor/base64.ts'),
  join(mobileRoot, 'scripts/build-doc-editor.mjs'),
  join(mobileRoot, 'scripts/doc-editor-inputs.mjs'),
]
const SYNC_PACKAGES = 'yjs|y-protocols|lib0'

export const EDITOR_BUNDLES = {
  markdown: {
    root: editorRoot,
    entry: 'main.ts',
    output: generated('editorBundle.generated.ts'),
    exportName: 'EDITOR_BUNDLE',
    schemaVersion: { file: join(clientCoreSource, 'doc-schema/version.ts'), pattern: /DOC_SCHEMA_VERSION = (\d+)/ },
    sources: [
      join(editorRoot, 'main.ts'), join(editorRoot, 'index.html'), join(editorRoot, 'editor.css'),
      join(clientCoreSource, 'doc-editor'), join(clientCoreSource, 'doc-schema'),
    ],
    packages: new RegExp(`^node_modules/(@tiptap/[^/]+|prosemirror-[^/]+|${SYNC_PACKAGES}|marked|linkifyjs|orderedmap|rope-sequence|w3c-keyname)$`),
  },
  text: {
    root: join(editorRoot, 'text'),
    entry: 'main.ts',
    output: generated('textEditorBundle.generated.ts'),
    exportName: 'TEXT_EDITOR_BUNDLE',
    schemaVersion: { file: join(clientCoreSource, 'office/text/layout.ts'), pattern: /TEXT_SCHEMA_VERSION = (\d+)/ },
    sources: [
      join(editorRoot, 'text'),
      join(clientCoreSource, 'office/text'), join(clientCoreSource, 'office/formats.ts'), join(clientCoreSource, 'office/assets.ts'),
      join(clientCoreSource, 'office/live-format.ts'), join(clientCoreSource, 'doc-schema/version.ts'),
    ],
    packages: new RegExp(`^node_modules/(@codemirror/[^/]+|@lezer/[^/]+|y-codemirror\\.next|${SYNC_PACKAGES}|style-mod|crelt|w3c-keyname|@marijn/find-cluster-break)$`),
  },
  notebook: {
    root: join(editorRoot, 'notebook'),
    entry: 'main.ts',
    output: generated('notebookEditorBundle.generated.ts'),
    exportName: 'NOTEBOOK_EDITOR_BUNDLE',
    schemaVersion: { file: join(clientCoreSource, 'office/notebook/layout.ts'), pattern: /NOTEBOOK_SCHEMA_VERSION = (\d+)/ },
    sources: [
      join(editorRoot, 'notebook'),
      join(clientCoreSource, 'office/notebook'), join(clientCoreSource, 'office/text'), join(clientCoreSource, 'office/formats.ts'),
      join(clientCoreSource, 'office/assets.ts'), join(clientCoreSource, 'office/live-format.ts'), join(clientCoreSource, 'office/index.ts'),
      join(clientCoreSource, 'office/markdown'), join(clientCoreSource, 'highlight.ts'), join(clientCoreSource, 'markdown.ts'),
      join(clientCoreSource, 'files/markdown-diff.ts'), join(clientCoreSource, 'doc-schema/version.ts'),
    ],
    packages: new RegExp(`^node_modules/(@codemirror/[^/]+|@lezer/[^/]+|y-codemirror\\.next|${SYNC_PACKAGES}|style-mod|crelt|w3c-keyname|@marijn/find-cluster-break|marked|lowlight|highlight\\.js)$`),
  },
  presentation: {
    root: join(editorRoot, 'presentation'),
    entry: 'main.ts',
    output: generated('presentationEditorBundle.generated.ts'),
    exportName: 'PRESENTATION_EDITOR_BUNDLE',
    // Deck pictures and media are object URLs the page makes from bytes the app hands it.
    blobMedia: true,
    schemaVersion: { file: join(clientCoreSource, 'office/presentation/layout.ts'), pattern: /PRESENTATION_SCHEMA_VERSION = (\d+)/ },
    sources: [
      join(editorRoot, 'presentation'),
      join(clientCoreSource, 'office/presentation'), join(clientCoreSource, 'office/ooxml'), join(clientCoreSource, 'office/assets.ts'),
      join(clientCoreSource, 'office/live-format.ts'),
    ],
    packages: new RegExp(`^node_modules/(@tiptap/(pm|y-tiptap)|prosemirror-[^/]+|${SYNC_PACKAGES}|fflate|@xmldom/xmldom|orderedmap|rope-sequence|w3c-keyname)$`),
  },
  document: {
    root: join(editorRoot, 'docx'),
    entry: 'main.ts',
    blobMedia: true,
    output: generated('docxEditorBundle.generated.ts'),
    exportName: 'DOCX_EDITOR_BUNDLE',
    schemaVersion: { file: join(clientCoreSource, 'office/docx/format.ts'), pattern: /DOCX_SCHEMA_VERSION = (\d+)/ },
    sources: [
      join(editorRoot, 'docx'),
      join(clientCoreSource, 'office/docx'), join(clientCoreSource, 'office/ooxml'), join(clientCoreSource, 'office/formats.ts'),
      join(clientCoreSource, 'office/assets.ts'), join(clientCoreSource, 'office/index.ts'), join(clientCoreSource, 'office/live-format.ts'),
      join(clientCoreSource, 'doc-schema/version.ts'), join(clientCoreSource, 'office/text/layout.ts'),
    ],
    packages: new RegExp(`^node_modules/(@tiptap/(pm|y-tiptap)|prosemirror-[^/]+|${SYNC_PACKAGES}|orderedmap|rope-sequence|w3c-keyname|fflate|@xmldom/xmldom)$`),
  },
  sheet: {
    root: join(editorRoot, 'sheet'),
    entry: 'main.ts',
    output: generated('sheetEditorBundle.generated.ts'),
    exportName: 'SHEET_EDITOR_BUNDLE',
    schemaVersion: { file: join(clientCoreSource, 'office/sheets/layout.ts'), pattern: /SHEETS_SCHEMA_VERSION = (\d+)/ },
    sources: [
      join(editorRoot, 'sheet'),
      // The whole sheets tree (the view, model, formula engine, number formats, and charts it renders)
      // and the OOXML helpers its styles and charts read themes with.
      join(clientCoreSource, 'office/sheets'), join(clientCoreSource, 'office/ooxml'),
      join(clientCoreSource, 'office/formats.ts'), join(clientCoreSource, 'office/assets.ts'),
      join(clientCoreSource, 'office/live-format.ts'), join(clientCoreSource, 'doc-schema/version.ts'),
    ],
    packages: new RegExp(`^node_modules/(${SYNC_PACKAGES}|@xmldom/xmldom|fflate)$`),
  },
}

function walk(path) {
  if (!statSync(path).isDirectory()) return [path]
  return readdirSync(path).flatMap((name) => {
    const child = join(path, name)
    if (statSync(child).isDirectory()) return walk(child)
    return /\.test\.|\.test\.helpers\./.test(name) ? [] : [child]
  })
}

export function editorInputHash(format) {
  const spec = EDITOR_BUNDLES[format]
  const hash = createHash('sha256')
  const files = [...new Set([...spec.sources.flatMap(walk), ...COMMON_FILES])].sort()
  for (const file of files) {
    hash.update(relative(repositoryRoot, file))
    hash.update('\0')
    hash.update(readFileSync(file))
    hash.update('\0')
  }
  const lock = JSON.parse(readFileSync(join(repositoryRoot, 'package-lock.json'), 'utf8'))
  const versions = Object.entries(lock.packages)
    .filter(([path]) => spec.packages.test(path))
    .map(([path, entry]) => `${path}@${entry.version}`)
    .sort()
  hash.update(versions.join('\n'))
  return hash.digest('hex')
}

/** The Markdown editor's hash, as before other formats had editors. */
export function docEditorInputHash() {
  return editorInputHash('markdown')
}
