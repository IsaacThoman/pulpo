// Lets surfaces outside the chat page (e.g. the search dialog) return focus to
// whichever composer is currently mounted. At most one composer is on screen.
let focusActiveComposer: (() => void) | null = null

export function registerComposerFocus(focus: () => void) {
  focusActiveComposer = focus
  return () => {
    if (focusActiveComposer === focus) focusActiveComposer = null
  }
}

/** Focuses the mounted composer. Returns false when none is mounted. */
export function focusComposer() {
  if (!focusActiveComposer) return false
  focusActiveComposer()
  return true
}

// The side panel's composer is tracked apart from the page's, so each keeps its own target.
let focusPanelComposer: (() => void) | null = null

export function registerPanelComposerFocus(focus: () => void) {
  focusPanelComposer = focus
  return () => {
    if (focusPanelComposer === focus) focusPanelComposer = null
  }
}

/** Focuses the composer in the side panel. Returns false when none is mounted. */
export function focusSidePanelComposer() {
  if (!focusPanelComposer) return false
  focusPanelComposer()
  return true
}
