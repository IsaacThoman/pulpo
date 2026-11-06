// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { LiveEditorProps } from '../types'
import { SheetDocEditor } from './SheetDocEditor'

const editor = vi.hoisted(() => vi.fn((_props: { fileFormat?: string }) => null))
vi.mock('./SheetEditor', () => ({ SheetEditor: editor }))
vi.mock('../../editor/presence', () => ({ sessionLabel: () => 'Test', sessionColor: () => '#123456' }))
afterEach(cleanup)

it('passes the current file extension to the editor on open and rename', () => {
  const props = { session: { doc: { clientID: 1 }, provider: { awareness: {} } }, editable: true } as LiveEditorProps
  const { rerender } = render(<SheetDocEditor {...props} name="Book.xlsx" />)
  expect(editor.mock.lastCall?.[0]).toMatchObject({ fileFormat: 'xlsx' })
  rerender(<SheetDocEditor {...props} name="Book.csv" />)
  expect(editor.mock.lastCall?.[0]).toMatchObject({ fileFormat: 'csv' })
})
