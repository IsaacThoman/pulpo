import * as Y from 'yjs'

/**
 * The notebook format's Y.Doc layout, kept apart from the codec so the format catalog and editors
 * read it without loading the codec. See docs/live-formats.md ("The notebook format").
 *
 * - `notebook` (Y.Map): `nbformat` and `nbformat_minor`, and what the codec owns to write the
 *   file back as it was: its JSON `style`, the order of its top-level `keys` and `metadataKeys`,
 *   unknown top-level keys (`extra`), and `original` (the file's bytes while unedited, when
 *   writing it back would not give them exactly).
 * - `metadata` (Y.Map): the notebook's metadata, one entry per key (`kernelspec`, `language_info`,
 *   …), each value compact JSON that keeps the file's spelling. Concurrent changes to different
 *   keys merge.
 * - `cells` (Y.Map of Y.Maps, keyed by a stable cell key): every cell, with
 *   - `order`: a fractional key (`order.ts`); cells sort by it, then by key. Moving a cell only
 *     rewrites it, so concurrent edits to a moved cell are kept.
 *   - `id` (the nbformat cell id, absent for notebooks before 4.5), `cell_type`, and `source`
 *     (Y.Text, which editors bind to), with `sourceShape` (`lines` or `string`, as the file had it).
 *   - `metadata` (Y.Map like the notebook's), `metadataKeys`, `keys` (the cell's key order), and
 *     `extra` (unknown keys).
 *   - code cells: `execution_count` and `outputs`; Markdown and raw cells: `attachments`. Outputs
 *     and attachments are one value each ({@link NotebookBlob}): they are replaced together, never
 *     edited in place, and their large parts (images, long text) are assets.
 */
export const NOTEBOOK_SCHEMA_VERSION = 1
export const NOTEBOOK_FIELD = 'notebook'
export const NOTEBOOK_METADATA_FIELD = 'metadata'
export const NOTEBOOK_CELLS_FIELD = 'cells'

/** Largest notebook the format edits; outputs past it are better left to Jupyter. */
export const NOTEBOOK_MAX_FILE_BYTES = 25_000_000
export const NOTEBOOK_MAX_CELLS = 10_000
export const NOTEBOOK_EXTENSIONS = ['ipynb'] as const
export const NOTEBOOK_MIME_TYPE = 'application/x-ipynb+json'

export type NotebookCellType = 'code' | 'markdown' | 'raw'

/** A binary or long part of outputs or attachments, kept as an asset; `\u0000pulpo-asset:<n>` marks its place. */
export type NotebookAssetSlot =
  /** Base64 data (an image): the asset holds the decoded bytes, written back as base64 with `trail` after it. */
  | { hash: string; kind: 'base64'; mimeType: string; trail: string; wrap: number }
  /** Any long JSON value: the asset holds it as compact JSON (UTF-8). */
  | { hash: string; kind: 'json' }

/** Outputs or attachments: compact JSON with placeholders for their assets. */
export interface NotebookBlob {
  json: string
  assets: NotebookAssetSlot[]
}

export const ASSET_MARKER = '\u0000pulpo-asset:'

export const EMPTY_OUTPUTS: NotebookBlob = { json: '[]', assets: [] }

export function notebookMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(NOTEBOOK_FIELD)
}

export function notebookMetadata(doc: Y.Doc): Y.Map<string> {
  return doc.getMap(NOTEBOOK_METADATA_FIELD)
}

export function cellsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(NOTEBOOK_CELLS_FIELD)
}

export interface CellEntry {
  key: string
  cell: Y.Map<unknown>
  order: string
}

/** The cells in notebook order. */
export function orderedCells(doc: Y.Doc): CellEntry[] {
  const entries: CellEntry[] = []
  cellsMap(doc).forEach((cell, key) => {
    if (!(cell instanceof Y.Map)) return
    const order = cell.get('order')
    entries.push({ key, cell, order: typeof order === 'string' ? order : '' })
  })
  return entries.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

export function cellType(cell: Y.Map<unknown>): NotebookCellType {
  const type = cell.get('cell_type')
  return type === 'markdown' || type === 'raw' ? type : 'code'
}

/** The cell's source, or null in a damaged cell (readers treat it as empty; editors repair it). */
export function cellSource(cell: Y.Map<unknown>): Y.Text | null {
  const source = cell.get('source')
  return source instanceof Y.Text ? source : null
}

export function cellSourceText(cell: Y.Map<unknown>): string {
  return cellSource(cell)?.toString() ?? ''
}

export function cellExecutionCount(cell: Y.Map<unknown>): number | null {
  const count = cell.get('execution_count')
  return typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : null
}

function isAssetSlot(value: unknown): value is NotebookAssetSlot {
  if (typeof value !== 'object' || value === null) return false
  const slot = value as Partial<{ hash: unknown; kind: unknown; mimeType: unknown; trail: unknown; wrap: unknown }>
  if (typeof slot.hash !== 'string' || !/^[0-9a-f]{64}$/.test(slot.hash)) return false
  if (slot.kind === 'json') return true
  return slot.kind === 'base64' && typeof slot.mimeType === 'string' && typeof slot.trail === 'string' && /^\n*$/.test(slot.trail)
    && typeof slot.wrap === 'number' && Number.isInteger(slot.wrap) && slot.wrap >= 0
}

/** Whether a value is a well-formed blob; anything else (a damaged or hostile replica's) reads as none. */
export function isNotebookBlob(value: unknown): value is NotebookBlob {
  return typeof value === 'object' && value !== null && typeof (value as NotebookBlob).json === 'string'
    && Array.isArray((value as NotebookBlob).assets) && (value as NotebookBlob).assets.every(isAssetSlot)
}

export function cellOutputs(cell: Y.Map<unknown>): NotebookBlob {
  const outputs = cell.get('outputs')
  return isNotebookBlob(outputs) ? outputs : EMPTY_OUTPUTS
}

export function cellAttachments(cell: Y.Map<unknown>): NotebookBlob | null {
  const attachments = cell.get('attachments')
  return isNotebookBlob(attachments) ? attachments : null
}

export function cellMetadata(cell: Y.Map<unknown>): Y.Map<string> | null {
  const metadata = cell.get('metadata')
  return metadata instanceof Y.Map ? metadata as Y.Map<string> : null
}

/** One metadata value, parsed; undefined when absent or unreadable. */
export function metadataValue(metadata: Y.Map<string> | null, key: string): unknown {
  const raw = metadata?.get(key)
  if (typeof raw !== 'string') return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/** Whether the cell's outputs are collapsed, as JupyterLab (`jupyter.outputs_hidden`) or classic Notebook (`collapsed`) marks it. */
export function outputsCollapsed(cell: Y.Map<unknown>): boolean {
  const metadata = cellMetadata(cell)
  const jupyter = metadataValue(metadata, 'jupyter') as { outputs_hidden?: unknown } | undefined
  return jupyter?.outputs_hidden === true || metadataValue(metadata, 'collapsed') === true
}

/** Whether the cell's source is collapsed (`jupyter.source_hidden`). */
export function sourceCollapsed(cell: Y.Map<unknown>): boolean {
  const jupyter = metadataValue(cellMetadata(cell), 'jupyter') as { source_hidden?: unknown } | undefined
  return jupyter?.source_hidden === true
}

/** The kernel's language for highlighting (`python` when the notebook does not say). */
export function notebookLanguage(doc: Y.Doc): string {
  const metadata = notebookMetadata(doc)
  const info = metadataValue(metadata, 'language_info') as { name?: unknown } | undefined
  const spec = metadataValue(metadata, 'kernelspec') as { language?: unknown } | undefined
  const language = [info?.name, spec?.language].find((value): value is string => typeof value === 'string' && value.length > 0)
  return language?.toLowerCase() ?? 'python'
}

/** The kernel's display name (`Python 3 (ipykernel)`), if the notebook names one. */
export function notebookKernelName(doc: Y.Doc): string | null {
  const spec = metadataValue(notebookMetadata(doc), 'kernelspec') as { display_name?: unknown } | undefined
  return typeof spec?.display_name === 'string' && spec.display_name ? spec.display_name : null
}
