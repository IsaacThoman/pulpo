// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { MemoryLiveAssetStore } from '@pulpo/client-core/office'
import { WorkbookModel } from '@pulpo/client-core/office/sheets'
import type { SheetView } from '@pulpo/client-core/office/sheets/view'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { exportSheetFile } from './calculation'
import { SheetEditor } from './SheetEditor'

vi.mock('@/i18n/ui', () => ({ ui: (text: string) => text }))
vi.mock('./SheetToolbar', () => ({ SheetToolbar: () => null }))
vi.mock('./SheetTabs', () => ({ SheetTabs: () => null }))
vi.mock('./SheetDialogs', () => ({ FindDialog: () => null, NoteDialog: () => null }))

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
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('registers export settlement and updates file format and read only without replacing the view', async () => {
  const doc = new Y.Doc()
  const book = WorkbookModel.initialize(doc)
  const sheet = book.addSheet('Sheet1')
  const assets = new MemoryLiveAssetStore()
  let view!: SheetView
  const onView = (created: SheetView | undefined) => { if (created) view = created }
  const props = { doc, assets, user: { name: 'Test', color: '#123456' }, onView }
  const { rerender, unmount } = render(<SheetEditor {...props} fileFormat="xlsx" />)
  const original = view
  act(() => { view.beginEdit('pending export') })
  let bytes!: Uint8Array
  await act(async () => { bytes = await exportSheetFile(doc, 'Book.csv', assets) })
  expect(new TextDecoder().decode(bytes)).toBe('pending export\r\n')
  rerender(<SheetEditor {...props} fileFormat="csv" />)
  expect(view).toBe(original)
  expect(view.valuesOnly).toBe(true)
  act(() => { view.beginEdit('discarded') })
  rerender(<SheetEditor {...props} fileFormat="csv" readOnly />)
  expect(view.editing).toBeUndefined()
  view.undo()
  expect(sheet.cell(0, 0)?.v).toBe('pending export')
  rerender(<SheetEditor {...props} fileFormat="csv" />)
  act(() => { view.beginEdit('pending close') })
  unmount()
  expect(sheet.cell(0, 0)?.v).toBe('pending close')
})
