import type { SheetView } from '@pulpo/client-core/office/sheets/view'

/**
 * A dialog's `onCloseAutoFocus` that hands focus back to the grid once it has closed, wherever it
 * was opened from (a menu, the toolbar, a key), so typing goes on in the sheet.
 */
export const focusGridOnClose = (view: Pick<SheetView, 'focus'>) => (event: Event) => {
  event.preventDefault()
  view.focus()
}

/**
 * Whether focus has nowhere to be, as when a menu has just closed (Escape, a command run). A menu
 * hands focus back to the grid only then: a click that closed it by going on to the menu bar, the
 * name box or a dialog keeps the focus it took.
 */
export function focusIsIdle(): boolean {
  const active = document.activeElement
  return !active || active === document.body
}
