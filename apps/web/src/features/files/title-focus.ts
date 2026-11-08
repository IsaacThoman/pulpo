/**
 * A document Files just created opens with its name selected in the title, ready to type over,
 * as the inline rename did before. Its view takes the request once, page or panel alike.
 */
let requested: string | null = null

export function requestTitleFocus(id: string): void {
  requested = id.toLowerCase()
}

/** Whether `id`'s title should take focus now; the request is used up either way. */
export function takeTitleFocus(id: string): boolean {
  if (requested !== id.toLowerCase()) return false
  requested = null
  return true
}
