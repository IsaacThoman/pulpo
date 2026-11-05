import { diffRows, lineDiff, type DiffRow } from '../../files/markdown-diff.js'
import { longestIncreasing, matchCells } from './match.js'
import { outputPlainText, parseNotebook, pickOutputMime, type NotebookCell, type NotebookModel, type NotebookOutput } from './model.js'

/**
 * What changed between two versions of a notebook, cell by cell: cells added, removed, moved, and
 * edited (with a line diff of the source), and outputs summarized. Review screens on the web and
 * mobile show it for an agent's change. It reads files, not Y.Docs, so it runs anywhere.
 */

export interface NotebookOutputSummary {
  /** `stdout`, `stderr`, `error`, or the output's MIME type (`image/png`, `text/html`). */
  kind: string
  /** A short, readable line: the start of the text, an error's name and message, or the type. */
  text: string
}

export interface NotebookCellSummary {
  id: string
  type: NotebookCell['type']
  source: string
  executionCount: number | null
  outputs: NotebookOutputSummary[]
}

export type NotebookCellChange =
  | { kind: 'unchanged'; before: NotebookCellSummary; after: NotebookCellSummary; moved: false }
  | { kind: 'added'; after: NotebookCellSummary }
  | { kind: 'removed'; before: NotebookCellSummary }
  | {
    kind: 'changed' | 'moved'
    before: NotebookCellSummary
    after: NotebookCellSummary
    /** The cell is in another place relative to the cells around it. */
    moved: boolean
    typeChanged: boolean
    /** A folded line diff of the source, or null when the source is the same (or too long to compare). */
    source: DiffRow[] | null
    sourceChanged: boolean
    outputsChanged: boolean
    attachmentsChanged: boolean
    /** Cell metadata keys whose values differ (tags, jupyter visibility, …). */
    metadata: string[]
  }

export interface NotebookDiff {
  cells: NotebookCellChange[]
  /** Top-level metadata keys whose values differ (`kernelspec`, `language_info`, …). */
  metadata: string[]
  language: string | null
  counts: { added: number; removed: number; changed: number; moved: number; outputs: number }
}

const SUMMARY_CHARACTERS = 160

function firstLine(text: string): string {
  // ANSI colors are for terminals.
  // oxlint-disable-next-line no-control-regex -- matches ANSI escape sequences
  const clean = text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').trim()
  const line = clean.split('\n', 1)[0] ?? ''
  return line.length > SUMMARY_CHARACTERS ? `${line.slice(0, SUMMARY_CHARACTERS)}…` : line
}

function summarizeOutput(output: NotebookOutput): NotebookOutputSummary {
  if (output.type === 'stream') return { kind: output.name, text: firstLine(output.text) }
  if (output.type === 'error') return { kind: 'error', text: `${output.ename}: ${output.evalue}`.trim() }
  const mime = pickOutputMime(output.data) ?? Object.keys(output.data)[0] ?? 'output'
  const plain = outputPlainText(output)
  return { kind: mime, text: mime.startsWith('image/') ? '' : firstLine(plain) }
}

function summarize(cell: NotebookCell): NotebookCellSummary {
  return {
    id: cell.id,
    type: cell.type,
    source: cell.source,
    executionCount: cell.type === 'code' ? cell.executionCount : null,
    outputs: cell.type === 'code' ? cell.outputs.map(summarizeOutput) : [],
  }
}

/** Outputs compared by what they hold (normalized), not by how the file spelled them. */
function outputsKey(cell: NotebookCell): string {
  return cell.type === 'code' ? JSON.stringify(cell.outputs) : ''
}

function attachmentsKey(cell: NotebookCell): string {
  return JSON.stringify(cell.type === 'code' ? {} : cell.attachments ?? {})
}

export function diffNotebooks(before: NotebookModel, after: NotebookModel, metadata: string[] = []): NotebookDiff {
  const fileIds = (model: NotebookModel) => model.cells.map((cell) => (/^cell-\d+$/.test(cell.id) ? undefined : cell.id))
  const beforeIds = fileIds(before)
  const afterIds = fileIds(after)
  const matches = matchCells(
    before.cells.map((cell, index) => ({ key: String(index), id: beforeIds[index], type: cell.type, source: cell.source })),
    after.cells.map((cell, index) => ({ id: afterIds[index], type: cell.type, source: cell.source })),
  )
  const pairs = matches.flatMap((key, index) => (key === null ? [] : [{ after: index, before: Number(key) }]))
  const inPlace = longestIncreasing(pairs.map((pair) => pair.before))
  const stays = new Set(pairs.filter((_, index) => inPlace.has(index)).map((pair) => pair.after))
  const matchedBefore = new Set(pairs.map((pair) => pair.before))
  const counts = { added: 0, removed: 0, changed: 0, moved: 0, outputs: 0 }
  const cells: NotebookCellChange[] = []
  let nextBefore = 0
  // Removed cells show where they were: before the first later cell that kept its place.
  const flushRemoved = (until: number) => {
    for (; nextBefore < until; nextBefore += 1) {
      if (matchedBefore.has(nextBefore)) continue
      cells.push({ kind: 'removed', before: summarize(before.cells[nextBefore]!) })
      counts.removed += 1
    }
  }
  after.cells.forEach((cell, index) => {
    const key = matches[index]
    if (key === null || key === undefined) {
      cells.push({ kind: 'added', after: summarize(cell) })
      counts.added += 1
      return
    }
    const previous = before.cells[Number(key)]!
    const moved = !stays.has(index)
    if (!moved) flushRemoved(Number(key) + 1)
    const metadata = changedKeys(previous.metadata ?? {}, cell.metadata ?? {})
    const sourceChanged = previous.source !== cell.source
    const typeChanged = previous.type !== cell.type
    const attachmentsChanged = attachmentsKey(previous) !== attachmentsKey(cell)
    const outputsChanged = outputsKey(previous) !== outputsKey(cell)
      || (previous.type === 'code' && cell.type === 'code' && previous.executionCount !== cell.executionCount)
    // Removed cells that followed this one in place show right after it.
    const flushFollowing = () => {
      if (moved) return
      for (; nextBefore < before.cells.length && !matchedBefore.has(nextBefore); nextBefore += 1) {
        cells.push({ kind: 'removed', before: summarize(before.cells[nextBefore]!) })
        counts.removed += 1
      }
    }
    if (!moved && !sourceChanged && !typeChanged && !outputsChanged && !attachmentsChanged && !metadata.length) {
      cells.push({ kind: 'unchanged', before: summarize(previous), after: summarize(cell), moved: false })
      flushFollowing()
      return
    }
    const diff = sourceChanged ? lineDiff(previous.source, cell.source) : null
    cells.push({
      kind: sourceChanged || typeChanged || attachmentsChanged || metadata.length ? 'changed' : moved ? 'moved' : 'changed',
      before: summarize(previous),
      after: summarize(cell),
      moved,
      typeChanged,
      source: diff ? diffRows(diff) : null,
      sourceChanged,
      outputsChanged,
      attachmentsChanged,
      metadata,
    })
    if (moved) counts.moved += 1
    if (sourceChanged || typeChanged || attachmentsChanged || metadata.length) counts.changed += 1
    else if (outputsChanged) counts.outputs += 1
    flushFollowing()
  })
  flushRemoved(before.cells.length)
  return { cells, metadata, language: after.language ?? before.language, counts }
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

function changedKeys(left: Record<string, unknown>, right: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .filter((key) => JSON.stringify(left[key]) !== JSON.stringify(right[key]))
    .sort()
}

/** Top-level metadata keys whose values differ. */
function metadataChanges(before: string, after: string): string[] {
  const read = (text: string): Record<string, unknown> => {
    try {
      const value = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as { metadata?: unknown }
      return typeof value.metadata === 'object' && value.metadata !== null ? value.metadata as Record<string, unknown> : {}
    } catch {
      return {}
    }
  }
  const left = read(before)
  const right = read(after)
  return changedKeys(left, right)
}

/** The diff of two notebook files. Throws `NotebookError` when either is not a notebook. */
export function diffNotebookFiles(before: Uint8Array, after: Uint8Array): NotebookDiff {
  const left = decode(before)
  const right = decode(after)
  return diffNotebooks(parseNotebook(left), parseNotebook(right), metadataChanges(left, right))
}
