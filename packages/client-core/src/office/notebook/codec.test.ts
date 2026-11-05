import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { MemoryLiveAssetStore } from '../assets.js'
import { LiveFormatError } from '../live-format.js'
import { notebookCodec } from './codec.js'
import { clearOutputs, deleteCells, insertCells, moveCells, setCellType, shiftCells } from './edit.js'
import { ASSET_MARKER, NOTEBOOK_MAX_FILE_BYTES, cellOutputs, cellSourceText, cellType, notebookMap, orderedCells } from './layout.js'

const FIXTURES = join(import.meta.dirname, 'fixtures')
const fixture = (name: string) => new Uint8Array(readFileSync(join(FIXTURES, name)))
const utf8 = (text: string) => new TextEncoder().encode(text)
const text = (bytes: Uint8Array) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)

async function imported(bytes: Uint8Array, assets = new MemoryLiveAssetStore()) {
  const doc = new Y.Doc()
  await notebookCodec.importFile(doc, bytes, { name: 'nb.ipynb', assets })
  return { doc, assets, context: { name: 'nb.ipynb', assets } }
}

/** A second replica, as a client receives the document. */
function replica(doc: Y.Doc): Y.Doc {
  const copy = new Y.Doc()
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc))
  return copy
}

function sync(...docs: Y.Doc[]): void {
  for (const from of docs) for (const to of docs) if (from !== to) Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)))
}

/** A notebook as Jupyter writes it (sorted keys, one-space indent, a trailing newline). */
function jupyter(notebook: unknown): Uint8Array {
  return utf8(`${pyDumps(notebook, 1, 0)}\n`)
}

/** `json.dumps(value, sort_keys=True, indent=indent, ensure_ascii=False)`, for building fixtures. */
function pyDumps(value: unknown, indent: number, depth: number): string {
  const pad = (level: number) => `\n${' '.repeat(indent * level)}`
  if (Array.isArray(value)) {
    if (!value.length) return '[]'
    return `[${value.map((item) => pad(depth + 1) + pyDumps(item, indent, depth + 1)).join(',')}${pad(depth)}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1))
    if (!entries.length) return '{}'
    return `{${entries.map(([key, item]) => `${pad(depth + 1)}${JSON.stringify(key)}: ${pyDumps(item, indent, depth + 1)}`).join(',')}${pad(depth)}}`
  }
  return JSON.stringify(value)
}

const lines = (source: string) => source.split(/(?<=\n)/).filter(Boolean)

function notebook(cells: unknown[], extra: Record<string, unknown> = {}) {
  return {
    cells,
    metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' }, language_info: { name: 'python' } },
    nbformat: 4,
    nbformat_minor: 5,
    ...extra,
  }
}

const code = (id: string, source: string, outputs: unknown[] = [], count: number | null = null) => ({
  cell_type: 'code', execution_count: count, id, metadata: {}, outputs, source: lines(source),
})
const markdown = (id: string, source: string) => ({ cell_type: 'markdown', id, metadata: {}, source: lines(source) })

// A 1×1 PNG, repeated into a larger image-shaped payload so it is stored as an asset.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const BIG_PNG = (() => {
  const bytes = new Uint8Array(6_000)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 37) % 251
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
})()

describe('notebook round trips', () => {
  const fixtures = readdirSync(FIXTURES).filter((name) => name.endsWith('.ipynb') && !name.includes('test3'))
  // Hand-edited after Jupyter wrote it (a list on one line): exact only through the kept original.
  const handEdited = new Set(['ipywidgets-widget-basics.ipynb'])
  it.each(fixtures)('writes %s back byte for byte', async (name) => {
    const bytes = fixture(name)
    const { doc, context } = await imported(bytes)
    if (handEdited.has(name)) expect(notebookMap(doc).get('original')).toBeDefined()
    else expect(notebookMap(doc).get('original'), 'the serializer reproduces the file by itself').toBeUndefined()
    expect(await notebookCodec.exportFile(replica(doc), context)).toEqual(bytes)
  })

  it('upgrades nbformat 3 and still exports the unedited file as it was', async () => {
    const bytes = fixture('nbformat-test3.ipynb')
    const { doc, context } = await imported(bytes)
    expect(notebookMap(doc).get('nbformat')).toBe(4)
    expect(notebookMap(doc).get('nbformat_minor')).toBe(5)
    expect(await notebookCodec.exportFile(doc, context)).toEqual(bytes)
    const first = orderedCells(doc)[0]!.cell
    ;(first.get('source') as Y.Text).insert(0, 'x')
    const edited = JSON.parse(text(await notebookCodec.exportFile(doc, context)))
    expect(edited.nbformat).toBe(4)
    expect(edited.worksheets).toBeUndefined()
    expect(edited.cells.every((cell: { id?: string }) => typeof cell.id === 'string')).toBe(true)
    expect(edited.metadata.orig_nbformat).toBe(3)
    // Heading cells became Markdown, prompt numbers execution counts, pyout execute_result.
    expect(edited.cells.some((cell: { cell_type: string; source: string[] }) => cell.cell_type === 'markdown' && cell.source.join('').startsWith('#'))).toBe(true)
    const outputs = edited.cells.flatMap((cell: { outputs?: { output_type: string }[] }) => cell.outputs ?? [])
    expect(outputs.map((output: { output_type: string }) => output.output_type)).not.toContain('pyout')
  })

  const layouts: [string, string][] = [
    ['compact JSON', JSON.stringify(notebook([code('a', 'print(1)\n'), markdown('b', '# Hi')]))],
    ['two-space indent in insertion order', `${JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: { z: 1, a: 2 }, cells: [{ id: 'a', cell_type: 'code', source: ['x = 1'], metadata: {}, outputs: [], execution_count: null }] }, null, 2)}`],
    ['CRLF line breaks', text(jupyter(notebook([code('a', 'x\n')]))).replace(/\n/g, '\r\n')],
    ['a byte order mark', `﻿${text(jupyter(notebook([code('a', 'x')])))}`],
    ['ensure_ascii escapes', text(jupyter(notebook([markdown('a', 'café 😀')]))).replace('café 😀', '\\u00e9').replace('caf\\u00e9', 'caf\\u00e9 \\ud83d\\ude00')],
    ['Python 2 separators', '{\n "cells": [], \n "metadata": {}, \n "nbformat": 4, \n "nbformat_minor": 0\n}'],
    ['numbers as Python writes them', text(jupyter(notebook([code('a', 'x', [], 3)], { metadata: { ratio: 1e-5, whole: 1.0, big: 2 ** 70 } }))).replace('"ratio": 0.00001', '"ratio": 1e-05').replace('"whole": 1', '"whole": 1.0')],
    ['integer-like keys and unknown fields', text(jupyter({ ...notebook([{ ...code('a', 'x'), custom: { '10': 1, '2': 2 } }]), extra_top: [1, 2] }))],
    ['indent=0', '{\n"cells": [],\n"metadata": {},\n"nbformat": 4,\n"nbformat_minor": 5\n}\n'],
    ['sources as strings', JSON.stringify(notebook([{ ...code('a', ''), source: 'a\nb' }]), null, 1)],
    ['no trailing newline and no cell ids (nbformat 4.4)', JSON.stringify({ cells: [{ cell_type: 'markdown', metadata: {}, source: ['hi'] }], metadata: {}, nbformat: 4, nbformat_minor: 4 }, null, 1)],
  ]
  it.each(layouts)('keeps %s', async (_, source) => {
    const bytes = utf8(source)
    const { doc, context } = await imported(bytes)
    expect(text(await notebookCodec.exportFile(replica(doc), context))).toBe(source)
    expect(notebookMap(doc).get('original'), 'written back by the serializer itself').toBeUndefined()
  })

  it('keeps the bytes of a file the serializer cannot reproduce, until it is edited', async () => {
    // A JavaScript tool that split a source on `\f`-free line breaks differently and escaped a slash.
    const source = '{"cells":[{"cell_type":"code","execution_count":null,"id":"a","metadata":{},"outputs":[],"source":["a\\/b\\f","c"]}],"metadata":{},"nbformat":4,"nbformat_minor":5}'
    const { doc, context } = await imported(utf8(source))
    expect(notebookMap(doc).get('original')).toBeDefined()
    expect(text(await notebookCodec.exportFile(doc, context))).toBe(source)
    insertCells(doc, { before: null }, [{ type: 'markdown', source: 'new' }])
    const edited = text(await notebookCodec.exportFile(doc, context))
    expect(edited).toContain('"a/b\\f"')
    expect(JSON.parse(edited).cells).toHaveLength(2)
  })

  it('repairs repeated cell ids, as nbformat does', async () => {
    const { doc, context } = await imported(jupyter(notebook([code('same', 'a'), code('same', 'b')])))
    const written = JSON.parse(text(await notebookCodec.exportFile(doc, context)))
    // Unedited, the file is as it was; once edited, ids are unique.
    expect(written.cells.map((cell: { id: string }) => cell.id)).toEqual(['same', 'same'])
    insertCells(doc, { before: null }, [{ type: 'code' }])
    const edited = JSON.parse(text(await notebookCodec.exportFile(doc, context)))
    expect(new Set(edited.cells.map((cell: { id: string }) => cell.id)).size).toBe(3)
  })
})

describe('outputs and assets', () => {
  it('keeps images as assets, so the document stays small', async () => {
    const bytes = jupyter(notebook([code('a', 'plot()', [{ data: { 'image/png': `${BIG_PNG}\n`, 'text/plain': ['<Figure>'] }, metadata: {}, output_type: 'display_data' }], 1)]))
    const { doc, assets, context } = await imported(bytes)
    expect(Y.encodeStateAsUpdate(doc).byteLength).toBeLessThan(bytes.byteLength / 3)
    const outputs = cellOutputs(orderedCells(doc)[0]!.cell)
    expect(outputs.assets).toEqual([expect.objectContaining({ kind: 'base64', mimeType: 'image/png', trail: '\n' })])
    expect(assets.list().some((ref) => ref.mimeType === 'image/png' && ref.sizeBytes === 6_000)).toBe(true)
    expect(text(await notebookCodec.exportFile(replica(doc), context))).toBe(text(bytes))
    expect(notebookCodec.referencedAssets!(doc)).toEqual([outputs.assets[0]!.hash])
  })

  it('keeps long text outputs and attachments as assets too', async () => {
    const log = Array.from({ length: 3_000 }, (_, index) => `line ${index}\n`)
    const bytes = jupyter(notebook([
      code('a', 'run()', [{ name: 'stdout', output_type: 'stream', text: log }], 2),
      { ...markdown('b', '![x](attachment:x.png)'), attachments: { 'x.png': { 'image/png': BIG_PNG } } },
    ]))
    const { doc, context } = await imported(bytes)
    const cells = orderedCells(doc)
    expect(cellOutputs(cells[0]!.cell).json.length).toBeLessThan(500)
    expect(cells[1]!.cell.get('attachments')).toMatchObject({ assets: [{ kind: 'base64' }] })
    expect(text(await notebookCodec.exportFile(replica(doc), context))).toBe(text(bytes))
  })

  it('leaves small images and data that is not canonical base64 inline', async () => {
    const bytes = jupyter(notebook([code('a', 'x', [
      { data: { 'image/png': PNG }, metadata: {}, output_type: 'display_data' },
      { data: { 'image/jpeg': `${'@'.repeat(2_000)}` }, metadata: {}, output_type: 'display_data' },
    ])]))
    const { doc, context } = await imported(bytes)
    expect(cellOutputs(orderedCells(doc)[0]!.cell).assets).toEqual([])
    expect(text(await notebookCodec.exportFile(doc, context))).toBe(text(bytes))
  })

  it('keeps everything inline in a notebook that already holds the placeholder text', async () => {
    const bytes = jupyter(notebook([code('a', 'x', [{ name: 'stdout', output_type: 'stream', text: ['\u0000pulpo-asset:0'] }, { data: { 'image/png': BIG_PNG }, metadata: {}, output_type: 'display_data' }])]))
    const { doc, context } = await imported(bytes)
    expect(cellOutputs(orderedCells(doc)[0]!.cell).assets).toEqual([])
    expect(text(await notebookCodec.exportFile(doc, context))).toBe(text(bytes))
  })
})

describe('edits', () => {
  it('changes only the edited cell in the file', async () => {
    const bytes = fixture('nbformat-test4.ipynb')
    const { doc, context } = await imported(bytes)
    const target = orderedCells(doc).find(({ cell }) => cellType(cell) === 'code')!.cell
    ;(target.get('source') as Y.Text).insert(0, '# edited\n')
    const after = text(await notebookCodec.exportFile(doc, context)).split('\n')
    const before = text(bytes).split('\n')
    expect(after.length).toBe(before.length + 1)
    const changed = after.filter((line, index) => line !== before[index - (index > after.indexOf('    "# edited\\n",') ? 1 : 0)])
    expect(changed).toEqual(['    "# edited\\n",'])
  })

  it('writes new cells as Jupyter does, with ids in nbformat 4.5', async () => {
    const { doc, context } = await imported(jupyter(notebook([markdown('intro', '# Title')])))
    const [key] = insertCells(doc, { after: orderedCells(doc)[0]!.key }, [{ type: 'code', source: 'import os\nprint(os.getcwd())' }])
    const written = JSON.parse(text(await notebookCodec.exportFile(doc, context)))
    expect(written.cells[1]).toEqual({ cell_type: 'code', execution_count: null, id: key!.slice(0, 8), metadata: {}, outputs: [], source: ['import os\n', 'print(os.getcwd())'] })
  })

  it('changes cell types and clears outputs the way Jupyter does', async () => {
    const { doc, context } = await imported(jupyter(notebook([code('a', 'x', [{ name: 'stdout', output_type: 'stream', text: ['1\n'] }], 4)])))
    const key = orderedCells(doc)[0]!.key
    clearOutputs(doc, null)
    let written = JSON.parse(text(await notebookCodec.exportFile(doc, context)))
    expect(written.cells[0]).toMatchObject({ execution_count: null, outputs: [] })
    setCellType(doc, [key], 'markdown')
    written = JSON.parse(text(await notebookCodec.exportFile(doc, context)))
    expect(written.cells[0]).toEqual({ cell_type: 'markdown', id: 'a', metadata: {}, source: ['x'] })
  })

  it('creates an empty Python notebook', async () => {
    const doc = new Y.Doc()
    const assets = new MemoryLiveAssetStore()
    await notebookCodec.createEmpty(doc, { name: 'New.ipynb', assets })
    const written = JSON.parse(text(await notebookCodec.exportFile(doc, { name: 'New.ipynb', assets })))
    expect(written).toMatchObject({ nbformat: 4, nbformat_minor: 5, metadata: { kernelspec: { name: 'python3' } } })
    expect(written.cells).toHaveLength(1)
  })
})

describe('applyFile', () => {
  const base = () => jupyter(notebook([markdown('m1', '# Analysis'), code('c1', 'import pandas as pd'), code('c2', 'df = pd.read_csv("a.csv")\ndf.head()'), code('c3', 'df.plot()')]))

  it('reports no change for the same file', async () => {
    const { doc, context } = await imported(base())
    expect(await notebookCodec.applyFile(doc, base(), context, 'agent')).toEqual({ changed: false })
  })

  it('becomes exactly the pushed file, and merges with a concurrent edit to another cell', async () => {
    const { doc, context } = await imported(base())
    const user = replica(doc)
    // The user edits c1 while the agent runs the notebook and rewrites c2.
    const userCell = orderedCells(user).find(({ cell }) => cell.get('id') === 'c1')!.cell
    ;(userCell.get('source') as Y.Text).insert(0, '# mine\n')
    const pushed = jupyter(notebook([
      markdown('m1', '# Analysis'),
      code('c1', 'import pandas as pd', [], 1),
      code('c2', 'df = pd.read_csv("b.csv")\ndf.head()', [{ data: { 'text/plain': ['   a\n0  1'] }, execution_count: 2, metadata: {}, output_type: 'execute_result' }], 2),
      code('c3', 'df.plot()', [{ data: { 'image/png': BIG_PNG }, metadata: {}, output_type: 'display_data' }], 3),
    ]))
    const agentDoc = replica(doc)
    expect(await notebookCodec.applyFile(agentDoc, pushed, context, 'agent')).toEqual({ changed: true })
    expect(text(await notebookCodec.exportFile(agentDoc, context))).toBe(text(pushed))
    sync(agentDoc, user)
    const merged = JSON.parse(text(await notebookCodec.exportFile(user, context)))
    expect(merged.cells[1].source).toEqual(['# mine\n', 'import pandas as pd'])
    expect(merged.cells[1].execution_count).toBe(1)
    expect(merged.cells[2].source.join('')).toContain('b.csv')
    expect(merged.cells[3].outputs[0].data['image/png']).toBe(BIG_PNG)
  })

  it('edits sources in place, so a concurrent edit inside the same cell is kept', async () => {
    const { doc, context } = await imported(base())
    const user = replica(doc)
    const cell = orderedCells(user).find(({ cell: item }) => item.get('id') === 'c2')!.cell
    const source = cell.get('source') as Y.Text
    source.insert(source.length, '\ndf.describe()')
    await notebookCodec.applyFile(doc, utf8(text(base()).replace('a.csv', 'data/a.csv')), context, 'agent')
    sync(doc, user)
    expect(cellSourceText(orderedCells(user).find(({ cell: item }) => item.get('id') === 'c2')!.cell)).toBe('df = pd.read_csv("data/a.csv")\ndf.head()\ndf.describe()')
  })

  it('moves cells without losing a concurrent edit to the moved cell', async () => {
    const { doc, context } = await imported(base())
    const user = replica(doc)
    const moved = orderedCells(user).find(({ cell }) => cell.get('id') === 'c3')!.cell
    ;(moved.get('source') as Y.Text).insert(0, 'ax = ')
    const parsed = JSON.parse(text(base()))
    parsed.cells = [parsed.cells[0], parsed.cells[3], parsed.cells[1], parsed.cells[2]]
    await notebookCodec.applyFile(doc, jupyter(parsed), context, 'agent')
    sync(doc, user)
    const order = orderedCells(user).map(({ cell }) => cell.get('id'))
    expect(order).toEqual(['m1', 'c3', 'c1', 'c2'])
    expect(cellSourceText(orderedCells(user)[1]!.cell)).toBe('ax = df.plot()')
  })

  it('matches cells without ids by content and by likeness', async () => {
    const plain = (cells: string[]) => utf8(`${JSON.stringify({ cells: cells.map((source) => ({ cell_type: 'code', execution_count: null, metadata: {}, outputs: [], source: [source] })), metadata: {}, nbformat: 4, nbformat_minor: 4 }, null, 1)}\n`)
    const { doc, context } = await imported(plain(['import os', 'x = compute(1, 2, 3)\nprint(x)\nprint(x * 2)', 'done()']))
    const keys = orderedCells(doc).map((entry) => entry.key)
    await notebookCodec.applyFile(doc, plain(['import os', 'new_cell()', 'x = compute(1, 2, 4)\nprint(x)\nprint(x * 2)', 'done()']), context, 'agent')
    const after = orderedCells(doc).map((entry) => entry.key)
    expect(after[0]).toBe(keys[0])
    expect(after[2]).toBe(keys[1])
    expect(after[3]).toBe(keys[2])
    expect(keys).not.toContain(after[1])
  })

  it('deletes and adds cells, keeping the rest', async () => {
    const { doc, context } = await imported(base())
    const parsed = JSON.parse(text(base()))
    parsed.cells.splice(1, 1)
    parsed.cells.push(markdown('end', 'The end.'))
    const before = new Map(orderedCells(doc).map(({ key, cell }) => [cell.get('id'), key]))
    await notebookCodec.applyFile(doc, jupyter(parsed), context, 'agent')
    const after = orderedCells(doc)
    expect(after.map(({ cell }) => cell.get('id'))).toEqual(['m1', 'c2', 'c3', 'end'])
    expect(after[1]!.key).toBe(before.get('c2'))
  })

  it('follows the layout of the pushed file', async () => {
    const { doc, context } = await imported(base())
    const pushed = utf8(JSON.stringify(JSON.parse(text(base())), null, 2))
    await notebookCodec.applyFile(doc, pushed, context, 'agent')
    expect(text(await notebookCodec.exportFile(doc, context))).toBe(text(pushed))
  })

  it('refuses a file that is not a notebook and leaves the document alone', async () => {
    const { doc, context } = await imported(base())
    const state = Y.encodeStateAsUpdate(doc)
    await expect(notebookCodec.applyFile(doc, utf8('{"cells": 3}'), context, 'agent')).rejects.toBeInstanceOf(LiveFormatError)
    expect(Y.encodeStateAsUpdate(doc)).toEqual(state)
  })
})

describe('toText', () => {
  it('marks cells and summarizes outputs', async () => {
    const { doc } = await imported(jupyter(notebook([
      markdown('m1', '# Analysis'),
      code('c1', 'print("hi")\n1 + 1', [
        { name: 'stdout', output_type: 'stream', text: ['hi\n'] },
        { data: { 'text/plain': ['2'] }, execution_count: 5, metadata: {}, output_type: 'execute_result' },
        { data: { 'image/png': BIG_PNG, 'text/plain': ['<Figure size 640x480>'] }, metadata: {}, output_type: 'display_data' },
        { ename: 'ValueError', evalue: 'bad', output_type: 'error', traceback: ['\u001b[31mValueError\u001b[0m: bad'] },
      ], 5),
    ])))
    expect(notebookCodec.toText(doc)).toBe([
      '# Jupyter notebook · Python 3 · 2 cells',
      '',
      '# %% [markdown] cell 1 · id m1',
      '# Analysis',
      '',
      '# %% [code] cell 2 · In [5] · id c1',
      'print("hi")',
      '1 + 1',
      '# stdout:',
      '#   hi',
      '# Out [5]:',
      '#   2',
      '# Output:',
      '#   [image/png, stored as an asset]',
      '#   <Figure size 640x480>',
      '# Error: ValueError: bad',
      '',
    ].join('\n'))
  })
})

describe('hostile and invalid notebooks', () => {
  const refuses = async (bytes: Uint8Array, code: string) => {
    await expect(imported(bytes)).rejects.toMatchObject({ name: 'LiveFormatError', code })
  }
  it('refuses what is not a notebook', async () => {
    await refuses(utf8(''), 'corrupt')
    await refuses(utf8('not json'), 'corrupt')
    await refuses(utf8('[1, 2]'), 'corrupt')
    await refuses(utf8('{"cells": []}'), 'corrupt')
    await refuses(utf8('{"nbformat": 2, "cells": []}'), 'unsupported')
    await refuses(utf8('{"nbformat": 4, "nbformat_minor": 5, "cells": {}}'), 'corrupt')
    await refuses(utf8('{"nbformat": 4, "nbformat_minor": 5, "metadata": {}, "cells": [{"cell_type": "widget", "source": ""}]}'), 'corrupt')
    await refuses(utf8('{"nbformat": 4, "nbformat_minor": 5, "metadata": {}, "cells": [{"cell_type": "code", "source": 3}]}'), 'corrupt')
    await refuses(utf8('{"nbformat": 4, "nbformat_minor": 5, "metadata": {}, "cells": [{"cell_type": "code", "source": "", "outputs": [{"output_type": "magic"}]}]}'), 'corrupt')
    await refuses(utf8('{"nbformat": 4, "nbformat_minor": 5, "metadata": {}, "cells": [{"cell_type": "code", "source": "", "execution_count": "1"}]}'), 'corrupt')
    await refuses(Uint8Array.from([0x7b, 0xff, 0xfe, 0x7d]), 'corrupt')
    await refuses(utf8('{"nbformat": 4, "nbformat_minor": 5, "cells": []} trailing'), 'corrupt')
  })

  it('refuses deep nesting without overflowing the stack', async () => {
    const deep = `{"nbformat": 4, "nbformat_minor": 5, "metadata": {"x": ${'['.repeat(100_000)}${']'.repeat(100_000)}}, "cells": []}`
    await refuses(utf8(deep), 'corrupt')
  })

  it('refuses notebooks that are too large or have too many cells', async () => {
    const many = JSON.stringify(notebook(Array.from({ length: 10_001 }, () => ({ cell_type: 'raw', metadata: {}, source: '' }))))
    await refuses(utf8(many), 'too_large')
    const huge = new Uint8Array(25_000_001).fill(0x20)
    await refuses(huge, 'too_large')
  })

  it('reads random mutations of a notebook without crashing or hanging', async () => {
    const source = text(fixture('nbformat-test4.ipynb'))
    let seed = 7
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
      return seed / 2_147_483_648
    }
    for (let round = 0; round < 200; round += 1) {
      const chars = [...source]
      for (let edit = 0; edit < 3; edit += 1) {
        const at = Math.floor(random() * chars.length)
        chars.splice(at, Math.floor(random() * 4), ...'{}[]",:0e\\'.charAt(Math.floor(random() * 10)))
      }
      const bytes = utf8(chars.join(''))
      try {
        const { doc, context } = await imported(bytes)
        // Whatever it accepted, it writes back as it was.
        expect(text(await notebookCodec.exportFile(doc, context))).toBe(chars.join(''))
      } catch (error) {
        expect(error).toBeInstanceOf(LiveFormatError)
      }
    }
  })
})

describe('concurrent editing', () => {
  it('converges under random concurrent edits and exports the same valid notebook everywhere', async () => {
    let seed = 42
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
      return seed / 2_147_483_648
    }
    const pick = <T,>(items: readonly T[]) => items[Math.floor(random() * items.length)]!
    for (let round = 0; round < 20; round += 1) {
      const { doc, context } = await imported(fixture('nbformat-test4.ipynb'))
      const replicas = [replica(doc), replica(doc), replica(doc)]
      for (let step = 0; step < 60; step += 1) {
        const target = pick(replicas)
        const cells = orderedCells(target)
        const keys = cells.map((entry) => entry.key)
        const operation = Math.floor(random() * 8)
        if (operation === 0 || !keys.length) insertCells(target, { after: keys.length ? pick(keys) : null }, [{ type: pick(['code', 'markdown', 'raw'] as const), source: `cell ${step}` }])
        else if (operation === 1) deleteCells(target, [pick(keys)])
        else if (operation === 2) moveCells(target, [pick(keys)], random() < 0.5 ? { after: pick(keys) } : { before: pick(keys) })
        else if (operation === 3) shiftCells(target, [pick(keys)], random() < 0.5 ? 'up' : 'down')
        else if (operation === 4) setCellType(target, [pick(keys)], pick(['code', 'markdown', 'raw'] as const))
        else if (operation === 5) clearOutputs(target, [pick(keys)])
        else {
          const source = pick(cells).cell.get('source') as Y.Text
          const at = Math.floor(random() * (source.length + 1))
          if (random() < 0.3 && source.length > at) source.delete(at, Math.min(3, source.length - at))
          else source.insert(at, pick(['x', '\n', 'é', 'print()', '😀']))
        }
        if (random() < 0.2) sync(...replicas)
      }
      sync(...replicas)
      const exports = await Promise.all(replicas.map(async (copy) => text(await notebookCodec.exportFile(copy, context))))
      expect(exports[1]).toBe(exports[0])
      expect(exports[2]).toBe(exports[0])
      const written = JSON.parse(exports[0]!)
      const ids = written.cells.flatMap((cell: { id?: string }) => (cell.id === undefined ? [] : [cell.id]))
      expect(new Set(ids).size).toBe(ids.length)
      // It reads back as a notebook, and writes back the same.
      const again = await imported(utf8(exports[0]!), context.assets)
      expect(text(await notebookCodec.exportFile(again.doc, context))).toBe(exports[0])
    }
  })
})

describe('audit regressions', () => {
  it('refuses outputs that use one stored part twice instead of doubling it at every level', async () => {
    const { doc, assets, context } = await imported(jupyter(notebook([code('a', 'x')])))
    // A hostile collaborator's blob: part i is [part i+1, part i+1], 40 levels deep.
    const slots = []
    for (let level = 0; level < 40; level += 1) {
      const next = `"\\u0000pulpo-asset:${level + 1}"`
      const ref = await assets.put(utf8(level === 39 ? '"leaf"' : `[${next},${next}]`), 'application/json')
      slots.push({ hash: ref.hash, kind: 'json' })
    }
    orderedCells(doc)[0]!.cell.set('outputs', { json: '"\\u0000pulpo-asset:0"', assets: slots })
    const started = Date.now()
    await expect(notebookCodec.exportFile(doc, context)).rejects.toBeInstanceOf(LiveFormatError)
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('keeps unknown keys named constructor or __proto__ through other replicas', async () => {
    const source = JSON.stringify({ cells: [{ ...code('a', 'x'), constructor: 1, __proto__: { b: 2 } }], metadata: {}, nbformat: 4, nbformat_minor: 5, constructor: [3] }, null, 1)
      .replace('"cells"', '"__proto__": {"c": 4},\n "cells"')
    const bytes = utf8(source)
    const { doc, context } = await imported(bytes)
    const copy = replica(doc)
    const written = text(await notebookCodec.exportFile(copy, context))
    expect(written).toContain('"__proto__": {')
    expect(written).toContain('"constructor": [')
    expect(written).toContain('"constructor": 1')
    expect(written).toBe(source)
  })

  it('summarizes long outputs kept as assets in readable text', async () => {
    const log = Array.from({ length: 3_000 }, (_, index) => `epoch ${index}\n`)
    const { doc } = await imported(jupyter(notebook([code('a', 'train()', [{ name: 'stdout', output_type: 'stream', text: log }], 1)])))
    const textOut = notebookCodec.toText(doc)
    expect(textOut).not.toContain('\u0000')
    expect(textOut).toContain('# stdout: (long, kept as an asset; pull the notebook to read it)')
  })

  it('keeps cell ids when a pushed file leaves them out or comes from nbformat 3', async () => {
    const { doc, context } = await imported(jupyter(notebook([code('keep-me', 'x = 1'), code('and-me', 'y = 2')])))
    const withoutIds = JSON.parse(text(jupyter(notebook([code('keep-me', 'x = 10'), code('and-me', 'y = 2')]))))
    for (const cell of withoutIds.cells) delete cell.id
    await notebookCodec.applyFile(doc, jupyter(withoutIds), context, 'agent')
    expect(orderedCells(doc).map(({ cell }) => cell.get('id'))).toEqual(['keep-me', 'and-me'])
    const v3 = fixture('nbformat-test3.ipynb')
    const upgraded = await imported(v3)
    const ids = orderedCells(upgraded.doc).map(({ cell }) => cell.get('id'))
    await notebookCodec.applyFile(upgraded.doc, v3, upgraded.context, 'agent')
    expect(orderedCells(upgraded.doc).map(({ cell }) => cell.get('id'))).toEqual(ids)
  })

  it('applies a large notebook without ids, every cell rewritten, quickly', async () => {
    const make = (suffix: string) => utf8(`${JSON.stringify({ cells: Array.from({ length: 2_500 }, (_, index) => ({ cell_type: 'code', execution_count: null, metadata: {}, outputs: [], source: [`value_${index} = compute(${index})\n`, `print(value_${index})${suffix}`] })), metadata: {}, nbformat: 4, nbformat_minor: 4 }, null, 1)}\n`)
    const { doc, context } = await imported(make(''))
    const keys = orderedCells(doc).map((entry) => entry.key)
    const started = Date.now()
    await notebookCodec.applyFile(doc, make(' # checked'), context, 'agent')
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(orderedCells(doc).map((entry) => entry.key)).toEqual(keys)
  })
})

describe('second review regressions', () => {
  it('refuses long chains of stored parts with a format error, not a stack overflow', async () => {
    const { doc, assets, context } = await imported(jupyter(notebook([code('a', 'x')])))
    const slots = []
    for (let level = 0; level < 40; level += 1) {
      const inner = level === 39 ? '1' : `"\\u0000pulpo-asset:${level + 1}"`
      const ref = await assets.put(utf8(`${'['.repeat(200)}${inner}${']'.repeat(200)}`), 'application/json')
      slots.push({ hash: ref.hash, kind: 'json' })
    }
    orderedCells(doc)[0]!.cell.set('outputs', { json: '"\\u0000pulpo-asset:0"', assets: slots })
    await expect(notebookCodec.exportFile(doc, context)).rejects.toBeInstanceOf(LiveFormatError)
  })

  it('reads malformed stored parts as no outputs instead of throwing', async () => {
    const { doc, context } = await imported(jupyter(notebook([code('a', 'x')])))
    orderedCells(doc)[0]!.cell.set('outputs', { json: '[]', assets: [null, { hash: 5 }] })
    expect(notebookCodec.referencedAssets!(doc)).toEqual([])
    expect(JSON.parse(text(await notebookCodec.exportFile(doc, context))).cells[0].outputs).toEqual([])
    expect(notebookCodec.toText(doc)).toContain('cell 1')
  })

  it('exports exactly a pushed 4.5 file without ids until it is edited', async () => {
    const { doc, context } = await imported(jupyter(notebook([code('a', 'x = 1')])))
    const pushed = JSON.parse(text(jupyter(notebook([code('a', 'x = 1'), code('b', 'y = 2')]))))
    delete pushed.cells[1].id
    const bytes = jupyter(pushed)
    await notebookCodec.applyFile(doc, bytes, context, 'agent')
    // The scratch run and the real one made the same document, so the kept original applies.
    expect(text(await notebookCodec.exportFile(doc, context))).toBe(text(bytes))
    ;(orderedCells(doc)[0]!.cell.get('source') as Y.Text).insert(0, '# ')
    const edited = JSON.parse(text(await notebookCodec.exportFile(doc, context)))
    expect(edited.cells[1].id).toMatch(/^[0-9a-f]{8}$/)
  })

  it('never shows placeholders inside joined output lines', async () => {
    const long = 'x'.repeat(20_000)
    const { doc } = await imported(jupyter(notebook([code('a', 'run()', [{ name: 'stdout', output_type: 'stream', text: ['hi ', `${long}\n`, 'bye'] }], 1)])))
    expect(notebookCodec.toText(doc)).not.toContain('\u0000')
  })
})

describe('bounded notebook blob restoration', () => {
  it('fetches repeated asset hashes once while restoring every slot', async () => {
    const { doc, assets, context } = await imported(jupyter(notebook([code('a', 'run()')])))
    const ref = await assets.put(utf8(JSON.stringify('plot')), 'application/json')
    const slots = Array.from({ length: 2 }, () => ({ hash: ref.hash, kind: 'json' }))
    orderedCells(doc)[0]!.cell.set('outputs', {
      json: JSON.stringify(slots.map((_, index) => ({ output_type: 'stream', name: 'stdout', text: `${ASSET_MARKER}${index}` }))),
      assets: slots,
    })
    let reads = 0
    const traced = { put: assets.put.bind(assets), get: (hash: string) => { reads += 1; return assets.get(hash) } }
    const result = JSON.parse(text(await notebookCodec.exportFile(doc, { ...context, assets: traced })))
    expect(result.cells[0].outputs.map((output: { text: string }) => output.text)).toEqual(['plot', 'plot'])
    expect(reads).toBe(1)
    doc.destroy()
  })

  it('caps repeated substitutions even when their shared asset fits in the limit', async () => {
    const { doc, assets, context } = await imported(jupyter(notebook([code('a', 'run()')])))
    const payload = JSON.stringify('é'.repeat(16_384))
    const ref = await assets.put(utf8(payload), 'application/json')
    const count = Math.ceil(NOTEBOOK_MAX_FILE_BYTES / utf8(payload).byteLength)
    orderedCells(doc)[0]!.cell.set('outputs', {
      json: JSON.stringify(Array.from({ length: count }, (_, index) => ({ output_type: 'stream', name: 'stdout', text: `${ASSET_MARKER}${index}` }))),
      assets: Array.from({ length: count }, () => ({ hash: ref.hash, kind: 'json' })),
    })
    let reads = 0
    const traced = { put: assets.put.bind(assets), get: (hash: string) => { reads += 1; return assets.get(hash) } }
    await expect(notebookCodec.exportFile(doc, { ...context, assets: traced })).rejects.toMatchObject({ name: 'LiveFormatError', code: 'too_large' })
    expect(reads).toBe(1)
    doc.destroy()
  })

  it('counts fetched bytes as well as the substituted JSON', async () => {
    const { doc, assets, context } = await imported(jupyter(notebook([code('a', 'run()')])))
    const ref = await assets.put(utf8(JSON.stringify('x'.repeat(NOTEBOOK_MAX_FILE_BYTES / 2))), 'application/json')
    orderedCells(doc)[0]!.cell.set('outputs', { json: JSON.stringify(`${ASSET_MARKER}0`), assets: [{ hash: ref.hash, kind: 'json' }] })
    await expect(notebookCodec.exportFile(doc, context)).rejects.toMatchObject({ code: 'too_large' })
    doc.destroy()
  })

  it('imports a wide JSON output without spreading its items onto the call stack', async () => {
    const data = { 'application/json': new Array(200_000).fill(0) }
    // Sorted keys make style detection walk the wide array too.
    const bytes = utf8(pyDumps(notebook([code('a', 'run()', [{ output_type: 'display_data', metadata: {}, data }])]), 0, 0).replace(/\n/g, ''))
    const { doc, context } = await imported(bytes)
    expect(await notebookCodec.exportFile(doc, context)).toEqual(bytes)
    doc.destroy()
  })

  it('round trips twenty levels of valid nested asset parts byte for byte', async () => {
    let value: unknown = []
    for (let level = 0; level < 20; level += 1) value = [value, 'a'.repeat(8_000), 'b'.repeat(8_000), 'c'.repeat(1_000)]
    const bytes = jupyter(notebook([code('a', 'run()', [{ output_type: 'display_data', metadata: {}, data: { 'application/json': value } }])]))
    const { doc, context } = await imported(bytes)
    expect(notebookMap(doc).get('original')).toBeUndefined()
    expect(await notebookCodec.exportFile(doc, context)).toEqual(bytes)
    doc.destroy()
  })
})
