// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fileEditorRoot } from './editor-root'
import { focusFileEditorIn, useEditorShortcuts, type EditorShortcutHandlers } from './use-editor-shortcuts'

afterEach(cleanup)

function Editor({ name, handlers, children }: { name: string; handlers: EditorShortcutHandlers; children?: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  useEditorShortcuts(root, handlers)
  return (
    <div ref={root} {...fileEditorRoot('document')}>
      <div role="textbox" tabIndex={0} aria-label={name} />
      {children}
    </div>
  )
}

/** A menu in a body portal, as the editors' menu bars, context menus, and dialogs render theirs. */
function PortalMenu({ name }: { name: string }) {
  return createPortal(<div role="menu" aria-label={name}><div role="menuitem" tabIndex={-1} aria-label={`${name} item`} /></div>, document.body)
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
    // Keys in the US slash and P places that type other characters elsewhere: Spanish and German
    // Zoom out ("-"), Dvorak's Undo (Z) and Cmd/Ctrl+L.
    expect(press(body, '-', { ctrlKey: true, metaKey: false, code: 'Slash' }).defaultPrevented).toBe(false)
    expect(press(body, 'z', { code: 'Slash' }).defaultPrevented).toBe(false)
    expect(press(body, 'l', { code: 'KeyP' }).defaultPrevented).toBe(false)
    expect(own.shortcuts).not.toHaveBeenCalled()
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

  it("prints and saves from the editor's own menus and dialogs, which are portals outside its root", () => {
    const main = handlers()
    const panel = handlers()
    render(<>
      <Editor name="Main" handlers={main}><PortalMenu name="File" /></Editor>
      <aside data-side-panel=""><Editor name="Panel" handlers={panel}><PortalMenu name="Panel file" /></Editor></aside>
      <PortalMenu name="Chat" />
    </>)
    const fileItem = screen.getByRole('menuitem', { name: 'File item' })
    expect(press(fileItem, 'p').defaultPrevented).toBe(true)
    expect(main.print).toHaveBeenCalledOnce()
    expect(press(fileItem, 's', { metaKey: false, ctrlKey: true }).defaultPrevented).toBe(true)
    expect(main.save).toHaveBeenCalledOnce()
    // Find, replace, and the shortcuts dialog stay with focus in the document.
    press(fileItem, 'f')
    press(fileItem, '/')
    expect(main.find).not.toHaveBeenCalled()
    expect(main.shortcuts).not.toHaveBeenCalled()
    // The side panel's editor prints its own document from its menus.
    press(screen.getByRole('menuitem', { name: 'Panel file item' }), 'p')
    expect(panel.print).toHaveBeenCalledOnce()
    expect(main.print).toHaveBeenCalledOnce()
    // A menu no editor opened (the chat's) keeps the browser's keys.
    expect(press(screen.getByRole('menuitem', { name: 'Chat item' }), 'p').defaultPrevented).toBe(false)
    expect(main.print).toHaveBeenCalledOnce()
    expect(panel.print).toHaveBeenCalledOnce()
  })

  it('lets a host put focus back in the editor shown in a view', () => {
    const own = handlers()
    render(<section aria-label="View"><Editor name="Body" handlers={own} /></section>)
    expect(focusFileEditorIn(screen.getByRole('region', { name: 'View' }))).toBe(true)
    expect(own.focus).toHaveBeenCalledOnce()
    expect(focusFileEditorIn(document.createElement('div'))).toBe(false)
  })
})
