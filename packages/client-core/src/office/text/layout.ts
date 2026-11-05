/**
 * The text format's Y.Doc layout, kept apart from the codec so the format catalog and editors can
 * read it without loading the codec.
 *
 * - `text` (Y.Text): the content with every line break as `\n`, whatever the file uses.
 * - `textFile` (Y.Map): how the file is written back. `encoding` and `lineEnding` are the file's;
 *   `original` is set while a file with mixed line endings is unchanged, so its exact bytes return.
 *
 * Editors only ever touch `text`; the codec owns `textFile`.
 */
export const TEXT_SCHEMA_VERSION = 1
export const TEXT_FIELD = 'text'
export const TEXT_FILE_FIELD = 'textFile'

/** Largest file the text format edits; bigger files stay ordinary files. */
export const TEXT_MAX_FILE_BYTES = 4_000_000

/**
 * Extensions that open as text. Markdown (`md`, `markdown`) is its own format, sheets own `csv` and
 * `tsv`, notebooks own `ipynb`, and SVG previews as an image.
 */
export const TEXT_EXTENSIONS = [
  'txt', 'text', 'log',
  // Data and configuration
  'json', 'jsonc', 'json5', 'jsonl', 'ndjson', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties', 'xml', 'plist',
  // Web
  'html', 'htm', 'css', 'scss', 'sass', 'less', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'vue', 'svelte', 'graphql', 'gql',
  // Languages
  'py', 'pyi', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'scala', 'swift', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'hxx', 'm', 'mm',
  'cs', 'fs', 'php', 'pl', 'pm', 'lua', 'r', 'jl', 'dart', 'ex', 'exs', 'erl', 'hs', 'clj', 'elm', 'groovy', 'gradle', 'zig', 'nim',
  // Shell and build
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'mk', 'cmake', 'dockerfile', 'tf', 'hcl', 'nix',
  // Queries, schemas, and docs
  'sql', 'proto', 'prisma', 'tex', 'bib', 'rst', 'adoc', 'org', 'diff', 'patch', 'srt', 'vtt',
] as const

/** Names without an extension (or dotfiles) that are text, compared lower-case. */
export const TEXT_FILE_NAMES = [
  'dockerfile', 'makefile', 'gemfile', 'rakefile', 'procfile', 'license', 'readme', 'changelog',
  '.gitignore', '.gitattributes', '.dockerignore', '.editorconfig', '.env', '.npmrc', '.nvmrc', '.prettierrc', '.eslintrc', '.babelrc',
] as const

const TEXT_MIME_TYPES: Record<string, string> = {
  json: 'application/json',
  jsonc: 'application/json',
  json5: 'application/json5',
  jsonl: 'application/x-ndjson',
  ndjson: 'application/x-ndjson',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  toml: 'application/toml',
  xml: 'application/xml',
  plist: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  jsx: 'text/javascript',
  ts: 'text/typescript',
  mts: 'text/typescript',
  cts: 'text/typescript',
  tsx: 'text/typescript',
  py: 'text/x-python',
  sh: 'application/x-sh',
  sql: 'application/sql',
  diff: 'text/x-diff',
  patch: 'text/x-diff',
  vtt: 'text/vtt',
}

export function textMimeType(extension: string): string {
  return TEXT_MIME_TYPES[extension.toLowerCase()] ?? 'text/plain'
}
