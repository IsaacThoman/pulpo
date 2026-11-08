// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { focusFileEditorIn, useEditorShortcuts, type EditorShortcutHandlers } from './use-editor-shortcuts'

afterEach(cleanup)

function Editor({ name, handlers }: { name: string; handlers: EditorShortcutHandlers }) {
  const root = useRef<HTMLDivElement>(null)
  useEditorShortcuts(root, handlers)
  return (
    <div ref={root} data-file-editor="document">
      <div role="textbox" tabIndex={0} aria-label={name} />
    </div>
  )
}

const handlers = () => ({ print: vi.fn(), save: vi.fn(), shortcuts: vi.fn(), find: vi.fn(), replace: vi.fn(), focus: vi.fn() })
const press = (target: EventTarget, key: string, more: Partial<KeyboardEventInit> = {}) => {
  const event = new KeyboardEvent('keydown', { key, metaKey: true, bubbles: true, cancelable: true, ...more })
  target.dispatchEvent(event)
  return event
}

describe('useEditorShortcuts', () => {
  it('prints, confirms saving, and opens the shortcuts and find from inside the editor', () => {
    const own = handlers()
    render(<Editor name="Body" handlers={own} />)
    const body = screen.getByRole('textbox', { name: 'Body' })
    expect(press(body, 'p').defaultPrevented).toBe(true)
    expect(own.print).toHaveBeenCalledOnce()
    expect(press(body, 's', { metaKey: false, ctrlKey: true }).defaultPrevented).toBe(true)
    expect(own.save).toHaveBeenCalledOnce()
    press(body, '/')
    expect(own.shortcuts).toHaveBeenCalledOnce()
    // German layouts type "/" with Shift.
    press(body, '/', { shiftKey: true, code: 'Slash' })
    expect(own.shortcuts).toHaveBeenCalledTimes(2)
    press(body, 'f')
    expect(own.find).toHaveBeenCalledOnce()
    // Held keys repeat; the dialog and the print opened once.
    expect(press(body, 'p', { repeat: true }).defaultPrevented).toBe(true)
    expect(own.print).toHaveBeenCalledOnce()
  })

  it('leaves keys the editor handled, and other combos, alone', () => {
    const own = handlers()
    render(<Editor name="Body" handlers={own} />)
    const body = screen.getByRole('textbox', { name: 'Body' })
    // A code editor's Cmd/Ctrl+/ comments lines out first.
    body.addEventListener('keydown', (event) => { if (event.key === '/') event.preventDefault() }, { once: true })
    press(body, '/')
    expect(own.shortcuts).not.toHaveBeenCalled()
    expect(press(body, 'p', { shiftKey: true }).defaultPrevented).toBe(false)
    expect(press(body, 'p', { metaKey: false }).defaultPrevented).toBe(false)
    expect(own.print).not.toHaveBeenCalled()
  })

  it('still saves without a host, so the browser never offers to save the page', () => {
    render(<Editor name="Body" handlers={{}} />)
    expect(press(screen.getByRole('textbox', { name: 'Body' }), 's').defaultPrevented).toBe(true)
  })

  it('takes print and save from the page itself only for the one editor in the main view', () => {
    const main = handlers()
    const panel = handlers()
    const view = render(<>
      <Editor name="Main" handlers={main} />
      <aside data-side-panel=""><Editor name="Panel" handlers={panel} /></aside>
      <textarea aria-label="Composer" />
    </>)
    expect(press(document.body, 'p').defaultPrevented).toBe(true)
    expect(main.print).toHaveBeenCalledOnce()
    press(document.body, 's')
    expect(main.save).toHaveBeenCalledOnce()
    // The page has no editor focus: the dialog and find stay the browser's.
    press(document.body, '/')
    press(document.body, 'f')
    expect(main.shortcuts).not.toHaveBeenCalled()
    expect(main.find).not.toHaveBeenCalled()
    expect(panel.print).not.toHaveBeenCalled()
    // Never from the chat composer, or any other field.
    expect(press(screen.getByRole('textbox', { name: 'Composer' }), 'p').defaultPrevented).toBe(false)
    // The panel's editor still takes its own keys.
    press(screen.getByRole('textbox', { name: 'Panel' }), 'p')
    expect(panel.print).toHaveBeenCalledOnce()
    expect(main.print).toHaveBeenCalledOnce()
    // Two editors in the main view: the page's keys belong to neither.
    view.rerender(<><Editor name="Main" handlers={main} /><Editor name="Second" handlers={handlers()} /></>)
    expect(press(document.body, 'p').defaultPrevented).toBe(false)
  })

  it('lets a host put focus back in the editor shown in a view', () => {
    const own = handlers()
    render(<section aria-label="View"><Editor name="Body" handlers={own} /></section>)
    expect(focusFileEditorIn(screen.getByRole('region', { name: 'View' }))).toBe(true)
    expect(own.focus).toHaveBeenCalledOnce()
    expect(focusFileEditorIn(document.createElement('div'))).toBe(false)
  })
})
