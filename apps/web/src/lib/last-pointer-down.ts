/*
 * Where the pointer last went down, for keys that go to the view last clicked (the Files views,
 * the main view's and the side panel's tabs).
 */
let last: Element | null = null
let lastInPanel = false
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (event) => {
    last = event.target instanceof Element ? event.target : null
    lastInPanel = Boolean(last?.closest('[data-side-panel]'))
  }, true)
}

/**
 * Whether the pointer last went down in the side panel, decided as it did: what was clicked may be
 * gone since (a folder opened from its listing replaces the rows).
 */
export function lastPointerDownInPanel(): boolean {
  return lastInPanel
}
