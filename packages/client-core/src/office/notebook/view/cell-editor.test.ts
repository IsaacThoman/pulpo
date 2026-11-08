// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { MemoryLiveAssetStore } from '../../assets.js'
import { notebookCodec } from '../codec.js'
import { cellSource, cellType, cellsMap, orderedCells } from '../layout.js'
import { createCellEditor, type CellEditor, type CellEditorOptions } from './cell-editor.js'

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
const cleanup: Array<() => void> = []
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose() })

function editor(doc: Y.Doc, readOnly = false, options: Partial<CellEditorOptions> = {}): CellEditor {
  const awareness = new Awareness(doc)
  const undoManager = new Y.UndoManager(cellsMap(doc))
  const container = document.createElement('div')
  document.body.append(container)
  const cell = createCellEditor({ container, text: cellSource(orderedCells(doc)[0]!.cell)!, awareness, undoManager, type: cellType(orderedCells(doc)[0]!.cell), language: '', readOnly, ...options })
  cleanup.push(() => { cell.destroy(); undoManager.destroy(); awareness.destroy(); container.remove() })
  return cell
}

async function notebook(source: string) {
  const doc = new Y.Doc()
  cleanup.push(() => doc.destroy())
  const context = { name: 'breaks.ipynb', assets: new MemoryLiveAssetStore() }
  const bytes = new TextEncoder().encode(JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [{ cell_type: 'code', id: 'a', metadata: {}, execution_count: null, outputs: [], source }] }))
  await notebookCodec.importFile(doc, bytes, context)
  return { doc, context, bytes }
}

const text = (doc: Y.Doc) => cellSource(orderedCells(doc)[0]!.cell)!
const exchange = (a: Y.Doc, b: Y.Doc) => {
  const toA = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a))
  const toB = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b))
  Y.applyUpdate(a, toA)
  Y.applyUpdate(b, toB)
}

describe('cell source offsets', () => {
  it.each(['a\r\nb', 'a\rb', 'a\r\nb\rc\nd'])('keeps source offsets and unedited bytes for %j', async (source) => {
    const { doc, context, bytes } = await notebook(source)
    const cell = editor(doc)
    expect(cell.view.state.doc.toString()).toBe(source)
    expect(cell.view.state.doc.length).toBe(text(doc).length)
    expect(await notebookCodec.exportFile(doc, context)).toEqual(bytes)
    cell.view.dispatch({ changes: { from: cell.view.state.doc.length, insert: '!' } })
    expect(text(doc).toString()).toBe(`${source}!`)
    expect(cell.view.state.doc.toString()).toBe(`${source}!`)
    // Pasted and remote carriage returns must keep their own offsets too.
    cell.view.dispatch({ changes: { from: 0, insert: 'p\r\nq\r' } })
    expect(cell.view.state.doc.toString()).toBe(`p\r\nq\r${source}!`)
    expect(text(doc).toString()).toBe(cell.view.state.doc.toString())
    text(doc).insert(0, 'remote\r\n')
    expect(cell.view.state.doc.toString()).toBe(text(doc).toString())
    const exported = JSON.parse(new TextDecoder().decode(await notebookCodec.exportFile(doc, context)))
    expect(exported.cells[0].source).toBe(`remote\r\np\r\nq\r${source}!`)
  })

  it('converges when two replicas edit after CRLFs concurrently', async () => {
    const source = 'alpha\r\nbeta\r\ngamma'
    const { doc: a, context } = await notebook(source)
    const b = new Y.Doc()
    cleanup.push(() => b.destroy())
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    const left = editor(a), right = editor(b)
    left.view.dispatch({ changes: { from: left.view.state.doc.length, insert: '!' } })
    const beta = right.view.state.doc.toString().indexOf('beta')
    right.view.dispatch({ changes: { from: beta, to: beta + 4, insert: 'BETA' } })
    exchange(a, b)
    const expected = 'alpha\r\nBETA\r\ngamma!'
    for (const [doc, cell] of [[a, left], [b, right]] as const) {
      expect(text(doc).toString()).toBe(expected)
      expect(cell.view.state.doc.toString()).toBe(expected)
      expect(cell.view.state.doc.length).toBe(text(doc).length)
    }
    expect(await notebookCodec.exportFile(a, context)).toEqual(await notebookCodec.exportFile(b, context))
    const exported = JSON.parse(new TextDecoder().decode(await notebookCodec.exportFile(a, context)))
    expect(exported.cells[0].source).toBe(expected)
  })
})

/** A keydown as the keyboard sends it to the focused cell. */
function press(cell: CellEditor, key: string, modifiers: Partial<Pick<KeyboardEventInit, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'code'>> = {}): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })
  cell.view.contentDOM.dispatchEvent(event)
  return event.defaultPrevented
}

describe('cell view options', () => {
  it('shows line numbers when asked, and hides them again', async () => {
    const { doc } = await notebook('a\nb\nc')
    const cell = editor(doc, false, { lineNumbers: true })
    expect(cell.view.dom.querySelector('.cm-lineNumbers')).toBeTruthy()
    cell.setLineNumbers(false)
    expect(cell.view.dom.querySelector('.cm-lineNumbers')).toBeNull()
    cell.setLineNumbers(true)
    expect(cell.view.dom.querySelectorAll('.cm-lineNumbers .cm-gutterElement').length).toBeGreaterThan(0)
  })

  it('wraps code cells when asked, through type changes, and goes back to wrapping by type', async () => {
    const { doc } = await notebook('x = 1')
    const cell = editor(doc)
    const wrapped = () => cell.view.contentDOM.classList.contains('cm-lineWrapping')
    expect(wrapped()).toBe(false)
    cell.setWrap(true)
    expect(wrapped()).toBe(true)
    cell.setType('code', 'python')
    expect(wrapped()).toBe(true)
    cell.setWrap(null)
    expect(wrapped()).toBe(false)
    cell.setType('markdown', 'python')
    expect(wrapped()).toBe(true)
  })
})

describe('cell keys', () => {
  it('gives the host every key first, so Ctrl+M chords neither type nor toggle tab focus', async () => {
    const { doc } = await notebook('x')
    const seen: string[] = []
    let pending = false
    const cell = editor(doc, false, {
      onKeyDown: (event) => {
        seen.push(event.key)
        if (event.ctrlKey && event.key === 'm') return (pending = true)
        if (pending && event.key !== 'Shift') {
          pending = false
          return true
        }
        return false
      },
    })
    expect(press(cell, 'm', { ctrlKey: true })).toBe(true)
    expect(press(cell, 'b')).toBe(true)
    // CodeMirror's Ctrl+M tab focus mode stayed off: Tab still indents.
    cell.view.focus()
    expect(press(cell, 'Tab')).toBe(true)
    expect(cell.view.state.doc.toString()).toBe('    x')
    expect(seen).toEqual(['m', 'b', 'Tab'])
  })

  it('opens the notebook\'s find instead of the cell\'s own panel', async () => {
    const { doc } = await notebook('x')
    const commands: string[] = []
    const cell = editor(doc, false, { onFind: (command) => commands.push(command) })
    expect(press(cell, 'f', { ctrlKey: true })).toBe(true)
    expect(press(cell, 'h', { ctrlKey: true })).toBe(true)
    expect(press(cell, 'g', { ctrlKey: true })).toBe(true)
    expect(press(cell, 'F3', { shiftKey: true })).toBe(true)
    expect(commands).toEqual(['find', 'replace', 'next', 'previous'])
    expect(cell.view.dom.querySelector('.cm-search')).toBeNull()
  })

  it('opens the cell\'s find and replace with Ctrl+H when the host has no find of its own', async () => {
    const { doc } = await notebook('needle')
    const cell = editor(doc)
    cell.view.dispatch({ selection: { anchor: 0, head: 6 } })
    expect(press(cell, 'h', { ctrlKey: true })).toBe(true)
    expect(document.activeElement).toBe(cell.view.dom.querySelector('.cm-search input[name=replace]'))
  })
})

describe('find matches in a cell', () => {
  it('marks matches and the current one, following edits', async () => {
    const { doc } = await notebook('cat cat cat')
    const cell = editor(doc)
    cell.setSearchMatches([{ from: 0, to: 3 }, { from: 4, to: 7 }, { from: 8, to: 30 }], 1)
    const marks = () => [...cell.view.contentDOM.querySelectorAll('.cm-searchMatch')].map((node) => [node.textContent, node.classList.contains('cm-searchMatch-selected')])
    // A range past the end (a stale match) is left out.
    expect(marks()).toEqual([['cat', false], ['cat', true]])
    text(doc).insert(0, '> ')
    expect(marks()).toEqual([['cat', false], ['cat', true]])
    cell.select(6, 9)
    expect(cell.view.state.selection.main).toMatchObject({ from: 6, to: 9 })
    cell.setSearchMatches([], -1)
    expect(marks()).toEqual([])
  })
})
