// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryLiveAssetStore } from '@pulpo/client-core/office'
import { cellSourceText, notebookCodec, orderedCells } from '@pulpo/client-core/office/notebook'
import { NotebookController, NotebookSearch, type NotebookSearchMatch } from '@pulpo/client-core/office/notebook/view'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { NotebookFindBar, type NotebookFindRequest } from './NotebookFindBar'

const disposers: Array<() => void> = []
afterEach(() => {
  cleanup()
  for (const dispose of disposers.splice(0).reverse()) dispose()
})

async function setup(readOnly = false) {
  const doc = new Y.Doc()
  const assets = new MemoryLiveAssetStore()
  const cells = [
    { id: 'a', cell_type: 'markdown', metadata: {}, source: '# Sales\nTotal sales by month.' },
    { id: 'b', cell_type: 'code', metadata: {}, execution_count: null, outputs: [], source: "sales = load('sales.csv')" },
  ]
  await notebookCodec.importFile(doc, new TextEncoder().encode(JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells })), { name: 'a.ipynb', assets })
  const awareness = new Awareness(doc)
  const controller = new NotebookController({ doc, awareness, assets, readOnly, user: { name: 'Ana', color: '#3366ff' } })
  const search = new NotebookSearch(controller)
  disposers.push(() => { search.destroy(); controller.destroy(); awareness.destroy(); doc.destroy() })
  return { doc, controller, search }
}

const sources = (doc: Y.Doc) => orderedCells(doc).map(({ cell }) => cellSourceText(cell))

function bar(search: NotebookSearch, request: NotebookFindRequest, options: { readOnly?: boolean; onClose?: (match: NotebookSearchMatch | null) => void } = {}) {
  return render(<NotebookFindBar search={search} request={request} readOnly={options.readOnly ?? false} onClose={options.onClose ?? (() => {})} />)
}

describe('notebook find bar', () => {
  it('counts matches as you type, steps with Enter and Shift+Enter, and focuses the field', async () => {
    const { search } = await setup()
    bar(search, { mode: 'find', text: '', nonce: 1 })
    const field = screen.getByRole('textbox', { name: 'Find in notebook' })
    expect(document.activeElement).toBe(field)
    fireEvent.change(field, { target: { value: 'sales' } })
    expect(screen.getByText('1 of 4')).toBeTruthy()
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(screen.getByText('2 of 4')).toBeTruthy()
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true })
    expect(screen.getByText('4 of 4')).toBeTruthy()
    // Matching case keeps the current match where it was ("sales.csv"), now the third of three.
    fireEvent.click(screen.getByRole('button', { name: 'Match case' }))
    expect(screen.getByText('3 of 3')).toBeTruthy()
    fireEvent.change(field, { target: { value: 'nothing here' } })
    expect(screen.getByText('No matches')).toBeTruthy()
  })

  it('says when a regular expression does not parse', async () => {
    const { search } = await setup()
    bar(search, { mode: 'find', text: 's[a', nonce: 1 })
    // As plain text, the brackets are literal.
    expect(screen.getByText('No matches')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Use regular expression' }))
    expect(screen.getByText('Invalid regular expression')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Find in notebook' }).getAttribute('aria-invalid')).toBe('true')
  })

  it('replaces one match and all of them, each one undo step, starting in the replace field when seeded', async () => {
    const { doc, controller, search } = await setup()
    bar(search, { mode: 'replace', text: 'sales', nonce: 1 })
    const replacement = screen.getByRole('textbox', { name: 'Replace with' })
    expect(document.activeElement).toBe(replacement)
    fireEvent.change(replacement, { target: { value: 'revenue' } })
    fireEvent.keyDown(replacement, { key: 'Enter' })
    expect(sources(doc)).toEqual(['# revenue\nTotal sales by month.', "sales = load('sales.csv')"])
    fireEvent.click(screen.getByRole('button', { name: 'Replace all' }))
    expect(sources(doc)).toEqual(['# revenue\nTotal revenue by month.', "revenue = load('revenue.csv')"])
    expect(screen.getByText('No matches')).toBeTruthy()
    act(() => controller.undo())
    expect(sources(doc)).toEqual(['# revenue\nTotal sales by month.', "sales = load('sales.csv')"])
    act(() => controller.undo())
    expect(sources(doc)[0]).toBe('# Sales\nTotal sales by month.')
  })

  it('offers no replacing when read only', async () => {
    const { search } = await setup(true)
    bar(search, { mode: 'replace', text: 'sales', nonce: 1 }, { readOnly: true })
    expect(screen.queryByRole('textbox', { name: 'Replace with' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Toggle replace' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Find in notebook' }))
  })

  it('closes with Escape, handing back the current match, and forgets its marks', async () => {
    const { controller, search } = await setup()
    const onClose = vi.fn()
    const view = bar(search, { mode: 'find', text: 'month', nonce: 1 }, { onClose })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Find in notebook' }), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledWith({ key: controller.getState().cells[0]!.key, from: 23, to: 28 })
    view.unmount()
    expect(search.getState().matches).toEqual([])
  })

  it('takes a new request while open: the selected text, and the replace field', async () => {
    const { search } = await setup()
    const view = bar(search, { mode: 'find', text: 'Total', nonce: 1 })
    expect(screen.getByText('1 of 1')).toBeTruthy()
    view.rerender(<NotebookFindBar search={search} request={{ mode: 'replace', text: 'csv', nonce: 2 }} readOnly={false} onClose={() => {}} />)
    expect((screen.getByRole('textbox', { name: 'Find in notebook' }) as HTMLInputElement).value).toBe('csv')
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Replace with' }))
  })
})
