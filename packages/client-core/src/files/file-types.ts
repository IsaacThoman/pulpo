/**
 * What Pulpo knows about file types: one table of extensions, MIME types, and families that the
 * server, web, desktop, and mobile all read. Add a format here (not in a client) so every surface
 * agrees on whether a file is text, which grammar highlights it, and which viewer or engine opens it.
 *
 * Classification trusts the extension first, then the MIME type: uploads often carry a generic or
 * wrong type (`application/octet-stream`, `text/plain` for code), while the name is what the user
 * chose and what desktop apps go by.
 */

/** The broad kind of a file, which decides how it is previewed and which engine can edit it. */
export type FileFamily =
  | 'text'
  | 'code'
  | 'markdown'
  /** CSV/TSV: text, shown as a grid. Also in the spreadsheet group. */
  | 'delimited'
  /** HTML pages, rendered only inside the opaque-origin sandbox. */
  | 'html'
  /** SVG images, which can carry scripts, so they render like HTML. */
  | 'svg'
  /** Jupyter notebooks (`.ipynb`, JSON). */
  | 'notebook'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'pdf'
  | 'image'
  | 'audio'
  | 'video'
  | 'archive'

/**
 * How an office file is stored, so converters and engines can pick one: Office Open XML (zip),
 * the binary formats before 2007, OpenDocument (zip), RTF, and Apple's iWork packages.
 */
export type OfficeContainer = 'ooxml' | 'legacy' | 'odf' | 'rtf' | 'iwork'

export interface FileType {
  family: FileFamily
  /** Lower-case extensions without the dot. */
  extensions: readonly string[]
  /** MIME types that identify the type; the first is what Pulpo stores and serves for new files. */
  mimeTypes: readonly string[]
  /** Whether the bytes are text (UTF-8 or a legacy single-byte encoding) that can be read, searched, and highlighted. */
  text: boolean
  /** The highlight.js grammar for the source, when there is one. */
  language?: string
  office?: OfficeContainer
}

const TYPES: readonly FileType[] = [
  { family: 'markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'], mimeTypes: ['text/markdown', 'text/x-markdown'], text: true, language: 'markdown' },
  { family: 'delimited', extensions: ['csv'], mimeTypes: ['text/csv', 'application/csv'], text: true },
  { family: 'delimited', extensions: ['tsv', 'tab'], mimeTypes: ['text/tab-separated-values'], text: true },
  { family: 'html', extensions: ['html', 'htm', 'xhtml'], mimeTypes: ['text/html', 'application/xhtml+xml'], text: true, language: 'xml' },
  { family: 'svg', extensions: ['svg'], mimeTypes: ['image/svg+xml'], text: true, language: 'xml' },
  { family: 'notebook', extensions: ['ipynb'], mimeTypes: ['application/x-ipynb+json'], text: true, language: 'json' },

  { family: 'text', extensions: ['txt', 'text'], mimeTypes: ['text/plain'], text: true },
  { family: 'text', extensions: ['log', 'out'], mimeTypes: ['text/plain'], text: true },
  { family: 'text', extensions: ['env', 'properties', 'conf', 'cfg'], mimeTypes: ['text/plain'], text: true, language: 'ini' },
  { family: 'text', extensions: ['rst', 'adoc', 'tex', 'bib'], mimeTypes: ['text/plain'], text: true },
  { family: 'text', extensions: ['srt', 'vtt'], mimeTypes: ['text/vtt'], text: true },

  { family: 'code', extensions: ['json', 'jsonc', 'json5', 'geojson', 'webmanifest'], mimeTypes: ['application/json'], text: true, language: 'json' },
  { family: 'code', extensions: ['jsonl', 'ndjson'], mimeTypes: ['application/jsonl', 'application/x-ndjson'], text: true, language: 'json' },
  { family: 'code', extensions: ['js', 'mjs', 'cjs', 'jsx'], mimeTypes: ['text/javascript', 'application/javascript'], text: true, language: 'javascript' },
  { family: 'code', extensions: ['ts', 'mts', 'cts', 'tsx'], mimeTypes: ['text/typescript', 'application/typescript'], text: true, language: 'typescript' },
  { family: 'code', extensions: ['css'], mimeTypes: ['text/css'], text: true, language: 'css' },
  { family: 'code', extensions: ['scss'], mimeTypes: ['text/x-scss'], text: true, language: 'scss' },
  { family: 'code', extensions: ['less'], mimeTypes: ['text/x-less'], text: true, language: 'less' },
  { family: 'code', extensions: ['vue', 'svelte'], mimeTypes: ['text/plain'], text: true, language: 'xml' },
  { family: 'code', extensions: ['xml', 'xsd', 'xsl', 'xslt', 'plist', 'rss', 'atom'], mimeTypes: ['application/xml', 'text/xml'], text: true, language: 'xml' },
  { family: 'code', extensions: ['yaml', 'yml'], mimeTypes: ['application/yaml', 'text/yaml', 'application/x-yaml'], text: true, language: 'yaml' },
  { family: 'code', extensions: ['toml'], mimeTypes: ['application/toml'], text: true, language: 'ini' },
  { family: 'code', extensions: ['ini'], mimeTypes: ['text/plain'], text: true, language: 'ini' },
  { family: 'code', extensions: ['py', 'pyi', 'pyw'], mimeTypes: ['text/x-python'], text: true, language: 'python' },
  { family: 'code', extensions: ['rb', 'gemspec', 'rake'], mimeTypes: ['text/x-ruby'], text: true, language: 'ruby' },
  { family: 'code', extensions: ['go'], mimeTypes: ['text/x-go'], text: true, language: 'go' },
  { family: 'code', extensions: ['rs'], mimeTypes: ['text/x-rust'], text: true, language: 'rust' },
  { family: 'code', extensions: ['java'], mimeTypes: ['text/x-java'], text: true, language: 'java' },
  { family: 'code', extensions: ['kt', 'kts'], mimeTypes: ['text/x-kotlin'], text: true, language: 'kotlin' },
  { family: 'code', extensions: ['swift'], mimeTypes: ['text/x-swift'], text: true, language: 'swift' },
  { family: 'code', extensions: ['c', 'h'], mimeTypes: ['text/x-c'], text: true, language: 'c' },
  { family: 'code', extensions: ['cc', 'cpp', 'cxx', 'hpp', 'hh', 'hxx'], mimeTypes: ['text/x-c++'], text: true, language: 'cpp' },
  { family: 'code', extensions: ['m', 'mm'], mimeTypes: ['text/x-objective-c'], text: true, language: 'objectivec' },
  { family: 'code', extensions: ['cs'], mimeTypes: ['text/x-csharp'], text: true, language: 'csharp' },
  { family: 'code', extensions: ['php'], mimeTypes: ['application/x-httpd-php'], text: true, language: 'php' },
  { family: 'code', extensions: ['sh', 'bash', 'zsh', 'fish', 'command'], mimeTypes: ['application/x-sh', 'text/x-shellscript'], text: true, language: 'bash' },
  { family: 'code', extensions: ['ps1', 'psm1', 'bat', 'cmd'], mimeTypes: ['text/plain'], text: true },
  { family: 'code', extensions: ['sql'], mimeTypes: ['application/sql'], text: true, language: 'sql' },
  { family: 'code', extensions: ['graphql', 'gql'], mimeTypes: ['application/graphql'], text: true, language: 'graphql' },
  { family: 'code', extensions: ['lua'], mimeTypes: ['text/x-lua'], text: true, language: 'lua' },
  { family: 'code', extensions: ['pl', 'pm'], mimeTypes: ['text/x-perl'], text: true, language: 'perl' },
  { family: 'code', extensions: ['r'], mimeTypes: ['text/x-r'], text: true, language: 'r' },
  { family: 'code', extensions: ['diff', 'patch'], mimeTypes: ['text/x-diff'], text: true, language: 'diff' },
  { family: 'code', extensions: ['dart', 'scala', 'clj', 'ex', 'exs', 'erl', 'hs', 'ml', 'jl', 'zig', 'nim', 'proto', 'tf', 'hcl', 'gradle', 'cmake', 'dockerfile', 'makefile', 'mk'], mimeTypes: ['text/plain'], text: true },

  { family: 'document', extensions: ['docx', 'docm', 'dotx', 'dotm'], mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-word.document.macroenabled.12', 'application/vnd.openxmlformats-officedocument.wordprocessingml.template'], text: false, office: 'ooxml' },
  { family: 'document', extensions: ['doc', 'dot'], mimeTypes: ['application/msword'], text: false, office: 'legacy' },
  { family: 'document', extensions: ['odt', 'ott'], mimeTypes: ['application/vnd.oasis.opendocument.text'], text: false, office: 'odf' },
  { family: 'document', extensions: ['rtf'], mimeTypes: ['application/rtf', 'text/rtf'], text: false, office: 'rtf' },
  { family: 'document', extensions: ['pages'], mimeTypes: ['application/vnd.apple.pages'], text: false, office: 'iwork' },
  { family: 'spreadsheet', extensions: ['xlsx', 'xlsm', 'xltx', 'xltm'], mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel.sheet.macroenabled.12', 'application/vnd.openxmlformats-officedocument.spreadsheetml.template'], text: false, office: 'ooxml' },
  { family: 'spreadsheet', extensions: ['xls', 'xlt'], mimeTypes: ['application/vnd.ms-excel'], text: false, office: 'legacy' },
  { family: 'spreadsheet', extensions: ['ods', 'ots'], mimeTypes: ['application/vnd.oasis.opendocument.spreadsheet'], text: false, office: 'odf' },
  { family: 'spreadsheet', extensions: ['numbers'], mimeTypes: ['application/vnd.apple.numbers'], text: false, office: 'iwork' },
  { family: 'presentation', extensions: ['pptx', 'pptm', 'potx', 'potm', 'ppsx'], mimeTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.ms-powerpoint.presentation.macroenabled.12', 'application/vnd.openxmlformats-officedocument.presentationml.template', 'application/vnd.openxmlformats-officedocument.presentationml.slideshow'], text: false, office: 'ooxml' },
  { family: 'presentation', extensions: ['ppt', 'pot', 'pps'], mimeTypes: ['application/vnd.ms-powerpoint'], text: false, office: 'legacy' },
  { family: 'presentation', extensions: ['odp', 'otp'], mimeTypes: ['application/vnd.oasis.opendocument.presentation'], text: false, office: 'odf' },
  { family: 'presentation', extensions: ['key'], mimeTypes: ['application/vnd.apple.keynote'], text: false, office: 'iwork' },

  { family: 'pdf', extensions: ['pdf'], mimeTypes: ['application/pdf'], text: false },
  { family: 'image', extensions: ['png'], mimeTypes: ['image/png'], text: false },
  { family: 'image', extensions: ['jpg', 'jpeg'], mimeTypes: ['image/jpeg'], text: false },
  { family: 'image', extensions: ['gif'], mimeTypes: ['image/gif'], text: false },
  { family: 'image', extensions: ['webp'], mimeTypes: ['image/webp'], text: false },
  { family: 'image', extensions: ['heic', 'heif'], mimeTypes: ['image/heic', 'image/heif'], text: false },
  { family: 'image', extensions: ['avif'], mimeTypes: ['image/avif'], text: false },
  { family: 'image', extensions: ['bmp'], mimeTypes: ['image/bmp'], text: false },
  { family: 'image', extensions: ['tif', 'tiff'], mimeTypes: ['image/tiff'], text: false },
  { family: 'image', extensions: ['ico'], mimeTypes: ['image/x-icon', 'image/vnd.microsoft.icon'], text: false },
  { family: 'audio', extensions: ['mp3'], mimeTypes: ['audio/mpeg'], text: false },
  { family: 'audio', extensions: ['m4a', 'aac'], mimeTypes: ['audio/mp4', 'audio/aac'], text: false },
  { family: 'audio', extensions: ['wav'], mimeTypes: ['audio/wav', 'audio/x-wav'], text: false },
  { family: 'audio', extensions: ['ogg', 'oga', 'opus'], mimeTypes: ['audio/ogg'], text: false },
  { family: 'audio', extensions: ['flac'], mimeTypes: ['audio/flac'], text: false },
  { family: 'audio', extensions: ['aiff', 'aif', 'wma'], mimeTypes: ['audio/aiff'], text: false },
  { family: 'video', extensions: ['mp4', 'm4v'], mimeTypes: ['video/mp4'], text: false },
  { family: 'video', extensions: ['mov'], mimeTypes: ['video/quicktime'], text: false },
  { family: 'video', extensions: ['webm'], mimeTypes: ['video/webm'], text: false },
  { family: 'video', extensions: ['mkv', 'avi', 'mpeg', 'mpg', 'wmv'], mimeTypes: ['video/x-matroska'], text: false },
  { family: 'archive', extensions: ['zip'], mimeTypes: ['application/zip'], text: false },
  { family: 'archive', extensions: ['gz', 'tgz'], mimeTypes: ['application/gzip'], text: false },
  { family: 'archive', extensions: ['tar'], mimeTypes: ['application/x-tar'], text: false },
  { family: 'archive', extensions: ['7z'], mimeTypes: ['application/x-7z-compressed'], text: false },
  { family: 'archive', extensions: ['rar'], mimeTypes: ['application/vnd.rar', 'application/x-rar-compressed'], text: false },
  { family: 'archive', extensions: ['bz2', 'xz', 'zst'], mimeTypes: ['application/x-bzip2', 'application/x-xz', 'application/zstd'], text: false },
]

/** Files known by their whole name rather than an extension, all of them text. */
const TEXT_FILE_NAMES: Record<string, string | undefined> = {
  dockerfile: undefined,
  containerfile: undefined,
  makefile: 'makefile',
  gnumakefile: 'makefile',
  rakefile: 'ruby',
  gemfile: 'ruby',
  procfile: undefined,
  license: undefined,
  licence: undefined,
  readme: undefined,
  changelog: undefined,
  authors: undefined,
  '.env': 'ini',
  '.gitignore': undefined,
  '.gitattributes': undefined,
  '.dockerignore': undefined,
  '.editorconfig': 'ini',
  '.npmrc': 'ini',
  '.bashrc': 'bash',
  '.zshrc': 'bash',
  '.profile': 'bash',
}

const BY_EXTENSION = new Map<string, FileType>()
const BY_MIME = new Map<string, FileType>()
for (const type of TYPES) {
  for (const extension of type.extensions) {
    if (BY_EXTENSION.has(extension)) throw new Error(`Duplicate file extension: ${extension}`)
    BY_EXTENSION.set(extension, type)
  }
  // The first entry claiming a MIME type owns it, so generic types (text/plain) map to plain text.
  for (const mime of type.mimeTypes) if (!BY_MIME.has(mime)) BY_MIME.set(mime, type)
}

function extensionsOf(predicate: (type: FileType) => boolean): ReadonlySet<string> {
  return new Set(TYPES.filter(predicate).flatMap((type) => type.extensions))
}

/** Every extension whose bytes are text, including code, Markdown, CSV, HTML, SVG, and notebooks. */
export const TEXT_EXTENSIONS = extensionsOf((type) => type.text)
/** Source code and structured text (JSON, XML, YAML), plus HTML: what file icons show as code. */
export const CODE_EXTENSIONS = extensionsOf((type) => type.family === 'code' || type.family === 'html')
export const DELIMITED_EXTENSIONS = extensionsOf((type) => type.family === 'delimited')
/** Tables of any format: CSV/TSV and spreadsheets. */
export const SHEET_EXTENSIONS = extensionsOf((type) => type.family === 'delimited' || type.family === 'spreadsheet')
export const DOCUMENT_EXTENSIONS = extensionsOf((type) => type.family === 'document')
export const PRESENTATION_EXTENSIONS = extensionsOf((type) => type.family === 'presentation')
/** Office formats from before Office Open XML: `.doc`, `.xls`, `.ppt` and their templates. */
export const LEGACY_OFFICE_EXTENSIONS = extensionsOf((type) => type.office === 'legacy')
export const OOXML_EXTENSIONS = extensionsOf((type) => type.office === 'ooxml')
export const ODF_EXTENSIONS = extensionsOf((type) => type.office === 'odf')
export const NOTEBOOK_EXTENSIONS = extensionsOf((type) => type.family === 'notebook')
export const ARCHIVE_EXTENSIONS = extensionsOf((type) => type.family === 'archive')
export const IMAGE_EXTENSIONS = extensionsOf((type) => type.family === 'image')
export const AUDIO_EXTENSIONS = extensionsOf((type) => type.family === 'audio')
export const VIDEO_EXTENSIONS = extensionsOf((type) => type.family === 'video')

/** A name's extension in lower case, without the dot; empty for none and for dotfiles like `.env`. */
export function fileExtension(name: string): string {
  const trimmed = name.trim()
  const dot = trimmed.lastIndexOf('.')
  return dot > 0 ? trimmed.slice(dot + 1).toLowerCase() : ''
}

/** A MIME type without parameters, in lower case (`Text/HTML; charset=utf-8` is `text/html`). */
export function baseMimeType(mimeType: string | null | undefined): string {
  return (mimeType ?? '').split(';')[0]!.trim().toLowerCase()
}

function baseName(name: string): string {
  const trimmed = name.trim()
  return trimmed.slice(trimmed.lastIndexOf('/') + 1).toLowerCase()
}

/** The type a name's extension names, if Pulpo knows it. */
export function fileTypeForName(name: string): FileType | null {
  return BY_EXTENSION.get(fileExtension(name)) ?? null
}

/** The type a MIME type names, if Pulpo knows it. Structured suffixes (`+json`, `+xml`) count. */
export function fileTypeForMime(mimeType: string | null | undefined): FileType | null {
  const mime = baseMimeType(mimeType)
  if (!mime) return null
  const known = BY_MIME.get(mime)
  if (known) return known
  if (mime.endsWith('+json')) return BY_EXTENSION.get('json')!
  if (mime.endsWith('+xml')) return BY_EXTENSION.get('xml')!
  if (mime.startsWith('image/')) return { family: 'image', extensions: [], mimeTypes: [mime], text: false }
  if (mime.startsWith('audio/')) return { family: 'audio', extensions: [], mimeTypes: [mime], text: false }
  if (mime.startsWith('video/')) return { family: 'video', extensions: [], mimeTypes: [mime], text: false }
  if (mime.startsWith('text/')) return BY_EXTENSION.get('txt')!
  return null
}

/** A file's type: by its extension, then by a known whole name (`Dockerfile`), then by its MIME type. */
export function fileTypeOf(name: string, mimeType?: string | null): FileType | null {
  const byName = fileTypeForName(name)
  if (byName) return byName
  if (baseName(name) in TEXT_FILE_NAMES) return { family: 'code', extensions: [], mimeTypes: ['text/plain'], text: true }
  return fileTypeForMime(mimeType)
}

export function fileFamily(name: string, mimeType?: string | null): FileFamily | null {
  return fileTypeOf(name, mimeType)?.family ?? null
}

/** Whether a file's bytes are text that can be read, searched, and shown with highlighting. */
export function isTextFile(name: string, mimeType?: string | null): boolean {
  const type = fileTypeOf(name, mimeType)
  if (type) return type.text
  // Types this table does not list but which are text by construction (`application/vnd.foo+yaml`).
  // Tokens are matched whole, so `openxmlformats` (zipped Office files) is not mistaken for XML.
  return /(^|[/+.-])(json|xml|yaml|csv|javascript|typescript|markdown)($|[+.-])/.test(baseMimeType(mimeType))
}

/** The canonical MIME type for a name's extension, if Pulpo knows the extension. */
export function mimeTypeForName(name: string): string | null {
  return fileTypeForName(name)?.mimeTypes[0] ?? null
}

/** The highlight.js grammar for a text file, or null for plain text. */
export function codeLanguageFor(name: string, mimeType?: string | null): string | null {
  const byName = fileTypeForName(name)
  if (byName) return byName.language ?? null
  const whole = baseName(name)
  if (whole in TEXT_FILE_NAMES) return TEXT_FILE_NAMES[whole] ?? null
  return fileTypeForMime(mimeType)?.language ?? null
}

/**
 * The delimiter a CSV/TSV file is declared to use: tab for TSV, comma for CSV. CSV files written in
 * locales with decimal commas often use semicolons instead; `sniffDelimiter` finds those.
 */
export function declaredDelimiter(name: string, mimeType?: string | null): ',' | '\t' | null {
  const type = fileTypeOf(name, mimeType)
  if (type?.family !== 'delimited') return null
  return type.extensions.includes('tsv') ? '\t' : ','
}
