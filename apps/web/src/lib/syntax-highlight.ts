import type { Root } from 'hast'
import { common, createLowlight } from 'lowlight'
import type { CodePreviewKind } from './code-preview'

const lowlight = createLowlight(common)

/** Larger inputs render as plain text so huge previews stay responsive. */
export const MAX_HIGHLIGHT_CHARACTERS = 100_000
/** Guessing runs every candidate grammar, so it gets a tighter budget. */
export const MAX_AUTO_HIGHLIGHT_CHARACTERS = 20_000
const MIN_AUTO_RELEVANCE = 5

const AUTO_DETECT_SUBSET = [
  'bash', 'c', 'cpp', 'csharp', 'css', 'go', 'java', 'javascript', 'json', 'kotlin', 'php',
  'python', 'ruby', 'rust', 'sql', 'swift', 'typescript', 'xml', 'yaml',
]

// Fence tags models commonly emit that highlight.js doesn't know as aliases.
const LANGUAGE_ALIASES: Record<string, string> = {
  react: 'javascript',
  vue: 'xml',
  'objective-c': 'objectivec',
  jsonc: 'json',
  json5: 'json',
  console: 'bash',
  shellscript: 'bash',
  golang: 'go',
  'c#': 'csharp',
  toml: 'ini',
  kts: 'kotlin',
}

const PLAIN_LANGUAGES = new Set(['text', 'txt', 'plain', 'plaintext', 'log'])

const EXTENSION_LANGUAGES: Record<string, string> = {
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp',
  cs: 'csharp', css: 'css', scss: 'scss', less: 'less', go: 'go', java: 'java',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript',
  json: 'json', kt: 'kotlin', kts: 'kotlin', lua: 'lua', php: 'php', py: 'python',
  rb: 'ruby', rs: 'rust', sh: 'bash', bash: 'bash', zsh: 'bash', sql: 'sql',
  swift: 'swift', toml: 'ini', ini: 'ini', html: 'xml', htm: 'xml', xml: 'xml',
  svg: 'xml', vue: 'xml', yaml: 'yaml', yml: 'yaml', md: 'markdown', diff: 'diff',
  patch: 'diff', graphql: 'graphql', gql: 'graphql', r: 'r', pl: 'perl', m: 'objectivec',
}

const MIME_LANGUAGES: Record<string, string> = {
  'application/json': 'json',
  'text/javascript': 'javascript',
  'application/javascript': 'javascript',
  'text/css': 'css',
  'text/html': 'xml',
  'text/xml': 'xml',
  'application/xml': 'xml',
  'image/svg+xml': 'xml',
  'application/yaml': 'yaml',
  'text/yaml': 'yaml',
  'text/x-python': 'python',
  'application/x-sh': 'bash',
  'application/sql': 'sql',
}

/** Maps a fence tag to a registered grammar name or alias, or null for plain text. */
export function normalizeLanguage(tag: string | null | undefined): string | null {
  const normalized = tag?.trim().toLowerCase()
  if (!normalized || PLAIN_LANGUAGES.has(normalized)) return null
  const language = LANGUAGE_ALIASES[normalized] ?? normalized
  return lowlight.registered(language) ? language : null
}

export function languageForFile(name: string, mimeType = ''): string | null {
  const extension = name.trim().toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1]
  if (extension && EXTENSION_LANGUAGES[extension]) return EXTENSION_LANGUAGES[extension]
  const mime = mimeType.toLowerCase().split(';')[0].trim()
  return MIME_LANGUAGES[mime] ?? (mime.endsWith('+json') ? 'json' : mime.endsWith('+xml') ? 'xml' : null)
}

export function languageForPreviewKind(kind: CodePreviewKind): string {
  return kind === 'jsx' ? 'javascript' : 'xml'
}

/**
 * Tokenizes code into a hast tree of `hljs-*` spans. `language` is a fence tag or grammar name;
 * `undefined` guesses the language, `null` means plain text. Returns null when there is nothing
 * worth colouring so callers can render the raw string.
 */
export function highlightTree(code: string, language?: string | null): Root | null {
  if (!code || code.length > MAX_HIGHLIGHT_CHARACTERS || language === null) return null
  try {
    const grammar = normalizeLanguage(language)
    if (grammar) return lowlight.highlight(grammar, code)
    if (language?.trim() || code.length > MAX_AUTO_HIGHLIGHT_CHARACTERS) return null
    const tree = lowlight.highlightAuto(code, { subset: AUTO_DETECT_SUBSET })
    return (tree.data?.relevance ?? 0) >= MIN_AUTO_RELEVANCE ? tree : null
  } catch {
    return null
  }
}
