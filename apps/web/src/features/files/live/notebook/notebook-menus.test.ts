import { MemoryLiveAssetStore } from '@pulpo/client-core/office'
import { cellSourceText, notebookCodec, orderedCells } from '@pulpo/client-core/office/notebook'
import { clearNotebookClipboard, NotebookController } from '@pulpo/client-core/office/notebook/view'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { normalizeEntries, shortcutGroupsFromMenus, type MenuEntry } from '../chrome/menu'
import { cellContextEntries, notebookMenus, viewOptionEntries, type NotebookMenuContext } from './notebook-menus'
import { notebookShortcutGroups } from './notebook-shortcuts'

const cleanup: Array<() => void> = []
afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose()
  clearNotebookClipboard()
})

const code = (id: string, source: string, outputs: object[] = [], metadata: object = {}) => ({ id, cell_type: 'code', metadata, execution_count: null, outputs, source })
const markdown = (id: string, source: string) => ({ id, cell_type: 'markdown', metadata: {}, source })
const output = { output_type: 'stream', name: 'stdout', text: 'done' }

async function open(cells: object[], { editable = true, ...overrides }: Partial<NotebookMenuContext> = {}) {
  const doc = new Y.Doc()
  const assets = new MemoryLiveAssetStore()
  await notebookCodec.importFile(doc, new TextEncoder().encode(JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells })), { name: 'a.ipynb', assets })
  const awareness = new Awareness(doc)
  const controller = new NotebookController({ doc, awareness, assets, readOnly: !editable, user: { name: 'Ana', color: '#3366ff' } })
  cleanup.push(() => {
    controller.destroy()
    awareness.destroy()
    doc.destroy()
  })
  const context: NotebookMenuContext = {
    controller,
    editable,
    copy: vi.fn(),
    cut: vi.fn(),
    find: vi.fn(),
    outline: false,
    toggleOutline: vi.fn(),
    lineNumbers: false,
    setLineNumbers: vi.fn(),
    wrap: false,
    setWrap: vi.fn(),
    outputsScroll: () => true,
    toggleOutputScroll: vi.fn(),
    revealed: () => false,
    reveal: vi.fn(),
    insertHeading: vi.fn(),
    copyOutputText: vi.fn(),
    ...overrides,
  }
  const sources = () => orderedCells(doc).map(({ cell }) => cellSourceText(cell))
  const key = (index: number) => controller.getState().cells[index]!.key
  return { doc, controller, context, sources, key }
}

/** A menu's rows as the menu bar shows them (stray separators dropped), by id. */
function rows(entries: MenuEntry[]): Map<string, MenuEntry> {
  const found = new Map<string, MenuEntry>()
  const visit = (list: readonly MenuEntry[]) => {
    for (const entry of normalizeEntries(list)) {
      if (entry.type === 'item' || entry.type === 'submenu') found.set(entry.id, entry)
      if (entry.type === 'submenu') visit(entry.items)
    }
  }
  visit(entries)
  return found
}

function menu(context: NotebookMenuContext, id: string): Map<string, MenuEntry> {
  const definition = notebookMenus(context).find((entry) => entry.id === id)
  if (!definition) throw new Error(`no ${id} menu`)
  return rows(definition.items())
}

function item(entries: Map<string, MenuEntry>, id: string): Extract<MenuEntry, { type: 'item' }> {
  const entry = entries.get(id)
  if (entry?.type !== 'item') throw new Error(`no ${id} item`)
  return entry
}

describe('notebook menus', () => {
  it('lays out Edit, View, Insert, and Cell, with Runtime only where an agent can run the notebook', async () => {
    const { context } = await open([code('a', 'x = 1')])
    expect(notebookMenus(context).map((entry) => entry.label)).toEqual(['Edit', 'View', 'Insert', 'Cell'])
    const run = vi.fn()
    const withAgent = notebookMenus({ ...context, runWithAgent: run })
    expect(withAgent.map((entry) => entry.id)).toEqual(['edit', 'view', 'insert', 'cell', 'runtime'])
    item(rows(withAgent.at(-1)!.items()), 'run-with-agent').onSelect()
    expect(run).toHaveBeenCalledOnce()
  })

  it('runs Edit commands on the selection, each one undo step', async () => {
    const { context, controller, sources } = await open([code('a', 'first'), code('b', 'second', [output])])
    const edit = menu(context, 'edit')
    expect(item(edit, 'paste-cells').disabled).toBe(true)
    item(edit, 'select-all-cells').onSelect()
    expect(controller.getState().selected).toHaveLength(2)
    item(menu(context, 'edit'), 'clear-all-outputs').onSelect()
    // The controller rereads the cells a microtask after the change.
    await Promise.resolve()
    expect(controller.getState().cells[1]!.outputs!.json).toBe('[]')
    item(menu(context, 'edit'), 'delete-cells').onSelect()
    expect(sources()).toEqual([])
    item(menu(context, 'edit'), 'undo').onSelect()
    expect(sources()).toEqual(['first', 'second'])
    item(menu(context, 'edit'), 'find').onSelect()
    item(menu(context, 'edit'), 'replace').onSelect()
    expect(context.find).toHaveBeenNthCalledWith(1, 'find')
    expect(context.find).toHaveBeenNthCalledWith(2, 'replace')
    item(menu(context, 'edit'), 'copy-cells').onSelect()
    expect(context.copy).toHaveBeenCalledOnce()
  })

  it('leaves viewers only what does not change the notebook', async () => {
    const hidden = code('a', 'secret', [output], { jupyter: { source_hidden: true } })
    const { context, key } = await open([hidden], { editable: false })
    const edit = menu(context, 'edit')
    expect(['undo', 'cut-cells', 'paste-cells', 'delete-cells', 'clear-outputs'].map((id) => item(edit, id).disabled)).toEqual([true, true, true, true, true])
    expect(item(edit, 'copy-cells').disabled).toBe(false)
    expect(item(menu(context, 'insert'), 'insert-code-below').disabled).toBe(true)
    // Hidden code opens for this viewer only.
    const show = item(menu(context, 'view'), 'toggle-code')
    expect(show.label).toBe('Show code')
    show.onSelect()
    expect(context.reveal).toHaveBeenCalledWith([key(0)], 'source')
  })

  it('checks the active cell type and changes it from Cell ▸ Cell type', async () => {
    const { context, controller } = await open([code('a', 'x'), markdown('b', '# Title')])
    const cell = menu(context, 'cell')
    expect(['type-code', 'type-markdown', 'type-raw'].map((id) => item(cell, id).checked)).toEqual([true, false, false])
    item(cell, 'type-raw').onSelect()
    expect(controller.getState().cells[0]!.type).toBe('raw')
    expect(item(cell, 'split').disabled).toBe(true)
  })

  it('merges the active cell with the one below, even with more cells selected', async () => {
    const { context, controller, sources, key } = await open([code('a', 'one'), code('b', 'two'), code('c', 'three')])
    controller.select(key(1))
    controller.select(key(2), { extend: true })
    expect(item(menu(context, 'cell'), 'merge-selected').disabled).toBe(false)
    // The last cell is active: nothing below it.
    expect(item(menu(context, 'cell'), 'merge-below').disabled).toBe(true)
    // With the first two selected, the active (second) cell takes the third, not the first.
    controller.select(key(0))
    controller.select(key(1), { extend: true })
    item(menu(context, 'cell'), 'merge-below').onSelect()
    expect(sources()).toEqual(['one', 'two\n\nthree'])
  })

  it('inserts cells and headings from Insert', async () => {
    const { context, controller } = await open([code('a', 'x')])
    item(menu(context, 'insert'), 'insert-markdown-below').onSelect()
    expect(controller.getState().cells.map((cell) => cell.type)).toEqual(['code', 'markdown'])
    expect(controller.getState().mode).toBe('edit')
    const heading = menu(context, 'insert').get('heading')
    expect(heading?.type === 'submenu' && heading.items.map((entry) => entry.type === 'item' && entry.label)).toEqual(['Heading 1', 'Heading 2', 'Heading 3', 'Heading 4', 'Heading 5', 'Heading 6'])
    item(menu(context, 'insert'), 'heading-3').onSelect()
    expect(context.insertHeading).toHaveBeenCalledWith(3)
    item(menu(context, 'insert'), 'duplicate').onSelect()
    expect(controller.getState().cells).toHaveLength(3)
  })

  it('keeps the Edit menu\'s command-mode letters out of the shortcuts dialog\'s Edit mode keys', async () => {
    const { context } = await open([code('a', 'x')])
    const groups = shortcutGroupsFromMenus(notebookMenus(context), notebookShortcutGroups())
    const labels = (title: string) => groups.find((group) => group.title === title)?.items.map((entry) => entry.label) ?? []
    // X, C, and V type letters while a cell is being edited: they are listed under the Edit menu's own name.
    expect(labels('Edit mode')).not.toContain('Cut cells')
    expect(labels('Edit mode')).not.toContain('Copy cells')
    expect(labels('Edit')).toEqual(expect.arrayContaining(['Cut cells', 'Copy cells', 'Paste cells below']))
    expect(labels('Edit mode')).toContain('Split the cell at the cursor')
  })

  it('groups collapsing in View, and keeps the toolbar\'s View options flat', async () => {
    const { context } = await open([code('a', 'x', [output])])
    const view = menu(context, 'view')
    expect(view.get('collapse')?.type).toBe('submenu')
    expect(item(view, 'outline').checked).toBe(false)
    item(view, 'line-numbers').onSelect()
    expect(context.setLineNumbers).toHaveBeenCalledWith(true)
    expect(item(view, 'output-scroll').disabled).toBe(false)
    expect(normalizeEntries(viewOptionEntries(context)).flatMap((entry) => entry.type === 'item' ? [entry.id] : [entry.type])).toEqual([
      'line-numbers', 'wrap', 'separator', 'collapse-code', 'expand-code', 'collapse-outputs', 'expand-outputs',
    ])
  })
})

describe('cell context menu', () => {
  it('offers output commands only for cells with outputs, and names the cells it deletes', async () => {
    const { context, controller, key } = await open([code('a', 'x', [output]), markdown('b', 'text')])
    const withOutputs = rows(cellContextEntries(context, key(0)))
    item(withOutputs, 'copy-output-text').onSelect()
    expect(context.copyOutputText).toHaveBeenCalledWith(key(0))
    expect(item(withOutputs, 'delete-cells').label).toBe('Delete cell')
    controller.select(key(1))
    expect(rows(cellContextEntries(context, key(1))).has('copy-output-text')).toBe(false)
    controller.selectAll()
    expect(item(rows(cellContextEntries(context, key(1))), 'delete-cells').label).toBe('Delete cells')
    expect(cellContextEntries(context, 'missing')).toEqual([])
  })

  it('moves and duplicates the selected cells', async () => {
    const { context, controller, sources, key } = await open([code('a', 'one'), code('b', 'two')])
    controller.select(key(1))
    item(rows(cellContextEntries(context, key(1))), 'move-up').onSelect()
    expect(sources()).toEqual(['two', 'one'])
    item(rows(cellContextEntries(context, controller.getState().active!)), 'duplicate').onSelect()
    expect(sources()).toEqual(['two', 'two', 'one'])
  })
})
