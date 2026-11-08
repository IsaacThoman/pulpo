// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { useEditorShortcuts, type EditorShortcutHandlers } from './use-editor-shortcuts'

// The platform is read once, when the shortcut helpers load.
vi.hoisted(() => Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true }))

afterEach(cleanup)

function Editor({ handlers }: { handlers: EditorShortcutHandlers }) {
  const root = useRef<HTMLDivElement>(null)
  useEditorShortcuts(root, handlers)
  return <div ref={root} data-file-editor="document"><div role="textbox" tabIndex={0} aria-label="Body" /></div>
}

const press = (target: EventTarget, key: string, more: Partial<KeyboardEventInit> = {}) => {
  const event = new KeyboardEvent('keydown', { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : '', bubbles: true, cancelable: true, ...more })
  target.dispatchEvent(event)
  return event
}

it('on a Mac, leaves Control combos to the text field and takes the Command ones', () => {
  const own = { print: vi.fn(), save: vi.fn(), shortcuts: vi.fn(), find: vi.fn(), replace: vi.fn() }
  render(<Editor handlers={own} />)
  const body = screen.getByRole('textbox', { name: 'Body' })
  // Ctrl+P is line up, Ctrl+F forward a character, Ctrl+Cmd+F full screen.
  expect(press(body, 'p', { ctrlKey: true }).defaultPrevented).toBe(false)
  expect(press(body, 's', { ctrlKey: true }).defaultPrevented).toBe(false)
  expect(press(body, 'f', { ctrlKey: true }).defaultPrevented).toBe(false)
  expect(press(body, 'f', { ctrlKey: true, metaKey: true }).defaultPrevented).toBe(false)
  expect(press(body, 'H', { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false)
  expect(press(body, '/', { ctrlKey: true, code: 'Slash' }).defaultPrevented).toBe(false)
  expect(press(document.body, 'p', { ctrlKey: true }).defaultPrevented).toBe(false)
  expect(Object.values(own).every((handler) => handler.mock.calls.length === 0)).toBe(true)
  expect(press(body, 'p', { metaKey: true }).defaultPrevented).toBe(true)
  expect(press(body, 's', { metaKey: true }).defaultPrevented).toBe(true)
  press(body, 'f', { metaKey: true })
  press(body, 'H', { metaKey: true, shiftKey: true })
  press(body, '/', { metaKey: true, code: 'Slash' })
  expect([own.print, own.save, own.find, own.replace, own.shortcuts].map((handler) => handler.mock.calls.length)).toEqual([1, 1, 1, 1, 1])
})
