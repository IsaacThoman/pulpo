// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { MemoryLiveAssetStore } from '@pulpo/client-core/office'
import { WorkbookModel } from '@pulpo/client-core/office/sheets'
import { SheetView, type SheetRequest, type SheetViewState } from '@pulpo/client-core/office/sheets/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { FormulaBar } from './FormulaBar'

vi.mock('@/i18n/ui', () => ({ ui: (text: string) => text }))
afterEach(cleanup)

it.each(['Enter', 'Escape', 'Tab'])('ignores formula bar %s while composing and handles it afterwards', (key) => {
  const view = {
    commitEdit: vi.fn(() => true), cancelEdit: vi.fn(), focus: vi.fn(),
    clipboard: { moveWithin: vi.fn() }, getState: () => ({ activeInput: 'saved' }),
  }
  const state = { activeInput: 'saved', selectionLabel: 'A1', readOnly: false, editing: { text: 'にほん' } }
  const { getByLabelText } = render(<FormulaBar view={view as unknown as SheetView} state={state as SheetViewState} />)
  const bar = getByLabelText('Formula bar')
  for (const flags of [{ isComposing: true }, { keyCode: 229 }]) {
    expect(fireEvent.keyDown(bar, { key, ...flags })).toBe(true)
    expect(view.commitEdit).not.toHaveBeenCalled()
    expect(view.cancelEdit).not.toHaveBeenCalled()
    expect(view.clipboard.moveWithin).not.toHaveBeenCalled()
  }
  fireEvent.keyDown(bar, { key })
  expect(key === 'Escape' ? view.cancelEdit : view.commitEdit).toHaveBeenCalledOnce()
})

describe('a value a warning rule flags', () => {
  const views: SheetView[] = []
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
    for (const view of views.splice(0)) view.destroy()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  /** A1 takes 1 to 10, with a warning; the host claims the question, as SheetEditor does. */
  function setup() {
    const doc = new Y.Doc()
    WorkbookModel.initialize(doc).addSheet('Sheet1')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const view = new SheetView({ container, doc, assets: new MemoryLiveAssetStore(), user: { name: 'Ada', color: '#123456' } })
    views.push(view)
    const asked: Extract<SheetRequest, { request: 'validation' }>[] = []
    view.root.addEventListener('sheetrequest', (event) => {
      const detail = (event as CustomEvent<SheetRequest>).detail
      if (detail.request !== 'validation') return
      asked.push(detail)
      event.preventDefault()
    })
    view.select({ top: 0, left: 0, bottom: 0, right: 0 })
    view.setValidation({ type: 'whole', operator: 'between', formula1: '1', formula2: '10', errorStyle: 'warning' })
    const { getByLabelText } = render(<FormulaBar view={view} state={view.getState()} />)
    const bar = getByLabelText('Formula bar') as HTMLTextAreaElement
    bar.focus()
    fireEvent.change(bar, { target: { value: '50' } })
    return { view, bar, asked }
  }

  it.each([['Enter', 'A2'], ['Tab', 'B1']])('is asked about on formula bar %s, which moves on after a yes', (key, next) => {
    const { view, bar, asked } = setup()
    fireEvent.keyDown(bar, { key })
    expect(asked).toHaveLength(1)
    expect([view.editing?.text, view.inputText(0, 0), view.getState().selectionLabel]).toEqual(['50', '', 'A1'])
    asked[0]!.respond('accept')
    expect([view.editing, view.inputText(0, 0), view.getState().selectionLabel]).toEqual([undefined, '50', next])
  })
})
