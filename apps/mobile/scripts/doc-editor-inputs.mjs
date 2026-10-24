// The inputs the document editor bundle is built from, and their combined hash. The build
// script records the hash in the generated module; a test fails when it no longer matches, so
// a changed editor, schema, or dependency cannot ship with a stale bundle.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const repositoryRoot = resolve(mobileRoot, '../..')
export const clientCoreSource = join(repositoryRoot, 'packages/client-core/src')

const SOURCE_DIRECTORIES = [
  join(mobileRoot, 'editor'),
  join(clientCoreSource, 'doc-editor'),
  join(clientCoreSource, 'doc-schema'),
]
const SOURCE_FILES = [
  join(mobileRoot, 'src/features/files/editor/protocol.ts'),
  join(mobileRoot, 'src/features/files/editor/base64.ts'),
  join(mobileRoot, 'scripts/build-doc-editor.mjs'),
]
/** Packages bundled into the editor; their installed versions are part of the hash. */
const BUNDLED_PACKAGES = /^node_modules\/(@tiptap\/[^/]+|prosemirror-[^/]+|yjs|y-protocols|lib0|marked|linkifyjs|orderedmap|rope-sequence|w3c-keyname)$/

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return walk(path)
    return /\.test\.|\.test\.helpers\./.test(name) ? [] : [path]
  })
}

export function docEditorInputHash() {
  const hash = createHash('sha256')
  const files = [...SOURCE_DIRECTORIES.flatMap(walk), ...SOURCE_FILES].sort()
  for (const file of files) {
    hash.update(relative(repositoryRoot, file))
    hash.update('\0')
    hash.update(readFileSync(file))
    hash.update('\0')
  }
  const lock = JSON.parse(readFileSync(join(repositoryRoot, 'package-lock.json'), 'utf8'))
  const versions = Object.entries(lock.packages)
    .filter(([path]) => BUNDLED_PACKAGES.test(path))
    .map(([path, entry]) => `${path}@${entry.version}`)
    .sort()
  hash.update(versions.join('\n'))
  return hash.digest('hex')
}
