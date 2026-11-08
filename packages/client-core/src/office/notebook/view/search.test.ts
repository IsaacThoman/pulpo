import { afterEach, describe, expect, it, vi } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { MemoryLiveAssetStore } from '../../assets.js'
import { notebookCodec } from '../codec.js'
import { cellSourceText, orderedCells } from '../layout.js'
import { NotebookController } from './controller.js'
import { findInNotebook, MAX_SEARCH_MATCHES, NotebookSearch, searchPattern } from './search.js'

const cleanup: Array<() => void> = []
afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose()
  vi.useRealTimers()
})

type Cell = { cell_type: 'code' | 'markdown' | 'raw'; source: string }

async function open(cells: Cell[], doc = new Y.Doc()) {
  const assets = new MemoryLiveAssetStore()
  if (!orderedCells(doc).length) {
    const file = { nbformat: 4, nbformat_minor: 5, metadata: {}, cells: cells.map((cell, index) => ({ id: `c${index}`, metadata: {}, ...cell, ...cell.cell_type === 'code' ? { execution_count: null, outputs: [] } : {} })) }
    await notebookCodec.importFile(doc, new TextEncoder().encode(JSON.stringify(file)), { name: 'a.ipynb', assets })
  }
  const awareness = new Awareness(doc)
  const controller = new NotebookController({ doc, awareness, assets, readOnly: false, user: { name: 'Ana', color: '#3366ff' } })
  const search = new NotebookSearch(controller)
  cleanup.push(() => {
    search.destroy()
    controller.destroy()
    awareness.destroy()
    doc.destroy()
  })
  return { doc, controller, search }
}

const sources = (doc: Y.Doc) => orderedCells(doc).map(({ cell }) => cellSourceText(cell))
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const CELLS: Cell[] = [
  { cell_type: 'markdown', source: '# Cats\nThe cat sat.' },
  { cell_type: 'code', source: 'cat = "Cat"\nconcat(cat)' },
  { cell_type: 'raw', source: 'category: cat' },
]

describe('notebook search', () => {
  it('finds across code, Markdown, and raw cells with case, whole-word, and regexp options', async () => {
    const { doc } = await open(CELLS)
    const count = (query: Parameters<typeof findInNotebook>[1]) => findInNotebook(doc, query).matches.length
    expect(count({ text: 'cat' })).toBe(8)
    expect(count({ text: 'cat', matchCase: true })).toBe(6)
    expect(count({ text: 'cat', wholeWord: true })).toBe(5)
    expect(count({ text: 'cat', wholeWord: true, matchCase: true })).toBe(4)
    expect(count({ text: '^cat', regexp: true })).toBe(2)
    expect(count({ text: 'c(a)t', regexp: true, wholeWord: true })).toBe(5)
    expect(findInNotebook(doc, { text: 'c[at', regexp: true })).toMatchObject({ invalid: true, matches: [] })
    // Regex characters are literal without regexp, and empty matches are skipped.
    expect(count({ text: '"Cat"' })).toBe(1)
    expect(count({ text: 'x*', regexp: true })).toBe(0)
    expect(searchPattern({ text: '' })).toBeNull()
    const keys = orderedCells(doc).map((entry) => entry.key)
    expect(findInNotebook(doc, { text: 'cat', wholeWord: true, matchCase: true }).matches).toEqual([
      { key: keys[0], from: 11, to: 14 },
      { key: keys[1], from: 0, to: 3 },
      { key: keys[1], from: 19, to: 22 },
      { key: keys[2], from: 10, to: 13 },
    ])
  })

  it('caps the list of matches', async () => {
    const { doc } = await open([{ cell_type: 'code', source: 'a'.repeat(MAX_SEARCH_MATCHES) }, { cell_type: 'code', source: 'a' }])
    const found = findInNotebook(doc, { text: 'a' })
    expect(found.matches).toHaveLength(MAX_SEARCH_MATCHES)
    expect(found.capped).toBe(true)
    expect(findInNotebook(doc, { text: 'a' }, MAX_SEARCH_MATCHES + 1).capped).toBe(false)
  })

  it('steps through matches from the active cell, wrapping around, and selects their cells', async () => {
    const { controller, search } = await open(CELLS)
    const cells = controller.getState().cells.map((cell) => cell.key)
    controller.select(cells[1]!)
    search.setQuery({ text: 'cat', wholeWord: true, matchCase: true })
    expect(search.getState()).toMatchObject({ current: 1, matches: { length: 4 } })
    expect(search.matchesIn(cells[1]!)).toEqual({ matches: [{ key: cells[1], from: 0, to: 3 }, { key: cells[1], from: 19, to: 22 }], current: 0 })
    expect(search.matchesIn(cells[0]!).current).toBe(-1)
    search.step(1)
    search.step(1)
    expect(search.getState().current).toBe(3)
    expect(controller.getState().active).toBe(cells[2])
    search.step(1)
    expect(search.getState().current).toBe(0)
    expect(controller.getState().active).toBe(cells[0])
    search.step(-1)
    expect(search.getState().current).toBe(3)
    const revealed = search.getState().revealed
    search.step(1)
    expect(search.getState().revealed).toBe(revealed + 1)
  })

  it('keeps the current match while the query is typed, though moving to it moves the caret there', async () => {
    const { controller, search } = await open(CELLS)
    // The view selects each match it moves to, so the active cell's caret ends up after it.
    let caret = 0
    controller.setCursorProvider(() => caret)
    search.subscribe((state) => {
      const match = state.matches[state.current]
      if (match) caret = match.to
    })
    controller.select(controller.getState().cells[1]!.key)
    search.setQuery({ text: 'c' })
    expect(search.getState().matches[search.getState().current]).toMatchObject({ key: controller.getState().cells[1]!.key, from: 0 })
    search.setQuery({ text: 'ca' })
    search.setQuery({ text: 'cat' })
    expect(search.getState().matches[search.getState().current]).toMatchObject({ key: controller.getState().cells[1]!.key, from: 0, to: 3 })
    // A longer query that no longer matches there moves on to the next place it does.
    search.setQuery({ text: 'cat)' })
    expect(search.getState().matches[search.getState().current]).toMatchObject({ from: 19, to: 23 })
  })

  it('replaces one match at a time, moving on, each one undo step', async () => {
    const { doc, controller, search } = await open(CELLS)
    controller.select(controller.getState().cells[0]!.key)
    search.setQuery({ text: 'cat', wholeWord: true })
    expect(search.replace('dog')).toBe(true)
    // "Cats" is no whole word "cat": the first match is "cat" in "The cat sat."
    expect(sources(doc)[0]).toBe('# Cats\nThe dog sat.')
    expect(search.getState().matches[search.getState().current]).toMatchObject({ key: controller.getState().cells[1]!.key, from: 0 })
    // A replacement holding the query is not found again at once.
    expect(search.replace('cat cat')).toBe(true)
    expect(sources(doc)[1]).toBe('cat cat = "Cat"\nconcat(cat)')
    expect(search.getState().matches[search.getState().current]).toMatchObject({ from: 11 })
    controller.undo()
    await flush()
    expect(sources(doc)[1]).toBe('cat = "Cat"\nconcat(cat)')
    controller.undo()
    await flush()
    expect(sources(doc)).toEqual(CELLS.map((cell) => cell.source))
  })

  it('replaces every match as one undo step, with regular expression groups', async () => {
    const { doc, controller, search } = await open(CELLS)
    search.setQuery({ text: '(c)(at)', regexp: true, matchCase: true })
    expect(search.replaceAll('$2$1[$&]$$')).toBe(6)
    expect(sources(doc)).toEqual(['# Cats\nThe atc[cat]$ sat.', 'atc[cat]$ = "Cat"\nconatc[cat]$(atc[cat]$)', 'atc[cat]$egory: atc[cat]$'])
    expect(search.getState().matches).toHaveLength(6)
    controller.undo()
    await flush()
    expect(sources(doc)).toEqual(CELLS.map((cell) => cell.source))
    search.setQuery({ text: '(?<word>Cat)', regexp: true, matchCase: true })
    expect(search.replaceAll('<$<word>>')).toBe(2)
    expect(sources(doc)).toEqual(['# <Cat>s\nThe cat sat.', 'cat = "<Cat>"\nconcat(cat)', 'category: cat'])
  })

  it('recounts after others edit, keeping the current match', async () => {
    vi.useFakeTimers()
    const { doc, controller, search } = await open(CELLS)
    controller.select(controller.getState().cells[2]!.key)
    search.setQuery({ text: 'cat', wholeWord: true })
    expect(search.getState().current).toBe(4)
    const remote = new Y.Doc()
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc))
    ;(orderedCells(remote)[0]!.cell.get('source') as Y.Text).insert(0, 'cat ')
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(doc)))
    // The count waits for typing to pause.
    expect(search.getState().matches).toHaveLength(5)
    vi.advanceTimersByTime(200)
    expect(search.getState().matches).toHaveLength(6)
    expect(search.getState().matches[search.getState().current]).toMatchObject({ key: controller.getState().cells[2]!.key, from: 10 })
    remote.destroy()
  })

  it('changes nothing when read only', async () => {
    const { doc, controller, search } = await open(CELLS)
    controller.setReadOnly(true)
    search.setQuery({ text: 'cat' })
    const before = Y.encodeStateAsUpdate(doc)
    expect(search.replace('dog')).toBe(false)
    expect(search.replaceAll('dog')).toBe(0)
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before)
    expect(search.getState().matches).toHaveLength(8)
  })

  it('lets two collaborators replace at once and converge', async () => {
    const a = await open(CELLS)
    const other = new Y.Doc()
    Y.applyUpdate(other, Y.encodeStateAsUpdate(a.doc))
    const b = await open([], other)
    a.search.setQuery({ text: 'cat', wholeWord: true, matchCase: true })
    b.search.setQuery({ text: 'sat' })
    a.search.replaceAll('dog')
    b.search.replaceAll('stood')
    Y.applyUpdate(other, Y.encodeStateAsUpdate(a.doc, Y.encodeStateVector(other)))
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(other, Y.encodeStateVector(a.doc)))
    const expected = ['# Cats\nThe dog stood.', 'dog = "Cat"\nconcat(dog)', 'category: dog']
    expect(sources(a.doc)).toEqual(expected)
    expect(sources(other)).toEqual(expected)
    // Each undoes only their own replacement.
    b.controller.undo()
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(other, Y.encodeStateVector(a.doc)))
    expect(sources(a.doc)[0]).toBe('# Cats\nThe dog sat.')
  })
})
