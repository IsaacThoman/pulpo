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
