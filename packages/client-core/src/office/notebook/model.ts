/**
 * Jupyter notebooks (`.ipynb`) read into one normalized model, whatever nbformat wrote them: multi-
 * line strings joined, nbformat 3's worksheets and output names mapped to 4's, consecutive stream
 * outputs merged, and console control characters applied. Viewers, the future editor, and agents
 * all read this model, so none of them deal with the format's variants.
 *
 * Notebooks are untrusted: nothing here runs or renders their content, and every field is checked
 * because any of them can be missing or the wrong type.
 */

/** Output data keyed by MIME type. Text types are joined into strings; JSON types keep their value. */
export type MimeBundle = Record<string, unknown>

export type NotebookOutput =
  | { type: 'stream'; name: 'stdout' | 'stderr'; text: string }
  | { type: 'error'; ename: string; evalue: string; traceback: string[] }
  | { type: 'display_data'; data: MimeBundle; metadata: Record<string, unknown> }
  | { type: 'execute_result'; data: MimeBundle; metadata: Record<string, unknown>; executionCount: number | null }

export type NotebookCell =
  | { type: 'markdown'; id: string; source: string; attachments: Record<string, MimeBundle> }
  | { type: 'code'; id: string; source: string; executionCount: number | null; outputs: NotebookOutput[] }
  | { type: 'raw'; id: string; source: string }

export interface NotebookModel {
  nbformat: number
  nbformatMinor: number
  /** The kernel's language (`python`, `r`, `julia`), for highlighting code cells. */
  language: string | null
  /** The kernel's display name (`Python 3 (ipykernel)`). */
  kernel: string | null
  cells: NotebookCell[]
}

export type NotebookErrorCode = 'invalid_json' | 'not_a_notebook' | 'unsupported_version' | 'too_large'

export class NotebookError extends Error {
  readonly code: NotebookErrorCode

  constructor(code: NotebookErrorCode, message: string) {
    super(message)
    this.name = 'NotebookError'
    this.code = code
  }
}

export const MAX_NOTEBOOK_CELLS = 10_000
export const MAX_CELL_OUTPUTS = 1_000

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** nbformat stores text as a string or a list of lines; anything else reads as empty. */
export function joinText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.filter((line): line is string => typeof line === 'string').join('')
  return ''
}

function integerOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function isJsonMime(mime: string): boolean {
  return mime === 'application/json' || mime.endsWith('+json')
}

function mimeBundle(value: unknown): MimeBundle {
  if (!isObject(value)) return {}
  const bundle: MimeBundle = {}
  for (const [mime, data] of Object.entries(value)) {
    if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mime)) continue
    const key = mime.toLowerCase()
    bundle[key] = isJsonMime(key) && typeof data !== 'string' && !Array.isArray(data) ? data : joinText(data)
  }
  return bundle
}

/**
 * Applies what a terminal would do with carriage returns and backspaces, so progress bars that
 * redraw one line show their last state instead of every frame.
 */
export function applyConsoleControls(text: string): string {
  if (!text.includes('\r') && !text.includes('\b')) return text
  return text.replace(/\r\n/g, '\n').split('\n').map((line) => {
    let current = line
    if (current.includes('\r')) {
      // As in Jupyter, a carriage return replaces the line; a trailing one keeps the last state drawn.
      const segments = current.split('\r')
      current = segments.reverse().find((segment) => segment.length > 0) ?? ''
    }
    if (current.includes('\b')) {
      // A stack, so a long run of backspaces costs linear time.
      const characters: string[] = []
      for (const character of current) {
        if (character === '\b') characters.pop()
        else characters.push(character)
      }
      current = characters.join('')
    }
    return current
  }).join('\n')
}

// nbformat 3 named output data by short keys.
const V3_MIME: Record<string, string> = {
  text: 'text/plain',
  html: 'text/html',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpeg: 'image/jpeg',
  latex: 'text/latex',
  json: 'application/json',
  javascript: 'application/javascript',
  markdown: 'text/markdown',
  pdf: 'application/pdf',
}

function v3Bundle(output: Json): MimeBundle {
  const bundle: MimeBundle = {}
  for (const [key, mime] of Object.entries(V3_MIME)) {
    if (key in output) bundle[mime] = mime === 'application/json' && isObject(output[key]) ? output[key] : joinText(output[key])
  }
  return bundle
}

function normalizeOutput(raw: unknown, v3: boolean): NotebookOutput | null {
  if (!isObject(raw)) return null
  const type = raw.output_type
  if (type === 'stream') {
    const name = stringOr(v3 ? raw.stream : raw.name, 'stdout')
    return { type: 'stream', name: name === 'stderr' ? 'stderr' : 'stdout', text: joinText(raw.text) }
  }
  if (type === 'error' || type === 'pyerr') {
    const traceback = Array.isArray(raw.traceback) ? raw.traceback.filter((line): line is string => typeof line === 'string') : []
    return { type: 'error', ename: stringOr(raw.ename, 'Error'), evalue: stringOr(raw.evalue, ''), traceback }
  }
  const metadata = isObject(raw.metadata) ? raw.metadata : {}
  if (type === 'execute_result' || type === 'pyout') {
    return {
      type: 'execute_result',
      data: v3 ? v3Bundle(raw) : mimeBundle(raw.data),
      metadata,
      executionCount: integerOrNull(v3 ? raw.prompt_number : raw.execution_count),
    }
  }
  if (type === 'display_data') return { type: 'display_data', data: v3 ? v3Bundle(raw) : mimeBundle(raw.data), metadata }
  return null
}

function normalizeOutputs(value: unknown, v3: boolean): NotebookOutput[] {
  if (!Array.isArray(value)) return []
  const outputs: NotebookOutput[] = []
  for (const raw of value.slice(0, MAX_CELL_OUTPUTS)) {
    const output = normalizeOutput(raw, v3)
    if (!output) continue
    const previous = outputs[outputs.length - 1]
    // Jupyter merges consecutive writes to the same stream into one block.
    if (output.type === 'stream' && previous?.type === 'stream' && previous.name === output.name) {
      previous.text += output.text
      continue
    }
    outputs.push(output)
  }
  for (const output of outputs) if (output.type === 'stream') output.text = applyConsoleControls(output.text)
  return outputs
}

function attachments(value: unknown): Record<string, MimeBundle> {
  if (!isObject(value)) return {}
  const result: Record<string, MimeBundle> = {}
  for (const [name, bundle] of Object.entries(value)) result[name] = mimeBundle(bundle)
  return result
}

function normalizeCell(raw: unknown, index: number, v3: boolean): NotebookCell | null {
  if (!isObject(raw)) return null
  const id = typeof raw.id === 'string' && raw.id ? raw.id : `cell-${index}`
  switch (raw.cell_type) {
    case 'code':
      return {
        type: 'code',
        id,
        source: joinText(v3 ? raw.input : raw.source),
        executionCount: integerOrNull(v3 ? raw.prompt_number : raw.execution_count),
        outputs: normalizeOutputs(raw.outputs, v3),
      }
    case 'markdown':
      return { type: 'markdown', id, source: joinText(raw.source), attachments: attachments(raw.attachments) }
    case 'heading': {
      // nbformat 3 kept headings as their own cells.
      const level = Math.min(6, Math.max(1, integerOrNull(raw.level) ?? 1))
      return { type: 'markdown', id, source: `${'#'.repeat(level)} ${joinText(raw.source)}`, attachments: {} }
    }
    case 'raw':
      return { type: 'raw', id, source: joinText(raw.source) }
    default:
      return null
  }
}

/**
 * Reads a notebook from its JSON text. Throws `NotebookError` for text that is not JSON, JSON
 * that is not a notebook, and nbformat versions before 3.
 */
export function parseNotebook(text: string): NotebookModel {
  let raw: unknown
  try {
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch {
    throw new NotebookError('invalid_json', 'This notebook is not valid JSON.')
  }
  return normalizeNotebook(raw)
}

/** Normalizes an already parsed notebook. */
export function normalizeNotebook(raw: unknown): NotebookModel {
  if (!isObject(raw)) throw new NotebookError('not_a_notebook', 'This file is not a Jupyter notebook.')
  const nbformat = integerOrNull(raw.nbformat)
  const v3Cells = Array.isArray(raw.worksheets) ? (raw.worksheets as unknown[]).flatMap((sheet) => isObject(sheet) && Array.isArray(sheet.cells) ? sheet.cells as unknown[] : []) : null
  const cellsSource = Array.isArray(raw.cells) ? raw.cells as unknown[] : v3Cells
  if (!cellsSource) throw new NotebookError('not_a_notebook', 'This file is not a Jupyter notebook.')
  if (nbformat !== null && nbformat < 3) throw new NotebookError('unsupported_version', `Notebook format ${nbformat} is not supported.`)
  if (cellsSource.length > MAX_NOTEBOOK_CELLS) throw new NotebookError('too_large', `This notebook has more than ${MAX_NOTEBOOK_CELLS.toLocaleString('en-US')} cells.`)
  const v3 = !Array.isArray(raw.cells)
  const metadata = isObject(raw.metadata) ? raw.metadata : {}
  const kernelspec = isObject(metadata.kernelspec) ? metadata.kernelspec : {}
  const languageInfo = isObject(metadata.language_info) ? metadata.language_info : {}
  const v3Language = v3 ? cellsSource.find((cell): cell is Json => isObject(cell) && typeof cell.language === 'string')?.language : undefined
  const language = [languageInfo.name, kernelspec.language, v3Language].find((value): value is string => typeof value === 'string' && value.length > 0)
  const cells: NotebookCell[] = []
  const ids = new Set<string>()
  cellsSource.forEach((cell, index) => {
    const normalized = normalizeCell(cell, index, v3)
    if (!normalized) return
    // Ids are unique in valid notebooks, but views key cells by them, so copies get their position.
    if (ids.has(normalized.id)) normalized.id = `${normalized.id}-${index}`
    ids.add(normalized.id)
    cells.push(normalized)
  })
  return {
    nbformat: nbformat ?? (v3 ? 3 : 4),
    nbformatMinor: integerOrNull(raw.nbformat_minor) ?? 0,
    language: language?.toLowerCase() ?? null,
    kernel: typeof kernelspec.display_name === 'string' ? kernelspec.display_name : null,
    cells,
  }
}

/**
 * Output types in the order viewers prefer them, as Jupyter does: the richest representation a
 * viewer can show wins, with plain text last.
 */
export const OUTPUT_MIME_PREFERENCE: readonly string[] = [
  'application/vnd.jupyter.widget-view+json',
  'application/javascript',
  'text/html',
  'image/svg+xml',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/markdown',
  'text/latex',
  'application/json',
  'text/plain',
]

/** The type of `bundle` a viewer should show, given the types it can render. */
export function pickOutputMime(bundle: MimeBundle, supported: ReadonlySet<string> | readonly string[] = OUTPUT_MIME_PREFERENCE): string | null {
  const accepts = supported instanceof Set ? supported : new Set(supported as readonly string[])
  for (const mime of OUTPUT_MIME_PREFERENCE) if (accepts.has(mime) && mime in bundle) return mime
  // Types this list doesn't rank (vendor JSON, other images) come after the ranked ones.
  for (const mime of Object.keys(bundle)) if (accepts.has(mime)) return mime
  return null
}

const RASTER_MIME = /^image\/(png|jpeg|gif|webp)$/

/**
 * A `data:` URL for base64 image output, or null when the type is not a raster image or the data
 * is not base64 (so nothing else can be smuggled into an `src`).
 */
export function imageDataUrl(mime: string, data: unknown): string | null {
  if (!RASTER_MIME.test(mime) || typeof data !== 'string') return null
  const base64 = data.replace(/\s+/g, '')
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null
  return `data:${mime};base64,${base64}`
}

/** A `data:` URL for SVG output, shown as an image so its scripts never run. */
export function svgDataUrl(data: unknown): string | null {
  if (typeof data !== 'string' || !data.trim()) return null
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data)}`
}

/** Resolves a Markdown cell's `attachment:name` image links to data URLs. */
export function resolveAttachmentUrl(url: string, cellAttachments: Record<string, MimeBundle>): string | null {
  if (!url.startsWith('attachment:')) return null
  let name = url.slice('attachment:'.length)
  try {
    name = decodeURIComponent(name)
  } catch {
    // Keep the name as written.
  }
  const bundle = cellAttachments[name]
  if (!bundle) return null
  for (const [mime, data] of Object.entries(bundle)) {
    const url = mime === 'image/svg+xml' ? svgDataUrl(data) : imageDataUrl(mime, data)
    if (url) return url
  }
  return null
}

/** Text output shown as text: JSON pretty-printed, anything else as it is. */
export function outputText(mime: string, data: unknown): string {
  if (typeof data === 'string') return data
  try {
    return JSON.stringify(data, null, 2) ?? ''
  } catch {
    return String(data)
  }
}

/** The text an output prints, for copying and searching. */
export function outputPlainText(output: NotebookOutput): string {
  if (output.type === 'stream') return output.text
  if (output.type === 'error') return output.traceback.length ? output.traceback.join('\n') : `${output.ename}: ${output.evalue}`
  const plain = output.data['text/plain']
  return typeof plain === 'string' ? plain : ''
}
