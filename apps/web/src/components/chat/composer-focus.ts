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

// Lets content inside messages (e.g. a quiz's results) hand text to the mounted composer.
let insertIntoActiveComposer: ((text: string) => void) | null = null
const insertListeners = new Set<() => void>()

export function registerComposerInsert(insert: (text: string) => void) {
  insertIntoActiveComposer = insert
  insertListeners.forEach((listener) => listener())
  return () => {
    if (insertIntoActiveComposer !== insert) return
    insertIntoActiveComposer = null
    insertListeners.forEach((listener) => listener())
  }
}

/** Adds text to the mounted composer's draft for the user to review and send. Returns false when none is mounted. */
export function insertIntoComposer(text: string) {
  if (!insertIntoActiveComposer) return false
  insertIntoActiveComposer(text)
  return true
}

export function subscribeComposerInsert(listener: () => void) {
  insertListeners.add(listener)
  return () => { insertListeners.delete(listener) }
}

export function canInsertIntoComposer() {
  return insertIntoActiveComposer !== null
}

/** A draft with `text` added after any text already there. */
export function appendToDraft(draft: string, text: string) {
  const trimmed = draft.trimEnd()
  return trimmed ? `${trimmed}\n\n${text}` : text
}
