// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryLiveAssetStore } from '@pulpo/client-core/office'
import { WorkbookModel } from '@pulpo/client-core/office/sheets'
import { SheetView } from '@pulpo/client-core/office/sheets/view'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { sheetShortcutGroups } from './sheet-shortcuts'
import { SheetToolbar } from './SheetToolbar'

// The keys a Mac gets.
vi.mock('../../browser/shortcuts', async (original) => ({ ...await original<typeof import('../../browser/shortcuts')>(), isAppleShortcut: () => true }))

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
  cleanup()
  for (const view of views.splice(0)) view.destroy()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// Chrome reopens a closed tab on Cmd+Shift+T before the page sees it, so a Mac is shown Control+=.
it('advertises Control+= for AutoSum on a Mac, with Cmd+Shift+T as the other key', () => {
  const autoSum = sheetShortcutGroups().flatMap((group) => group.items).find((item) => item.label === 'AutoSum')!
  expect(autoSum.keys).toEqual(['⌃=', { key: 't', mod: true, shift: true }])
  const doc = new Y.Doc()
  WorkbookModel.initialize(doc).addSheet('Sheet1')
  const view = new SheetView({ container: document.createElement('div'), doc, assets: new MemoryLiveAssetStore(), user: { name: 'Ada', color: '#123456' } })
  views.push(view)
  const noop = () => {}
  render(<SheetToolbar view={view} state={view.getState()} onFind={noop} onNote={noop} onLink={noop} onInsertImage={noop} onPrint={noop} onCustomNumberFormat={noop} />)
  const sum = screen.getByRole('button', { name: 'Sum' })
  expect(sum.getAttribute('aria-keyshortcuts')).toBe('Control+=')
  expect(sum.getAttribute('title')).toBe('Sum (⌃=)')
})
