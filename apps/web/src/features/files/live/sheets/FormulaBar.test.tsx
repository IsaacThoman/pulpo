// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { SheetView, SheetViewState } from '@pulpo/client-core/office/sheets/view'
import { afterEach, expect, it, vi } from 'vitest'
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
