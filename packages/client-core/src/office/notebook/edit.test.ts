import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { MemoryLiveAssetStore } from '../assets.js'
import { notebookCodec } from './codec.js'
import { diffNotebookFiles } from './diff.js'
import {
  cellInitOf,
  clearOutputs,
  insertCells,
  mergeCells,
  moveCells,
  setOutputsCollapsed,
  setSourceCollapsed,
  shiftCells,
  splitCell,
} from './edit.js'
import { cellSourceText, metadataValue, cellMetadata, orderedCells, outputsCollapsed, sourceCollapsed } from './layout.js'
import { initialOrderKeys, isOrderKey, orderKeyBetween, orderKeysBetween } from './order.js'

describe('order keys', () => {
  it('always fit between two keys, at the ends, and in runs', () => {
    let seed = 1
    const random = () => {
      seed = (seed * 16_807) % 2_147_483_647
      return seed / 2_147_483_647
    }
    const keys = initialOrderKeys(50, random)
    expect([...keys].sort()).toEqual(keys)
    for (let round = 0; round < 2_000; round += 1) {
      const index = Math.floor(random() * (keys.length + 1))
      const key = orderKeyBetween(keys[index - 1] ?? null, keys[index] ?? null, random)
      expect(isOrderKey(key)).toBe(true)
      if (index > 0) expect(key > keys[index - 1]!).toBe(true)
      if (index < keys.length) expect(key < keys[index]!).toBe(true)
      keys.splice(index, 0, key)
    }
    // Inserting at one place over and over keeps keys short enough.
    let before = 'V'
    for (let round = 0; round < 500; round += 1) before = orderKeyBetween('U', before, random)
    expect(before.length).toBeLessThan(600)
    const run = orderKeysBetween('a', 'b', 20, random)
    expect([...run].sort()).toEqual(run)
    expect(run.every((key) => key > 'a' && key < 'b')).toBe(true)
  })

  it('gives concurrent inserts at the same place different keys', () => {
    const keys = new Set(Array.from({ length: 200 }, () => orderKeyBetween('a', 'b')))
    expect(keys.size).toBeGreaterThan(195)
  })

  it('places keys after malformed ones instead of failing', () => {
    expect(orderKeyBetween('~~', null) > '~~').toBe(true)
    expect(orderKeyBetween('b', 'a') > 'b').toBe(true)
  })
})

async function notebookDoc(cells: { type: 'code' | 'markdown' | 'raw'; source: string }[]) {
  const doc = new Y.Doc()
  const assets = new MemoryLiveAssetStore()
  await notebookCodec.createEmpty(doc, { name: 'a.ipynb', assets })
  doc.getMap('cells').clear()
  insertCells(doc, { before: null }, cells)
  return { doc, assets }
}

const sources = (doc: Y.Doc) => orderedCells(doc).map(({ cell }) => cellSourceText(cell))

describe('cell edits', () => {
  it('splits a cell at the cursor and merges cells back', async () => {
    const { doc } = await notebookDoc([{ type: 'code', source: 'a = 1\nb = 2\nc = 3' }])
    const [key] = orderedCells(doc).map((entry) => entry.key)
    const pieces = splitCell(doc, key!, [6, 12])
    expect(sources(doc)).toEqual(['a = 1', 'b = 2', 'c = 3'])
    mergeCells(doc, pieces)
    expect(sources(doc)).toEqual(['a = 1\n\nb = 2\n\nc = 3'])
  })

  it('moves cells up, down, and to a place', async () => {
    const { doc } = await notebookDoc(['1', '2', '3', '4'].map((source) => ({ type: 'code' as const, source })))
    const keys = orderedCells(doc).map((entry) => entry.key)
    shiftCells(doc, [keys[0]!], 'up')
    expect(sources(doc)).toEqual(['1', '2', '3', '4'])
    shiftCells(doc, [keys[0]!, keys[1]!], 'down')
    expect(sources(doc)).toEqual(['3', '1', '2', '4'])
    moveCells(doc, [keys[3]!], { after: null })
    expect(sources(doc)).toEqual(['4', '3', '1', '2'])
    moveCells(doc, [keys[3]!, keys[2]!], { before: null })
    expect(sources(doc)).toEqual(['1', '2', '4', '3'])
  })

  it('collapses outputs and sources as JupyterLab records it', async () => {
    const { doc } = await notebookDoc([{ type: 'code', source: 'x' }])
    const { key, cell } = orderedCells(doc)[0]!
    setOutputsCollapsed(doc, [key], true)
    setSourceCollapsed(doc, [key], true)
    expect(outputsCollapsed(cell)).toBe(true)
    expect(sourceCollapsed(cell)).toBe(true)
    expect(metadataValue(cellMetadata(cell), 'jupyter')).toEqual({ outputs_hidden: true, source_hidden: true })
    expect(metadataValue(cellMetadata(cell), 'collapsed')).toBe(true)
    setOutputsCollapsed(doc, [key], false)
    setSourceCollapsed(doc, [key], false)
    expect(cellMetadata(cell)!.size).toBe(0)
  })

  it('copies cells with their outputs but not their ids', async () => {
    const doc = new Y.Doc()
    const assets = new MemoryLiveAssetStore()
    await notebookCodec.importFile(doc, new Uint8Array(readFileSync(join(import.meta.dirname, 'fixtures/generated-analysis.ipynb'))), { name: 'a.ipynb', assets })
    const source = orderedCells(doc)[3]!
    const copy = cellInitOf(source.cell)
    expect(copy.id).toBeUndefined()
    const [pasted] = insertCells(doc, { after: source.key }, [copy])
    const written = JSON.parse(new TextDecoder().decode(await notebookCodec.exportFile(doc, { name: 'a.ipynb', assets })))
    expect(written.cells[4].outputs).toEqual(written.cells[3].outputs)
    expect(written.cells[4].id).toBe(pasted!.slice(0, 8))
    clearOutputs(doc, [pasted!])
    expect(JSON.parse(new TextDecoder().decode(await notebookCodec.exportFile(doc, { name: 'a.ipynb', assets }))).cells[4].outputs).toEqual([])
  })
})

describe('notebook diff', () => {
  const file = (cells: unknown[]) => new TextEncoder().encode(JSON.stringify({ cells, metadata: { kernelspec: { name: 'python3' } }, nbformat: 4, nbformat_minor: 5 }))
  const code = (id: string, source: string, outputs: unknown[] = []) => ({ cell_type: 'code', execution_count: null, id, metadata: {}, outputs, source })
  const md = (id: string, source: string) => ({ cell_type: 'markdown', id, metadata: {}, source })

  it('lists added, removed, moved, and edited cells in the new order', () => {
    const before = file([md('a', '# Title'), code('b', 'x = 1'), code('c', 'y = 2'), code('d', 'plot()')])
    const after = file([md('a', '# Title'), code('d', 'plot()'), code('b', 'x = 10'), code('e', 'new()', [{ name: 'stdout', output_type: 'stream', text: 'hello\nworld' }])])
    const diff = diffNotebookFiles(before, after)
    expect(diff.cells.map((cell) => cell.kind)).toEqual(['unchanged', 'moved', 'changed', 'removed', 'added'])
    expect(diff.counts).toEqual({ added: 1, removed: 1, changed: 1, moved: 1, outputs: 0 })
    const changed = diff.cells[2]!
    expect(changed.kind === 'changed' && changed.source).toEqual([{ kind: 'removed', text: 'x = 1' }, { kind: 'added', text: 'x = 10' }])
    const added = diff.cells[4]!
    expect(added.kind === 'added' && added.after.outputs).toEqual([{ kind: 'stdout', text: 'hello' }])
  })

  it('summarizes output changes and metadata', () => {
    const before = file([code('a', 'run()')])
    const after = new TextEncoder().encode(JSON.stringify({
      cells: [{ ...code('a', 'run()', [{ ename: 'KeyError', evalue: "'x'", output_type: 'error', traceback: [] }]), execution_count: 3 }],
      metadata: { kernelspec: { name: 'ir' } }, nbformat: 4, nbformat_minor: 5,
    }))
    const diff = diffNotebookFiles(before, after)
    expect(diff.cells[0]).toMatchObject({ kind: 'changed', sourceChanged: false, outputsChanged: true, after: { executionCount: 3, outputs: [{ kind: 'error', text: "KeyError: 'x'" }] } })
    expect(diff.counts.outputs).toBe(1)
    expect(diff.metadata).toEqual(['kernelspec'])
  })
})

describe('order keys from other clients', () => {
  it('end even when a neighbour ends in the lowest digit', () => {
    for (const [before, after] of [[null, '0'], ['1', '10'], ['V', 'V0'], ['', '00']] as const) {
      const key = orderKeyBetween(before, after)
      expect(key > (before ?? '')).toBe(true)
    }
  })
})

describe('order keys when appending', () => {
  it('stay short over a thousand appends', () => {
    let last: string | null = null
    for (let index = 0; index < 1_000; index += 1) {
      const next = orderKeyBetween(last, null)
      if (last) expect(next > last).toBe(true)
      last = next
    }
    expect(last!.length).toBeLessThan(60)
  })
})
