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
import { cellAttachments, cellSourceText, metadataValue, cellMetadata, orderedCells, outputsCollapsed, sourceCollapsed } from './layout.js'
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

  it.each(['markdown', 'raw'] as const)('preserves %s attachments when splitting and merging', async (type) => {
    const { doc, assets } = await notebookDoc([{ type, source: 'intro\n![plot](attachment:plot.svg)\nend' }])
    const first = orderedCells(doc)[0]!
    const attachments = { json: '{"plot.svg":{"image/svg+xml":"<svg/>"}}', assets: [] }
    first.cell.set('attachments', attachments)
    const pieces = splitCell(doc, first.key, [6, 34])
    expect(orderedCells(doc).map(({ cell }) => cellAttachments(cell))).toEqual(pieces.map(() => attachments))
    mergeCells(doc, pieces)
    const file = JSON.parse(new TextDecoder().decode(await notebookCodec.exportFile(doc, { name: 'a.ipynb', assets })))
    expect(file.cells[0].attachments).toEqual(JSON.parse(attachments.json))
    doc.destroy()
  })

  it.each(['markdown', 'raw'] as const)('merges %s attachments with first names winning and slots renumbered', async (type) => {
    const { doc, assets } = await notebookDoc(Array.from({ length: 3 }, () => ({ type, source: '![plot](attachment:plot.svg)' })))
    const cells = orderedCells(doc)
    const hash = (await assets.put(new TextEncoder().encode('"<svg/>"'), 'application/json')).hash
    for (let index = 0; index < cells.length; index += 1) {
      cells[index]!.cell.set('attachments', {
        json: `{"plot.svg":{"text/plain":${index}.0},"image${index}.svg":{"image/svg+xml":"\\u0000pulpo-asset:0","application/json":1e-05}}`,
        assets: [{ hash, kind: 'json' }],
      })
    }
    mergeCells(doc, cells.map(({ key }) => key))
    const blob = cellAttachments(orderedCells(doc)[0]!.cell)!
    expect(blob.assets).toHaveLength(3)
    expect(blob.json).toContain('"text/plain":0.0')
    expect(blob.json.match(/1e-05/g)).toHaveLength(3)
    const file = JSON.parse(new TextDecoder().decode(await notebookCodec.exportFile(doc, { name: 'a.ipynb', assets })))
    expect(file.cells[0].attachments['plot.svg']['text/plain']).toBe(0)
    for (let index = 0; index < 3; index += 1) expect(file.cells[0].attachments[`image${index}.svg`]['image/svg+xml']).toBe('<svg/>')
    doc.destroy()
  })

  it('merges large imported attachment bundles while keeping their names and nested assets', async () => {
    const doc = new Y.Doc()
    const assets = new MemoryLiveAssetStore()
    const context = { name: 'a.ipynb', assets }
    const attachment = (letter: string) => ({ 'application/json': [letter.repeat(20_000), ...new Array(10_000).fill(0)] })
    const attachments = [{ first: attachment('a') }, { second: attachment('b') }]
    await notebookCodec.importFile(doc, new TextEncoder().encode(JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: attachments.map((value, index) => ({ id: String(index), cell_type: 'markdown', source: '', metadata: {}, attachments: value })) })), context)
    mergeCells(doc, orderedCells(doc).map(({ key }) => key))
    const result = JSON.parse(new TextDecoder().decode(await notebookCodec.exportFile(doc, context)))
    expect(result.cells[0].attachments).toEqual({ ...attachments[0], ...attachments[1] })
    doc.destroy()
  })

  it('does not add attachments when merged text cells had none', async () => {
    const { doc } = await notebookDoc([{ type: 'markdown', source: 'a' }, { type: 'raw', source: 'b' }])
    mergeCells(doc, orderedCells(doc).map(({ key }) => key))
    expect(orderedCells(doc)[0]!.cell.has('attachments')).toBe(false)
    doc.destroy()
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

  it.each(['markdown', 'raw'] as const)('counts attachment-only edits in %s cells, including moved cells', (cell_type) => {
    const cell = (image: string) => ({ id: 'image', cell_type, source: '![plot](attachment:plot.svg)', metadata: {}, attachments: { 'plot.svg': { 'image/svg+xml': image } } })
    const before = file([cell('<svg>old</svg>'), md('b', 'b'), md('c', 'c')])
    expect(diffNotebookFiles(before, before).cells[0]!.kind).toBe('unchanged')
    const changed = diffNotebookFiles(before, file([cell('<svg>new</svg>'), md('b', 'b'), md('c', 'c')]))
    expect(changed.cells[0]).toMatchObject({ kind: 'changed', sourceChanged: false, outputsChanged: false, attachmentsChanged: true })
    expect(changed.counts.changed).toBe(1)
    const moved = diffNotebookFiles(before, file([md('b', 'b'), md('c', 'c'), cell('<svg>new</svg>')]))
    expect(moved.cells[2]).toMatchObject({ moved: true, attachmentsChanged: true })
    expect(moved.counts).toMatchObject({ changed: 1, moved: 1, outputs: 0 })
    const removed = diffNotebookFiles(file([cell('<svg/>')]), file([{ ...cell('<svg/>'), attachments: undefined }]))
    expect(removed.cells[0]).toMatchObject({ kind: 'changed', attachmentsChanged: true })
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

describe('third review regressions', () => {
  it('keeps placeholder-like text in attachments literal when merging', async () => {
    const { doc } = await notebookDoc([{ type: 'markdown', source: 'a' }, { type: 'markdown', source: 'b' }])
    const [first, second] = orderedCells(doc)
    first!.cell.set('attachments', { json: '{"note.txt":{"text/plain":"\\u0000pulpo-asset:not-a-slot"}}', assets: [] })
    second!.cell.set('attachments', { json: '{"x.txt":{"text/plain":"plain"}}', assets: [] })
    mergeCells(doc, [first!.key, second!.key])
    const merged = orderedCells(doc)[0]!.cell.get('attachments') as { json: string }
    expect(merged.json).toContain('\\u0000pulpo-asset:not-a-slot')
    expect(merged.json).toContain('x.txt')
  })

  it('reports changed JSON arrays in attachments', () => {
    const file = (value: unknown) => new TextEncoder().encode(JSON.stringify({ cells: [{ cell_type: 'markdown', id: 'm', metadata: {}, source: 'x', attachments: { 'd.json': { 'application/json': value } } }], metadata: {}, nbformat: 4, nbformat_minor: 5 }))
    expect(diffNotebookFiles(file([1]), file([2])).counts.changed).toBe(1)
  })
  it('leaves cells apart rather than mix literal placeholder text with real attachment slots', async () => {
    const { doc } = await notebookDoc([{ type: 'markdown', source: 'a' }, { type: 'markdown', source: 'b' }])
    const [first, second] = orderedCells(doc)
    first!.cell.set('attachments', { json: '{"note.txt":{"text/plain":"\\u0000pulpo-asset:0"}}', assets: [] })
    second!.cell.set('attachments', { json: '{"p.png":{"image/png":"\\u0000pulpo-asset:0"}}', assets: [{ hash: 'a'.repeat(64), kind: 'base64', mimeType: 'image/png', trail: '', wrap: 0 }] })
    expect(mergeCells(doc, [first!.key, second!.key])).toBeNull()
    expect(orderedCells(doc)).toHaveLength(2)
  })
})

it.each(['code', 'markdown', 'raw'])('reports %s cell metadata-only proposals and preserves them when applied', async (cell_type) => {
  const cell = { cell_type, id: 'metadata', source: 'same source', metadata: { tags: ['before'], jupyter: { source_hidden: false } },
    ...cell_type === 'code' ? { execution_count: null, outputs: [] } : {} }
  const file = (metadata: unknown) => new TextEncoder().encode(JSON.stringify({ cells: [{ ...cell, metadata }], metadata: {}, nbformat: 4, nbformat_minor: 5 }))
  const before = file(cell.metadata)
  const after = file({ tags: ['after'], jupyter: { source_hidden: true }, custom: 1 })
  const diff = diffNotebookFiles(before, after)
  expect(diff.counts.changed).toBe(1)
  expect(diff.cells[0]).toMatchObject({ kind: 'changed', metadata: ['custom', 'jupyter', 'tags'], sourceChanged: false })
  const doc = new Y.Doc()
  const context = { name: 'metadata.ipynb', assets: new MemoryLiveAssetStore() }
  try {
    await notebookCodec.importFile(doc, before, context)
    expect(await notebookCodec.applyFile(doc, after, context)).toMatchObject({ changed: true })
    const exported = JSON.parse(new TextDecoder().decode(await notebookCodec.exportFile(doc, context)))
    expect(exported.cells[0].metadata).toEqual({ tags: ['after'], jupyter: { source_hidden: true }, custom: 1 })
    expect(await notebookCodec.applyFile(doc, after, context)).toMatchObject({ changed: false })
  } finally {
    doc.destroy()
  }
})

it.each(['replace', 'append', 'remove'])('detects %s of outputs past the display limit and applies the complete data', async (operation) => {
  const outputs = Array.from({ length: 1_001 }, (_, index) => ({ output_type: 'display_data', metadata: {}, data: { 'text/plain': String(index) } }))
  const file = (outputs: unknown[]) => new TextEncoder().encode(JSON.stringify({ cells: [{ cell_type: 'code', id: 'a', source: '', metadata: {}, execution_count: null, outputs }], metadata: {}, nbformat: 4, nbformat_minor: 5 }))
  const changed = outputs.slice()
  if (operation === 'replace') changed[1_000] = { ...outputs[1_000]!, data: { 'text/plain': 'replacement' } }
  else if (operation === 'append') changed.push({ ...outputs[1_000]!, data: { 'text/plain': 'appended' } })
  else changed.pop()
  const before = file(outputs), after = file(changed)
  const diff = diffNotebookFiles(before, after)
  expect(diff.counts.outputs).toBe(1)
  expect(diff.cells[0]).toMatchObject({ kind: 'changed', outputsChanged: true })
  if (diff.cells[0]!.kind !== 'removed') expect(diff.cells[0]!.after.outputs.length).toBeLessThanOrEqual(1_000)
  const doc = new Y.Doc()
  const context = { name: 'outputs.ipynb', assets: new MemoryLiveAssetStore() }
  try {
    await notebookCodec.importFile(doc, before, context)
    expect(await notebookCodec.applyFile(doc, after, context)).toMatchObject({ changed: true })
    const exported = JSON.parse(new TextDecoder().decode(await notebookCodec.exportFile(doc, context)))
    expect(exported.cells[0].outputs).toEqual(changed)
    expect(await notebookCodec.applyFile(doc, after, context)).toMatchObject({ changed: false })
  } finally {
    doc.destroy()
  }
})
