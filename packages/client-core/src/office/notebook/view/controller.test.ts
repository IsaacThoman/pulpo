import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { MemoryLiveAssetStore } from '../../assets.js'
import { notebookCodec } from '../codec.js'
import { cellSourceText, cellsMap, orderedCells } from '../layout.js'
import { clearNotebookClipboard, NotebookController } from './controller.js'
import { readOutputs } from './outputs.js'

const FIXTURE = join(import.meta.dirname, '../fixtures/generated-analysis.ipynb')

const cleanup: Array<() => void> = []

async function open(bytes?: Uint8Array) {
  const doc = new Y.Doc()
  const assets = new MemoryLiveAssetStore()
  if (bytes) await notebookCodec.importFile(doc, bytes, { name: 'a.ipynb', assets })
  else await notebookCodec.createEmpty(doc, { name: 'a.ipynb', assets })
  const awareness = new Awareness(doc)
  const controller = new NotebookController({ doc, awareness, assets, readOnly: false, user: { name: 'Ana', color: '#3366ff' } })
  cleanup.push(() => {
    controller.destroy()
    if (!doc.isDestroyed) { awareness.destroy(); doc.destroy() }
  })
  return { doc, assets, awareness, controller }
}

const press = (controller: NotebookController, key: string, extra: Partial<{ shiftKey: boolean; metaKey: boolean; altKey: boolean; ctrlKey: boolean }> = {}) => controller.handleCommandKey({ key, ...extra })
const types = (controller: NotebookController) => controller.getState().cells.map((cell) => cell.type)
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose()
  clearNotebookClipboard()
})

describe('notebook controller', () => {
  it('handles Jupyter command-mode keys', async () => {
    const { controller } = await open()
    expect(types(controller)).toEqual(['code'])
    press(controller, 'b')
    press(controller, 'm')
    press(controller, 'a')
    press(controller, 'r')
    expect(types(controller)).toEqual(['code', 'raw', 'markdown'])
    expect(controller.getState().active).toBe(controller.getState().cells[1]!.key)
    // D twice deletes; once does nothing.
    press(controller, 'd')
    expect(types(controller)).toHaveLength(3)
    press(controller, 'd')
    expect(types(controller)).toEqual(['code', 'markdown'])
    press(controller, 'z')
    await flush()
    expect(types(controller)).toEqual(['code', 'raw', 'markdown'])
    press(controller, 'y')
    expect(controller.getState().mode).toBe('command')
    press(controller, 'Enter')
    expect(controller.getState().mode).toBe('edit')
    // Command keys do nothing while editing.
    expect(press(controller, 'b')).toBe(false)
  })

  it('extends the selection with Shift and acts on every selected cell', async () => {
    const { controller } = await open()
    press(controller, 'b')
    press(controller, 'b')
    press(controller, 'ArrowUp')
    press(controller, 'ArrowUp')
    press(controller, 'ArrowDown', { shiftKey: true })
    expect(controller.getState().selected).toHaveLength(2)
    press(controller, 'm')
    expect(types(controller)).toEqual(['markdown', 'markdown', 'code'])
    press(controller, 'm', { shiftKey: true })
    expect(types(controller)).toEqual(['markdown', 'code'])
    press(controller, 'a', { metaKey: true })
    expect(controller.getState().selected).toHaveLength(2)
  })

  it('advances with Shift+Enter and adds a cell after the last', async () => {
    const { controller } = await open()
    press(controller, 'Enter')
    controller.advance()
    expect(controller.getState().cells).toHaveLength(2)
    expect(controller.getState().mode).toBe('edit')
    expect(controller.getState().active).toBe(controller.getState().cells[1]!.key)
  })

  it('undoes only its own edits', async () => {
    const { doc, controller } = await open()
    const other = new Y.Doc()
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc))
    controller.insert('below', 'markdown')
    // Someone else adds text to the first cell.
    ;(orderedCells(other)[0]!.cell.get('source') as Y.Text).insert(0, 'theirs')
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other, Y.encodeStateVector(doc)))
    controller.undo()
    await flush()
    expect(controller.getState().cells).toHaveLength(1)
    expect(cellSourceText(orderedCells(doc)[0]!.cell)).toBe('theirs')
    controller.redo()
    await flush()
    expect(controller.getState().cells).toHaveLength(2)
  })

  it('copies cells into another notebook with their images', async () => {
    const from = await open(new Uint8Array(readFileSync(FIXTURE)))
    const to = await open()
    const notified = vi.fn()
    to.controller.subscribe(notified)
    expect(to.controller.getState().canPaste).toBe(false)
    const plot = from.controller.getState().cells[3]!
    from.controller.select(plot.key)
    expect(from.controller.copy()).toContain('plt.subplots')
    expect(to.controller.getState().canPaste).toBe(true)
    expect(notified).toHaveBeenCalledWith(expect.objectContaining({ canPaste: true }))
    to.awareness.setLocalStateField('user', { name: 'Ana', color: '#3366ff' })
    await to.controller.paste('below')
    const pasted = to.controller.getState().cells[1]!
    expect(pasted.outputs!.assets.length).toBeGreaterThan(0)
    const outputs = await readOutputs(pasted.outputs!, to.assets)
    expect(outputs.some((output) => output.type === 'display_data' && typeof output.data['image/png'] === 'string')).toBe(true)
  })

  it('notifies every open notebook when cut fills or clearing empties the clipboard', async () => {
    const from = await open(), a = await open(), b = await open()
    const notifyA = vi.fn(), notifyB = vi.fn()
    a.controller.subscribe(notifyA)
    b.controller.subscribe(notifyB)
    from.controller.sourceOf(from.controller.getState().active!)!.insert(0, 'cut source')
    expect(from.controller.cut()).toBe('cut source')
    for (const [target, notified] of [[a, notifyA], [b, notifyB]] as const) {
      expect(target.controller.getState().canPaste).toBe(true)
      expect(notified).toHaveBeenCalledWith(expect.objectContaining({ canPaste: true }))
      notified.mockClear()
    }
    clearNotebookClipboard()
    for (const [target, notified] of [[a, notifyA], [b, notifyB]] as const) {
      expect(target.controller.getState().canPaste).toBe(false)
      expect(notified).toHaveBeenCalledWith(expect.objectContaining({ canPaste: false }))
    }
  })

  it('stops observing clipboard changes after a notebook closes', async () => {
    const from = await open(), to = await open()
    to.controller.destroy()
    const closed = to.controller.getState()
    from.controller.copy()
    expect(to.controller.getState()).toBe(closed)
    expect(to.controller.getState().canPaste).toBe(false)
  })

  it('keeps the active cell close when it is deleted elsewhere, and shows where others are', async () => {
    const { doc, awareness, controller } = await open()
    press(controller, 'b')
    press(controller, 'b')
    const [first, second, third] = controller.getState().cells.map((cell) => cell.key)
    controller.select(second!)
    cellsMap(doc).delete(second!)
    await flush()
    expect(controller.getState().active).toBe(third)
    const peer = new Awareness(new Y.Doc())
    peer.setLocalState({ user: { name: 'Bo', color: '#ff0000' }, notebook: { cell: first, mode: 'edit' } })
    awareness.setLocalStateField('notebook', null)
    const { encodeAwarenessUpdate, applyAwarenessUpdate } = await import('y-protocols/awareness')
    applyAwarenessUpdate(awareness, encodeAwarenessUpdate(peer, [peer.clientID]), 'remote')
    expect(controller.getState().peers[first!]).toEqual([{ clientId: peer.clientID, name: 'Bo', color: '#ff0000', mode: 'edit' }])
  })

  it('ignores unknown awareness cell keys, including object prototype names', async () => {
    const { doc, awareness, controller } = await open()
    const peerDoc = new Y.Doc()
    const peer = new Awareness(peerDoc)
    try {
      for (const cell of ['__proto__', 'constructor', 'missing-cell']) {
        peer.setLocalState({ user: { name: 'Bo' }, notebook: { cell, mode: 'edit' } })
        expect(() => applyAwarenessUpdate(awareness, encodeAwarenessUpdate(peer, [peer.clientID]), 'remote')).not.toThrow()
        expect(Object.keys(controller.getState().peers)).toEqual([])
      }
      const key = controller.getState().cells[0]!.key
      peer.setLocalState({ notebook: { cell: key, mode: 'edit' } })
      applyAwarenessUpdate(awareness, encodeAwarenessUpdate(peer, [peer.clientID]), 'remote')
      expect(controller.getState().peers[key]).toHaveLength(1)
      expect(Object.getPrototypeOf(controller.getState().peers)).toBeNull()
    } finally {
      controller.destroy()
      awareness.destroy()
      peer.destroy()
      peerDoc.destroy()
      doc.destroy()
    }
  })

  it('changes nothing when read only', async () => {
    const { doc, controller } = await open()
    controller.setReadOnly(true)
    const state = Y.encodeStateAsUpdate(doc)
    for (const key of ['a', 'b', 'm', 'y', 'x', 'v', 'z', 'o']) press(controller, key)
    press(controller, 'd')
    press(controller, 'd')
    controller.setMode('edit')
    expect(controller.getState().mode).toBe('command')
    expect(Y.encodeStateAsUpdate(doc)).toEqual(state)
  })
})

describe('undo steps', () => {
  it('keeps typing and the next command as separate steps', async () => {
    const { doc, controller } = await open()
    const cell = orderedCells(doc)[0]!.cell
    ;(cell.get('source') as Y.Text).insert(0, 'print(1)')
    // Typing through a cell editor is tracked by its own origin; here the controller's.
    doc.transact(() => (cell.get('source') as Y.Text).insert(8, '!'), controller.origin)
    controller.insert('below')
    controller.undo()
    await flush()
    expect(controller.getState().cells).toHaveLength(1)
    expect(cellSourceText(orderedCells(doc)[0]!.cell)).toBe('print(1)!')
  })
})

describe('familiar notebook keys and commands', () => {
  const sources = (doc: Y.Doc) => orderedCells(doc).map(({ cell }) => cellSourceText(cell))

  it('redoes with Shift+Z, as JupyterLab does', async () => {
    const { controller } = await open()
    press(controller, 'b')
    expect(types(controller)).toHaveLength(2)
    press(controller, 'z')
    await flush()
    expect(types(controller)).toHaveLength(1)
    press(controller, 'Z', { shiftKey: true })
    await flush()
    expect(types(controller)).toHaveLength(2)
  })

  it('makes headings with 1 to 6 in one undo step', async () => {
    const { doc, controller } = await open()
    controller.sourceOf(controller.getState().active!)!.insert(0, 'Title')
    expect(press(controller, '2')).toBe(true)
    await flush()
    expect(types(controller)).toEqual(['markdown'])
    expect(sources(doc)).toEqual(['## Title'])
    press(controller, '1')
    expect(sources(doc)).toEqual(['# Title'])
    controller.undo()
    controller.undo()
    await flush()
    expect(types(controller)).toEqual(['code'])
    expect(sources(doc)).toEqual(['Title'])
    // Shift+1 types "!", which is no heading key.
    expect(press(controller, '!', { shiftKey: true })).toBe(false)
  })

  it('moves cells with Alt+arrows and Mod+Shift+arrows, and copies them with Shift+Alt+arrows', async () => {
    const { doc, controller } = await open()
    controller.sourceOf(controller.getState().active!)!.insert(0, 'a')
    controller.insert('below', 'code', { source: 'b' })
    expect(sources(doc)).toEqual(['a', 'b'])
    press(controller, 'ArrowUp', { altKey: true })
    expect(sources(doc)).toEqual(['b', 'a'])
    press(controller, 'ArrowDown', { metaKey: true, shiftKey: true })
    expect(sources(doc)).toEqual(['a', 'b'])
    press(controller, 'ArrowDown', { altKey: true, shiftKey: true })
    expect(sources(doc)).toEqual(['a', 'b', 'b'])
    expect(controller.getState().active).toBe(orderedCells(doc)[2]!.key)
  })

  it('duplicates the selection with its outputs, gives the copies new ids, and undoes in one step', async () => {
    const { doc, assets, controller } = await open(new Uint8Array(readFileSync(FIXTURE)))
    const plot = controller.getState().cells[3]!
    controller.select(plot.key)
    controller.select(controller.getState().cells[4]!.key, { extend: true })
    const before = controller.getState().cells.length
    const copies = controller.duplicate()
    expect(copies).toHaveLength(2)
    expect(controller.getState().selected).toEqual(copies)
    const written = JSON.parse(new TextDecoder().decode(await notebookCodec.exportFile(doc, { name: 'a.ipynb', assets })))
    expect(written.cells).toHaveLength(before + 2)
    expect(written.cells[5].outputs).toEqual(written.cells[3].outputs)
    expect(written.cells[6].source).toEqual(written.cells[4].source)
    expect(new Set(written.cells.map((cell: { id: string }) => cell.id)).size).toBe(written.cells.length)
    controller.undo()
    await flush()
    expect(controller.getState().cells).toHaveLength(before)
  })

  it('collapses and expands every code cell in one undo step, leaving cells without outputs alone', async () => {
    const { doc, controller } = await open(new Uint8Array(readFileSync(FIXTURE)))
    const withOutputs = orderedCells(doc).filter(({ cell }) => cell.get('cell_type') === 'code' && (cell.get('outputs') as { json: string }).json !== '[]')
    controller.insert('below', 'code')
    const code = () => controller.getState().cells.filter((cell) => cell.type === 'code')
    controller.setAllCollapsed('source', true)
    await flush()
    expect(code().every((cell) => cell.sourceCollapsed)).toBe(true)
    controller.setAllCollapsed('outputs', true)
    await flush()
    expect(code().filter((cell) => cell.outputsCollapsed)).toHaveLength(withOutputs.length)
    expect(code().find((cell) => cell.outputs?.json === '[]')!.outputsCollapsed).toBe(false)
    expect(controller.getState().cells.filter((cell) => cell.type === 'markdown').every((cell) => !cell.sourceCollapsed && !cell.outputsCollapsed)).toBe(true)
    controller.undo()
    await flush()
    expect(code().some((cell) => cell.outputsCollapsed)).toBe(false)
    expect(code().every((cell) => cell.sourceCollapsed)).toBe(true)
    controller.setAllCollapsed('source', false)
    await flush()
    expect(code().some((cell) => cell.sourceCollapsed)).toBe(false)
  })

  it('hides a cell\'s code, and undo shows it again', async () => {
    const { controller } = await open()
    controller.toggleSource()
    await flush()
    expect(controller.getState().cells[0]!.sourceCollapsed).toBe(true)
    controller.undo()
    await flush()
    expect(controller.getState().cells[0]!.sourceCollapsed).toBe(false)
  })

  it('runs Colab Ctrl+M chords in command and edit mode', async () => {
    const { doc, controller } = await open()
    controller.sourceOf(controller.getState().active!)!.insert(0, 'first')
    expect(press(controller, 'm', { ctrlKey: true })).toBe(true)
    expect(press(controller, 'b')).toBe(true)
    expect(types(controller)).toEqual(['code', 'code'])
    expect(controller.getState().mode).toBe('command')
    // The chord's D deletes at once; no second D.
    press(controller, 'm', { ctrlKey: true })
    press(controller, 'd')
    await flush()
    expect(types(controller)).toEqual(['code'])
    // While editing, the cell editor sends its keys here first; the letter is not typed.
    controller.setMode('edit')
    expect(controller.handleChordKey({ key: 'm', ctrlKey: true })).toBe(true)
    expect(controller.handleChordKey({ key: 'Shift', shiftKey: true })).toBe(false)
    expect(controller.handleChordKey({ key: 'm' })).toBe(true)
    await flush()
    expect(types(controller)).toEqual(['markdown'])
    expect(controller.getState().mode).toBe('edit')
    controller.handleChordKey({ key: 'm', ctrlKey: true })
    controller.handleChordKey({ key: 'a' })
    await flush()
    expect(types(controller)).toEqual(['code', 'markdown'])
    expect(controller.getState().mode).toBe('edit')
    expect(sources(doc)).toEqual(['', 'first'])
    // Without a pending chord, keys are the editor's.
    expect(controller.handleChordKey({ key: 'b' })).toBe(false)
  })

  it('lets a Ctrl+M chord expire', async () => {
    const { controller } = await open()
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    try {
      press(controller, 'm', { ctrlKey: true })
      now.mockReturnValue(1_000_000 + 2_000)
      // D alone is the first half of D, D again, not the chord's delete.
      expect(press(controller, 'd')).toBe(true)
      expect(types(controller)).toHaveLength(1)
    } finally {
      now.mockRestore()
    }
  })

  it('hands view commands to the view, and leaves their keys to the browser without one', async () => {
    const { controller } = await open()
    expect(press(controller, 'f', { metaKey: true })).toBe(false)
    expect(press(controller, 'L', { shiftKey: true })).toBe(false)
    const commands: string[] = []
    controller.setViewCommandHandler((command) => {
      commands.push(command)
      return true
    })
    expect(press(controller, 'f', { metaKey: true })).toBe(true)
    expect(press(controller, 'h', { ctrlKey: true })).toBe(true)
    expect(controller.handleCommandKey({ key: 'ƒ', code: 'KeyF', metaKey: true, altKey: true })).toBe(true)
    expect(press(controller, 'L', { shiftKey: true })).toBe(true)
    expect(press(controller, 'l')).toBe(false)
    expect(press(controller, 'h')).toBe(true)
    expect(press(controller, 'O', { shiftKey: true })).toBe(true)
    press(controller, 'm', { ctrlKey: true })
    press(controller, 'l')
    expect(commands).toEqual(['find', 'replace', 'replace', 'lineNumbers', 'shortcuts', 'outputScroll', 'lineNumbers'])
  })

  it('pastes cells it copied back whole, and other text as a new code cell', async () => {
    const from = await open(new Uint8Array(readFileSync(FIXTURE)))
    from.controller.select(from.controller.getState().cells[3]!.key)
    const text = from.controller.copy()
    const to = await open()
    // The system clipboard may hand the text back with Windows line breaks.
    await to.controller.pasteText(text.replace(/\n/g, '\r\n'))
    expect(to.controller.getState().cells[1]!.outputs!.assets.length).toBeGreaterThan(0)
    await to.controller.pasteText('print("from elsewhere")\r\n')
    expect(to.controller.getState().cells).toHaveLength(3)
    const added = to.controller.getState().cells[2]!
    expect(added.type).toBe('code')
    expect(cellSourceText(cellsMap(to.doc).get(added.key)!)).toBe('print("from elsewhere")\n')
    to.controller.undo()
    await flush()
    expect(to.controller.getState().cells).toHaveLength(2)
  })

  it('converges when two collaborators duplicate, make headings, and hide code at once', async () => {
    const a = await open()
    const b = new Y.Doc()
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a.doc))
    const awareness = new Awareness(b)
    const other = new NotebookController({ doc: b, awareness, assets: a.assets, readOnly: false, user: { name: 'Bo', color: '#ff0000' } })
    cleanup.push(() => { other.destroy(); awareness.destroy(); b.destroy() })
    const sync = () => {
      Y.applyUpdate(b, Y.encodeStateAsUpdate(a.doc, Y.encodeStateVector(b)))
      Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a.doc)))
    }
    a.controller.sourceOf(a.controller.getState().active!)!.insert(0, 'Intro')
    sync()
    await flush()
    a.controller.setHeading(1)
    other.duplicate()
    other.toggleSource()
    sync()
    await flush()
    expect(sources(a.doc)).toEqual(sources(b))
    expect(a.controller.getState().cells.map((cell) => [cell.type, cell.sourceCollapsed])).toEqual(other.getState().cells.map((cell) => [cell.type, cell.sourceCollapsed]))
    expect(a.controller.getState().cells).toHaveLength(2)
    // Undo takes back each session's own edits only.
    other.undo()
    other.undo()
    sync()
    await flush()
    expect(a.controller.getState().cells).toHaveLength(1)
    expect(sources(a.doc)).toEqual(['# Intro'])
    expect(sources(b)).toEqual(['# Intro'])
  })
})
