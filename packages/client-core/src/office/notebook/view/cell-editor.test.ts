// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { MemoryLiveAssetStore } from '../../assets.js'
import { notebookCodec } from '../codec.js'
import { cellSource, cellType, cellsMap, orderedCells } from '../layout.js'
import { createCellEditor, type CellEditor } from './cell-editor.js'

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
const cleanup: Array<() => void> = []
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose() })

function editor(doc: Y.Doc, readOnly = false): CellEditor {
  const awareness = new Awareness(doc)
  const undoManager = new Y.UndoManager(cellsMap(doc))
  const container = document.createElement('div')
  document.body.append(container)
  const cell = createCellEditor({ container, text: cellSource(orderedCells(doc)[0]!.cell)!, awareness, undoManager, type: cellType(orderedCells(doc)[0]!.cell), language: '', readOnly })
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
