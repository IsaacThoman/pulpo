// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { editorOwnsKey } from './editor-root'

// The platform is read once, when the shortcut helpers load.
vi.hoisted(() => Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true }))

afterEach(() => { document.body.innerHTML = '' })

/** What an app shortcut listener on the window sees for a key pressed in a (read-only) Word body. */
function pressInDocument(init: KeyboardEventInit) {
  document.body.innerHTML = '<div data-file-editor="document"><div role="textbox" tabindex="0"></div></div>'
  let seen: { owns: boolean; prevented: boolean } | undefined
  const listener = (event: KeyboardEvent) => { seen = { owns: editorOwnsKey(event), prevented: event.defaultPrevented } }
  window.addEventListener('keydown', listener)
  document.querySelector('[role="textbox"]')!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
  window.removeEventListener('keydown', listener)
  return seen
}

it("on a Mac, claims a document's Cmd formatting combos and leaves the Control ones to the text field", () => {
  // Cmd+B, Cmd+J, and Cmd+comma would otherwise run the browser's (bookmarks, downloads, settings).
  expect(pressInDocument({ key: 'b', metaKey: true })).toEqual({ owns: true, prevented: true })
  expect(pressInDocument({ key: 'j', metaKey: true })).toEqual({ owns: true, prevented: true })
  expect(pressInDocument({ key: ',', metaKey: true })).toEqual({ owns: true, prevented: true })
  // Ctrl+B moves back a character there: the app leaves it alone and so does the editor.
  expect(pressInDocument({ key: 'b', ctrlKey: true })).toEqual({ owns: true, prevented: false })
  expect(pressInDocument({ key: 'j', ctrlKey: true, metaKey: true })).toEqual({ owns: true, prevented: false })
  // Shift combos are the browser's (Cmd+Shift+B shows the bookmarks bar).
  expect(pressInDocument({ key: 'B', metaKey: true, shiftKey: true })).toEqual({ owns: false, prevented: false })
})
