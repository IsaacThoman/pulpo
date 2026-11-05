import type { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import type { LiveAssetStore } from '../../live-format.js'
import {
  cellInitOf,
  clearOutputs,
  deleteCells,
  insertCells,
  mergeCells,
  moveCells,
  setCellType,
  setOutputsCollapsed,
  setSourceCollapsed,
  shiftCells,
  splitCell,
  type CellInit,
  type CellPosition,
} from '../edit.js'
import {
  cellAttachments,
  cellExecutionCount,
  cellOutputs,
  cellsMap,
  cellSource,
  cellType,
  notebookKernelName,
  notebookLanguage,
  notebookMap,
  notebookMetadata,
  orderedCells,
  outputsCollapsed,
  sourceCollapsed,
  type NotebookBlob,
  type NotebookCellType,
} from '../layout.js'

/**
 * The notebook editor's state and commands, without any view: which cell is active, command or
 * edit mode (as in Jupyter), the selection, the clipboard, and undo. The web app renders it with
 * React and the mobile app with plain DOM; both call these commands from toolbars and keys.
 *
 * Every change it makes uses its own transaction origin, which (with the cell editors' own) is
 * what its undo manager tracks, so undo takes back this session's edits and never anyone else's.
 */

export type NotebookMode = 'command' | 'edit'

export interface NotebookCellState {
  key: string
  type: NotebookCellType
  executionCount: number | null
  outputs: NotebookBlob | null
  attachments: NotebookBlob | null
  outputsCollapsed: boolean
  sourceCollapsed: boolean
}

export interface NotebookPeer {
  clientId: number
  name: string
  color: string
  mode: NotebookMode
}

export interface NotebookEditorState {
  cells: NotebookCellState[]
  active: string | null
  mode: NotebookMode
  /** Selected cells in notebook order; the active cell is always one of them. */
  selected: string[]
  canUndo: boolean
  canRedo: boolean
  canPaste: boolean
  readOnly: boolean
  language: string
  kernel: string | null
  /** Other sessions on each cell. */
  peers: Record<string, NotebookPeer[]>
}

export interface NotebookControllerOptions {
  doc: Y.Doc
  awareness: Awareness
  assets: LiveAssetStore
  readOnly: boolean
  user: { name: string; color: string }
}

/** What copy and cut keep: the cells, and where their assets live (for pasting into another notebook). */
interface Clipboard {
  /** The source notebook's guid: the clipboard must not keep a closed notebook's Y.Doc alive. */
  docGuid: string
  assets: LiveAssetStore
  cells: CellInit[]
}

// One clipboard per page, so cells copied in one notebook paste into another.
let clipboard: Clipboard | null = null

/** Two presses of D within this long delete the selected cells, as in Jupyter. */
const DOUBLE_KEY_MS = 800
/**
 * The server relays awareness as volatile messages, which a busy connection may drop; once this
 * session's cursor and cell settle, its state is sent once more so others never keep a stale one.
 */
const AWARENESS_RESEND_MS = 1_000

export interface NotebookKey {
  key: string
  shiftKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
}

function blobsWithAssets(init: CellInit): NotebookBlob[] {
  return [init.outputs, init.attachments].filter((blob): blob is NotebookBlob => Boolean(blob?.assets.length))
}

export class NotebookController {
  readonly doc: Y.Doc
  readonly awareness: Awareness
  readonly assets: LiveAssetStore
  readonly undoManager: Y.UndoManager
  /** The origin of this session's structural changes. */
  readonly origin = { notebookEditor: true }
  private state: NotebookEditorState
  private readonly listeners = new Set<(state: NotebookEditorState) => void>()
  private anchor: string | null = null
  private lastKey: { key: string; at: number } | null = null
  private cursorOf: ((key: string) => number | null) | null = null
  private scheduled = false
  private destroyed = false
  private resendTimer: ReturnType<typeof setTimeout> | null = null
  private resending = false

  constructor(options: NotebookControllerOptions) {
    this.doc = options.doc
    this.awareness = options.awareness
    this.assets = options.assets
    this.undoManager = new Y.UndoManager([cellsMap(this.doc), notebookMetadata(this.doc)], {
      trackedOrigins: new Set([this.origin]),
      captureTimeout: 400,
    })
    const cells = this.readCells()
    this.state = {
      cells,
      active: cells[0]?.key ?? null,
      mode: 'command',
      selected: cells[0] ? [cells[0].key] : [],
      canUndo: false,
      canRedo: false,
      canPaste: clipboard !== null,
      readOnly: options.readOnly,
      language: notebookLanguage(this.doc),
      kernel: notebookKernelName(this.doc),
      peers: {},
    }
    this.anchor = this.state.active
    const color = options.user.color
    this.awareness.setLocalStateField('user', { name: options.user.name, color, colorLight: /^#[0-9a-f]{6}$/i.test(color) ? `${color}33` : color })
    cellsMap(this.doc).observeDeep(this.onCells)
    notebookMetadata(this.doc).observe(this.onMetadata)
    notebookMap(this.doc).observe(this.onMetadata)
    this.undoManager.on('stack-item-added', this.onStack)
    this.undoManager.on('stack-item-popped', this.onStack)
    this.awareness.on('change', this.onAwareness)
    this.awareness.on('update', this.onAwarenessUpdate)
    this.onAwareness()
    this.announce()
  }

  getState = (): NotebookEditorState => this.state

  subscribe = (listener: (state: NotebookEditorState) => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** How the view reports a cell editor's cursor, for splitting at it. */
  setCursorProvider(provider: ((key: string) => number | null) | null): void {
    this.cursorOf = provider
  }

  setReadOnly(readOnly: boolean): void {
    if (readOnly === this.state.readOnly) return
    this.update({ readOnly, mode: readOnly ? 'command' : this.state.mode })
  }

  // Reading the document.

  private readCells(): NotebookCellState[] {
    return orderedCells(this.doc).map(({ key, cell }) => {
      const type = cellType(cell)
      return {
        key,
        type,
        executionCount: type === 'code' ? cellExecutionCount(cell) : null,
        outputs: type === 'code' ? cellOutputs(cell) : null,
        attachments: cellAttachments(cell),
        outputsCollapsed: outputsCollapsed(cell),
        sourceCollapsed: sourceCollapsed(cell),
      }
    })
  }

  /** The cell's source; repaired (in an untracked transaction) if a damaged replica lacks it and this session edits. */
  sourceOf(key: string): Y.Text | null {
    const cell = cellsMap(this.doc).get(key)
    if (!cell) return null
    const source = cellSource(cell)
    if (source) return source
    if (this.state.readOnly) return null
    const text = new Y.Text()
    this.doc.transact(() => cell.set('source', text), 'repair')
    return text
  }

  private onCells = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    // Typing in a source changes nothing the cell list shows.
    if (events.every((event) => event.target instanceof Y.Text)) return
    this.schedule()
  }

  private onMetadata = () => this.schedule()

  private onStack = () => {
    this.update({ canUndo: this.undoManager.undoStack.length > 0, canRedo: this.undoManager.redoStack.length > 0 })
  }

  private onAwareness = () => {
    const peers: Record<string, NotebookPeer[]> = {}
    this.awareness.getStates().forEach((state, clientId) => {
      if (clientId === this.doc.clientID) return
      const where = (state as { notebook?: { cell?: unknown; mode?: unknown } }).notebook
      const user = (state as { user?: { name?: unknown; color?: unknown } }).user
      if (typeof where?.cell !== 'string') return
      ;(peers[where.cell] ??= []).push({
        clientId,
        name: typeof user?.name === 'string' ? user.name : 'Anonymous',
        color: typeof user?.color === 'string' ? user.color : '#30bced',
        mode: where.mode === 'edit' ? 'edit' : 'command',
      })
    })
    if (JSON.stringify(peers) !== JSON.stringify(this.state.peers)) this.update({ peers })
  }

  private onAwarenessUpdate = ({ added, updated }: { added: number[]; updated: number[] }, origin: unknown) => {
    if (this.resending || origin === 'remote' || ![...added, ...updated].includes(this.doc.clientID)) return
    if (this.resendTimer) clearTimeout(this.resendTimer)
    this.resendTimer = setTimeout(() => {
      this.resendTimer = null
      const state = this.awareness.getLocalState()
      if (this.destroyed || !state) return
      // Setting the same state still emits an update, which the provider sends.
      this.resending = true
      try {
        this.awareness.setLocalState(state)
      } finally {
        this.resending = false
      }
    }, AWARENESS_RESEND_MS)
  }

  private schedule(): void {
    if (this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      if (!this.destroyed) this.refresh()
    })
  }

  /** Rereads the cells, keeping the active cell (or its nearest neighbour when it was deleted). */
  private refresh(): void {
    // Each command is its own undo step; only typing within a cell groups.
    this.undoManager.stopCapturing()
    const previous = this.state.cells
    const cells = this.readCells()
    const keys = new Set(cells.map((cell) => cell.key))
    let active = this.state.active
    if (active && !keys.has(active)) {
      const index = previous.findIndex((cell) => cell.key === active)
      const survivor = previous.slice(index + 1).find((cell) => keys.has(cell.key)) ?? [...previous.slice(0, Math.max(0, index))].reverse().find((cell) => keys.has(cell.key))
      active = survivor?.key ?? cells[0]?.key ?? null
      this.anchor = active
    }
    if (!active && cells[0]) active = cells[0].key
    if (this.anchor && !keys.has(this.anchor)) this.anchor = active
    this.update({
      cells,
      active,
      mode: active === this.state.active ? this.state.mode : 'command',
      selected: this.selectionBetween(cells, this.anchor, active),
      language: notebookLanguage(this.doc),
      kernel: notebookKernelName(this.doc),
    })
  }

  private selectionBetween(cells: NotebookCellState[], anchor: string | null, active: string | null): string[] {
    if (!active) return []
    const from = cells.findIndex((cell) => cell.key === (anchor ?? active))
    const to = cells.findIndex((cell) => cell.key === active)
    if (from < 0 || to < 0) return to < 0 ? [] : [active]
    return cells.slice(Math.min(from, to), Math.max(from, to) + 1).map((cell) => cell.key)
  }

  private update(patch: Partial<NotebookEditorState>): void {
    const next = { ...this.state, ...patch }
    const moved = next.active !== this.state.active || next.mode !== this.state.mode
    this.state = next
    if (moved) this.announce()
    for (const listener of this.listeners) listener(next)
  }

  /** Tells other sessions which cell this one is on. */
  private announce(): void {
    if (this.destroyed || !this.awareness.getLocalState()) return
    this.awareness.setLocalStateField('notebook', this.state.active ? { cell: this.state.active, mode: this.state.mode } : null)
  }

  // Selection and modes.

  /** Makes a cell active: extend grows the selection from its anchor, as Shift+click does. */
  select(key: string, options: { extend?: boolean; mode?: NotebookMode } = {}): void {
    if (!this.state.cells.some((cell) => cell.key === key)) return
    if (!options.extend) this.anchor = key
    const mode = options.mode ?? (key === this.state.active ? this.state.mode : 'command')
    this.update({
      active: key,
      mode: this.state.readOnly && mode === 'edit' ? 'command' : mode,
      selected: this.selectionBetween(this.state.cells, this.anchor, key),
    })
  }

  selectAll(): void {
    const { cells } = this.state
    if (!cells.length) return
    this.anchor = cells[0]!.key
    this.update({ active: cells[cells.length - 1]!.key, mode: 'command', selected: cells.map((cell) => cell.key) })
  }

  setMode(mode: NotebookMode): void {
    if (mode === 'edit' && (this.state.readOnly || !this.state.active)) return
    if (mode === this.state.mode) return
    if (mode === 'edit') this.anchor = this.state.active
    this.update({ mode, selected: mode === 'edit' && this.state.active ? [this.state.active] : this.state.selected })
  }

  /** Moves the active cell up or down (Shift extends the selection). */
  step(direction: 'up' | 'down', options: { extend?: boolean; mode?: NotebookMode } = {}): boolean {
    const { cells, active } = this.state
    const index = cells.findIndex((cell) => cell.key === active)
    const next = cells[index + (direction === 'up' ? -1 : 1)]
    if (!next) return false
    this.select(next.key, { extend: options.extend, mode: options.mode ?? 'command' })
    return true
  }

  // Changes to the notebook.

  private get editable(): boolean {
    return !this.state.readOnly
  }

  /** The cells to act on: the selection, in notebook order. */
  private targets(): string[] {
    return this.state.selected.length ? this.state.selected : this.state.active ? [this.state.active] : []
  }

  /** Inserts a new cell above or below the active one and makes it active. */
  insert(where: 'above' | 'below', type: NotebookCellType = 'code', options: { edit?: boolean; source?: string } = {}): string | null {
    if (!this.editable) return null
    const { active } = this.state
    const selected = this.targets()
    const position: CellPosition = !active
      ? { before: null }
      : where === 'above' ? { before: selected[0] ?? active } : { after: selected[selected.length - 1] ?? active }
    this.undoManager.stopCapturing()
    const [key] = insertCells(this.doc, position, [{ type, source: options.source ?? '' }], this.origin)
    this.refresh()
    if (key) this.select(key, { mode: options.edit ? 'edit' : 'command' })
    return key ?? null
  }

  deleteSelected(): void {
    if (!this.editable) return
    const keys = this.targets()
    if (!keys.length) return
    this.undoManager.stopCapturing()
    deleteCells(this.doc, keys, this.origin)
    this.refresh()
  }

  copy(): string {
    const keys = new Set(this.targets())
    const cells = orderedCells(this.doc).filter((entry) => keys.has(entry.key))
    clipboard = { docGuid: this.doc.guid, assets: this.assets, cells: cells.map((entry) => cellInitOf(entry.cell)) }
    this.update({ canPaste: true })
    // Plain text for other apps: the sources, a blank line apart.
    return clipboard.cells.map((cell) => cell.source ?? '').join('\n\n')
  }

  cut(): string {
    if (!this.editable) return ''
    const text = this.copy()
    this.deleteSelected()
    return text
  }

  /** Pastes copied cells below (or above) the selection. Cells from another notebook bring their images along. */
  async paste(where: 'above' | 'below' = 'below'): Promise<void> {
    if (!this.editable || !clipboard) return
    const source = clipboard
    let cells = source.cells
    if (source.docGuid !== this.doc.guid) {
      const copied = new Map<string, Promise<unknown>>()
      cells = await Promise.all(cells.map(async (cell) => {
        try {
          for (const blob of blobsWithAssets(cell)) {
            for (const slot of blob.assets) {
              if (!copied.has(slot.hash)) {
                copied.set(slot.hash, source.assets.get(slot.hash).then((bytes) => this.assets.put(bytes, slot.kind === 'base64' ? slot.mimeType : 'application/json')))
              }
              await copied.get(slot.hash)
            }
          }
          return cell
        } catch {
          // An image that cannot be copied drops the outputs, not the cell.
          const { outputs: _outputs, attachments: _attachments, ...rest } = cell
          return { ...rest, ...cell.type === 'code' ? { executionCount: null } : {} }
        }
      }))
    }
    if (this.destroyed) return
    const selected = this.targets()
    const position: CellPosition = !selected.length ? { before: null } : where === 'above' ? { before: selected[0]! } : { after: selected[selected.length - 1]! }
    this.undoManager.stopCapturing()
    const keys = insertCells(this.doc, position, cells, this.origin)
    this.refresh()
    if (keys.length) {
      this.anchor = keys[0]!
      this.update({ active: keys[keys.length - 1]!, mode: 'command', selected: keys })
    }
  }

  move(direction: 'up' | 'down'): void {
    if (!this.editable) return
    this.undoManager.stopCapturing()
    shiftCells(this.doc, this.targets(), direction, this.origin)
    this.refresh()
  }

  /** Moves cells to a place, e.g. where they were dropped. */
  moveTo(keys: readonly string[], position: CellPosition): void {
    if (!this.editable || !keys.length) return
    this.undoManager.stopCapturing()
    moveCells(this.doc, keys, position, this.origin)
    this.refresh()
  }

  setType(type: NotebookCellType): void {
    if (!this.editable) return
    this.undoManager.stopCapturing()
    setCellType(this.doc, this.targets(), type, this.origin)
    this.refresh()
  }

  /** Splits the active cell at its cursor (Ctrl+Shift+Minus). */
  split(): void {
    const { active } = this.state
    if (!this.editable || !active) return
    const cursor = this.cursorOf?.(active)
    if (cursor === null || cursor === undefined) return
    this.undoManager.stopCapturing()
    const keys = splitCell(this.doc, active, [cursor], this.origin)
    this.refresh()
    if (keys[1]) this.select(keys[1], { mode: 'edit' })
  }

  /** Merges the selected cells, or the active cell with the one below (Shift+M). */
  merge(): void {
    if (!this.editable) return
    let keys = this.targets()
    if (keys.length < 2) {
      const index = this.state.cells.findIndex((cell) => cell.key === this.state.active)
      const below = this.state.cells[index + 1]
      if (!below) return
      keys = [this.state.active!, below.key]
    }
    this.undoManager.stopCapturing()
    const kept = mergeCells(this.doc, keys, this.origin)
    this.refresh()
    if (kept) this.select(kept)
  }

  clearOutputs(scope: 'selected' | 'all' = 'selected'): void {
    if (!this.editable) return
    this.undoManager.stopCapturing()
    clearOutputs(this.doc, scope === 'all' ? null : this.targets(), this.origin)
    this.undoManager.stopCapturing()
  }

  /** Collapses the selected cells' outputs, or expands them if all are collapsed. */
  toggleOutputs(): void {
    if (!this.editable) return
    const keys = this.targets()
    const cells = this.state.cells.filter((cell) => keys.includes(cell.key))
    this.undoManager.stopCapturing()
    setOutputsCollapsed(this.doc, keys, !cells.every((cell) => cell.outputsCollapsed), this.origin)
    this.undoManager.stopCapturing()
  }

  toggleSource(): void {
    if (!this.editable) return
    const keys = this.targets()
    const cells = this.state.cells.filter((cell) => keys.includes(cell.key))
    this.undoManager.stopCapturing()
    setSourceCollapsed(this.doc, keys, !cells.every((cell) => cell.sourceCollapsed), this.origin)
    this.undoManager.stopCapturing()
  }

  undo(): void {
    if (this.editable) this.undoManager.undo()
  }

  redo(): void {
    if (this.editable) this.undoManager.redo()
  }

  /**
   * Shift+Enter. Cells don't run here, so it does the rest of Jupyter's "run and advance": the
   * cell leaves edit mode and the next one becomes active, or a new code cell below the last.
   */
  advance(): void {
    const { cells, active } = this.state
    const index = cells.findIndex((cell) => cell.key === active)
    if (index < 0) return
    const next = cells[index + 1]
    if (next) this.select(next.key, { mode: 'command' })
    else if (this.editable) this.insert('below', 'code', { edit: true })
    else this.setMode('command')
  }

  /**
   * Jupyter's command-mode keys. Returns whether the key was handled, so the view can prevent the
   * browser's default. Edit-mode keys are the cell editor's.
   */
  handleCommandKey(event: NotebookKey): boolean {
    if (this.state.mode !== 'command') return false
    const mod = Boolean(event.ctrlKey || event.metaKey)
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
    const repeat = this.lastKey?.key === key && Date.now() - this.lastKey.at < DOUBLE_KEY_MS
    this.lastKey = { key, at: Date.now() }
    if (mod) {
      if (key === 'z' && !event.shiftKey) this.undo()
      else if ((key === 'z' && event.shiftKey) || key === 'y') this.redo()
      else if (key === 'a') this.selectAll()
      else if (key === 'Enter') this.setMode('command')
      else return false
      return true
    }
    if (event.altKey) {
      if (key === 'Enter') {
        this.insert('below', 'code', { edit: true })
        return true
      }
      return false
    }
    switch (key) {
      case 'Enter':
        if (event.shiftKey) this.advance()
        else this.setMode('edit')
        return true
      case 'ArrowUp':
      case 'k':
        this.step('up', { extend: event.shiftKey })
        return true
      case 'ArrowDown':
      case 'j':
        this.step('down', { extend: event.shiftKey })
        return true
      case 'a':
        this.insert('above')
        return true
      case 'b':
        this.insert('below')
        return true
      case 'd':
        if (repeat) {
          this.lastKey = null
          this.deleteSelected()
        }
        return true
      case 'x':
        void this.cut()
        return true
      case 'c':
        this.copy()
        return true
      case 'v':
        void this.paste(event.shiftKey ? 'above' : 'below')
        return true
      case 'z':
        this.undo()
        return true
      case 'y':
        this.setType('code')
        return true
      case 'm':
        if (event.shiftKey) this.merge()
        else this.setType('markdown')
        return true
      case 'r':
        this.setType('raw')
        return true
      case 'o':
        this.toggleOutputs()
        return true
      case 'Home':
        if (this.state.cells[0]) this.select(this.state.cells[0].key)
        return true
      case 'End': {
        const last = this.state.cells[this.state.cells.length - 1]
        if (last) this.select(last.key)
        return true
      }
      default:
        return false
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    cellsMap(this.doc).unobserveDeep(this.onCells)
    notebookMetadata(this.doc).unobserve(this.onMetadata)
    notebookMap(this.doc).unobserve(this.onMetadata)
    this.awareness.off('change', this.onAwareness)
    this.awareness.off('update', this.onAwarenessUpdate)
    if (this.resendTimer) clearTimeout(this.resendTimer)
    this.undoManager.off('stack-item-added', this.onStack)
    this.undoManager.off('stack-item-popped', this.onStack)
    this.undoManager.destroy()
    if (this.awareness.getLocalState()) {
      this.awareness.setLocalStateField('notebook', null)
      this.awareness.setLocalStateField('cursor', null)
    }
    this.listeners.clear()
  }
}

/** Forgets what was copied (tests). */
export function clearNotebookClipboard(): void {
  clipboard = null
}
