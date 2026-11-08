// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { MemoryLiveAssetStore } from '@pulpo/client-core/office'
import { MAX_COLS, WorkbookModel, type DataValidation } from '@pulpo/client-core/office/sheets'
import { SheetView, type SheetRequest, type SheetSummary } from '@pulpo/client-core/office/sheets/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { ConditionalFormatDialog } from './ConditionalFormatDialog'
import { NumberFormatDialog } from './NumberFormatDialog'
import { DeleteLinesDialog, ResizeLinesDialog, ValidationPrompt, type ValidationRequest } from './SheetDialogs'
import { SummaryChooser } from './SheetStatus'
import { SortRangeDialog } from './SortRangeDialog'
import { ValidationDialog } from './ValidationDialog'

let views: SheetView[] = []

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  const context = new Proxy({ measureText: (text: string) => ({ width: String(text).length * 7 }) }, {
    get: (target, key) => target[key as keyof typeof target] ?? (() => {}),
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
})
afterEach(() => {
  cleanup()
  for (const view of views) view.destroy()
  views = []
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function makeView(): SheetView {
  const doc = new Y.Doc()
  const book = WorkbookModel.initialize(doc)
  const sheet = book.addSheet('Sheet1')
  const rows: [string, number, number][] = [['North', 30, 3], ['south', 10, 1], ['East', 20, 2], ['West', 10, 4]]
  sheet.setCell(0, 0, { v: 'Region' })
  sheet.setCell(0, 1, { v: 'Sales' })
  sheet.setCell(0, 2, { v: 'Rank' })
  rows.forEach(([region, sales, rank], index) => {
    sheet.setCell(index + 1, 0, { v: region })
    sheet.setCell(index + 1, 1, { v: sales })
    sheet.setCell(index + 1, 2, { v: rank })
  })
  const view = new SheetView({ container: document.createElement('div'), doc, assets: new MemoryLiveAssetStore(), user: { name: 'Ada', color: '#123456' } })
  vi.spyOn(view, 'focus')
  views.push(view)
  return view
}

/** A dialog's host: open until it asks to close. */
function Open({ children }: { children: (open: boolean, setOpen: (open: boolean) => void) => React.ReactNode }) {
  const [open, setOpen] = useState(true)
  return <>{children(open, setOpen)}</>
}

describe('ValidationPrompt', () => {
  const request = (style: 'warning' | 'information', respond: (answer: string) => void): ValidationRequest => ({ request: 'validation', style, message: 'Enter 1 to 10.', row: 0, col: 0, respond })

  it.each([
    ['Yes', 'accept'],
    ['No', 'retry'],
    ['Cancel', 'cancel'],
  ])('answers a warning’s %s once the prompt has closed', async (button, answer) => {
    const respond = vi.fn()
    function Host() {
      const [shown, setShown] = useState<ValidationRequest | undefined>(request('warning', respond))
      return <ValidationPrompt request={shown} onDone={() => setShown(undefined)} />
    }
    render(<Host />)
    const dialog = screen.getByRole('alertdialog', { name: 'Invalid data' })
    expect(dialog.textContent).toContain('Enter 1 to 10.')
    expect(dialog.textContent).toContain('Continue?')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Yes' }))
    fireEvent.click(screen.getByRole('button', { name: button }))
    await waitFor(() => expect(respond).toHaveBeenCalledWith(answer))
    expect(respond).toHaveBeenCalledOnce()
  })

  it('offers OK and Cancel for an information rule, and Escape cancels', async () => {
    const respond = vi.fn()
    function Host() {
      const [shown, setShown] = useState<ValidationRequest | undefined>({ ...request('information', respond), title: 'Heads up' })
      return <ValidationPrompt request={shown} onDone={() => setShown(undefined)} />
    }
    render(<Host />)
    expect(screen.getByRole('alertdialog', { name: 'Heads up' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'No' })).toBeNull()
    expect(screen.queryByText('Continue?')).toBeNull()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await waitFor(() => expect(respond).toHaveBeenCalledWith('cancel'))
  })
})

describe('line dialogs', () => {
  it('deletes the rows or the columns of the selected cells', () => {
    const view = makeView()
    view.select({ top: 1, left: 1, bottom: 2, right: 2 })
    render(<Open>{(open, setOpen) => <DeleteLinesDialog view={view} open={open} onOpenChange={setOpen} />}</Open>)
    expect(screen.getByLabelText('Delete rows 2–3')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Delete columns B–C'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(view.inputText(1, 1)).toBe('')
    expect(view.inputText(0, 1)).toBe('')
    expect(view.inputText(1, 0)).toBe('North')
  })

  it('resizes the selected rows in pixels, refuses nonsense, and fits to data', () => {
    const view = makeView()
    view.select({ top: 1, left: 0, bottom: 2, right: MAX_COLS - 1 })
    const resize = vi.spyOn(view, 'resizeLines')
    const fit = vi.spyOn(view, 'autoFit')
    const { unmount } = render(<Open>{(open, setOpen) => <ResizeLinesDialog view={view} kind={open ? 'row' : undefined} onOpenChange={setOpen} />}</Open>)
    expect(screen.getByRole('dialog', { name: 'Resize rows 2–3' })).toBeTruthy()
    const size = screen.getByLabelText('Row height in pixels') as HTMLInputElement
    expect(size.value).toBe(String(Math.round(view.rows.size(1))))
    fireEvent.change(size, { target: { value: 'tall' } })
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(screen.getByRole('alert').textContent).toBe('Enter a size from 2 to 2000 pixels.')
    fireEvent.change(size, { target: { value: '42' } })
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(resize).toHaveBeenCalledWith('row', 42)
    unmount()
    render(<Open>{(open, setOpen) => <ResizeLinesDialog view={view} kind={open ? 'col' : undefined} onOpenChange={setOpen} />}</Open>)
    fireEvent.click(screen.getByLabelText('Fit to data'))
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(fit).toHaveBeenCalledWith('col')
  })
})

describe('NumberFormatDialog', () => {
  it('previews the active cell and a negative number, refuses invalid codes, and applies', async () => {
    const view = makeView()
    view.select({ top: 1, left: 1, bottom: 1, right: 1 })
    render(<Open>{(open, setOpen) => <NumberFormatDialog view={view} open={open} onOpenChange={setOpen} />}</Open>)
    const code = screen.getByLabelText('Format code')
    expect(document.activeElement).toBe(code)
    fireEvent.change(code, { target: { value: '"$"#,##0.00;[Red]-"$"#,##0.00' } })
    const preview = document.querySelector('[data-number-format-preview]')!
    expect(preview.textContent).toContain('$30.00')
    expect(preview.textContent).toContain('-$30.00')
    fireEvent.change(code, { target: { value: '0.0"' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(screen.getByRole('alert').textContent).toBe("This number format isn't valid.")
    fireEvent.click(screen.getByRole('button', { name: '0.00%' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(view.styleAt(1, 1).numFmt).toBe('0.00%')
    await waitFor(() => expect(view.focus).toHaveBeenCalled())
  })
})

describe('ValidationDialog', () => {
  it('creates a dropdown on the selection, then edits that rule in place', () => {
    const view = makeView()
    view.select({ top: 1, left: 3, bottom: 4, right: 3 })
    const { unmount } = render(<Open>{(open, setOpen) => <ValidationDialog view={view} open={open} onOpenChange={setOpen} />}</Open>)
    expect(screen.getByRole('dialog', { name: 'Data validation' }).textContent).toContain('D2:D5')
    fireEvent.change(screen.getByLabelText('Items, one per line'), { target: { value: 'Open\nDone' } })
    fireEvent.click(screen.getByLabelText('Reject the input'))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    const rules = () => [...view.sheet.dv.values()] as DataValidation[]
    expect(rules()).toHaveLength(1)
    expect(rules()[0]).toMatchObject({ type: 'list', formula1: '"Open,Done"', errorStyle: 'stop' })
    unmount()

    view.select({ top: 2, left: 3, bottom: 2, right: 3 })
    render(<Open>{(open, setOpen) => <ValidationDialog view={view} open={open} onOpenChange={setOpen} />}</Open>)
    expect(screen.getByRole('dialog', { name: 'Edit data validation rule' }).textContent).toContain('D2:D5')
    const items = screen.getByLabelText('Items, one per line') as HTMLTextAreaElement
    expect(items.value).toBe('Open\nDone')
    fireEvent.change(items, { target: { value: 'Open\nDone\nLater' } })
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(rules()).toHaveLength(1)
    expect(rules()[0]).toMatchObject({ formula1: '"Open,Done,Later"' })
    expect(view.listItems(rules()[0]!, { row: 4, col: 3 })).toEqual(['Open', 'Done', 'Later'])
  })

  it('explains what is missing, and removes the rule', () => {
    const view = makeView()
    view.select({ top: 1, left: 3, bottom: 2, right: 3 })
    view.setValidation({ type: 'list', formula1: '"A,B"' })
    render(<Open>{(open, setOpen) => <ValidationDialog view={view} open={open} onOpenChange={setOpen} />}</Open>)
    fireEvent.change(screen.getByLabelText('Items, one per line'), { target: { value: 'x, y' } })
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByRole('alert').textContent).toBe("Items can't contain commas.")
    fireEvent.click(screen.getByRole('button', { name: 'Remove rule' }))
    expect(view.sheet.dv.size).toBe(0)
  })
})

describe('ConditionalFormatDialog', () => {
  it('adds a single color rule with a preset style, and a color scale', async () => {
    const view = makeView()
    view.select({ top: 1, left: 1, bottom: 4, right: 1 })
    const { unmount } = render(<Open>{(open, setOpen) => <ConditionalFormatDialog view={view} open={open} onOpenChange={setOpen} />}</Open>)
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByRole('alert').textContent).toBe('Enter a value.')
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '15' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Green fill with dark green text' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(view.cellRender(1, 1).overlay?.style?.fill).toEqual({ rgb: 'FFC6EFCE' })
    expect(view.cellRender(2, 1).overlay?.style?.fill).toBeUndefined()
    unmount()

    render(<Open>{(open, setOpen) => <ConditionalFormatDialog view={view} open={open} tab="scale" onOpenChange={setOpen} />}</Open>)
    fireEvent.click(screen.getByRole('radio', { name: 'Green to white' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    const rules = [...view.sheet.cf.values()] as { rules: { type: string }[] }[]
    expect(rules.flatMap((format) => format.rules.map((rule) => rule.type)).sort()).toEqual(['cellIs', 'colorScale'])
  })
})

describe('SortRangeDialog', () => {
  it('keeps the header row and sorts by two columns', () => {
    const view = makeView()
    view.select({ top: 0, left: 0, bottom: 4, right: 2 })
    render(<Open>{(open, setOpen) => <SortRangeDialog view={view} open={open} onOpenChange={setOpen} />}</Open>)
    expect((screen.getByLabelText('Data has header row') as HTMLInputElement).checked).toBe(true)
    const sort = vi.spyOn(view, 'sortArea')
    fireEvent.click(screen.getByRole('button', { name: 'Add another sort column' }))
    fireEvent.click(screen.getAllByLabelText('Z → A')[1]!)
    fireEvent.click(screen.getByLabelText('Case sensitive'))
    fireEvent.click(screen.getByRole('button', { name: 'Sort' }))
    expect(sort).toHaveBeenCalledWith({ top: 1, left: 0, bottom: 4, right: 2 }, [{ col: 0, descending: false }, { col: 1, descending: true }], { caseSensitive: true })
  })
})

describe('SummaryChooser', () => {
  const summary: SheetSummary = { count: 3, numbers: 2, sum: 30, average: 15, min: 10, max: 20 }

  it('shows nothing for one cell, the sum by default, and remembers another figure', async () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) })
    const { rerender } = render(<SummaryChooser summary={{ ...summary, count: 1 }} />)
    expect(screen.queryByRole('button')).toBeNull()
    rerender(<SummaryChooser summary={summary} />)
    const button = screen.getByRole('button', { name: 'Selection summary: Sum: 30' })
    fireEvent.keyDown(button, { key: 'Enter' })
    expect((await screen.findByRole('menuitemradio', { name: 'Sum: 30' })).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Max: 20' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Selection summary: Max: 20' })).toBeTruthy())
    cleanup()
    render(<SummaryChooser summary={summary} />)
    expect(screen.getByRole('button').textContent).toContain('Max: 20')
  })
})

describe('sheet requests', () => {
  it('lets a host claim a request, and leaves it to the browser otherwise', () => {
    const view = makeView()
    const container = view.root.parentElement!
    expect(view.request({ request: 'print' })).toBe(false)
    const claim = (event: Event) => { if ((event as CustomEvent<SheetRequest>).detail.request === 'print') event.preventDefault() }
    container.addEventListener('sheetrequest', claim)
    expect(view.request({ request: 'print' })).toBe(true)
    container.removeEventListener('sheetrequest', claim)
  })
})
