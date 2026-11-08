import type { SheetView } from '@pulpo/client-core/office/sheets/view'

/**
 * A dialog's `onCloseAutoFocus` that hands focus back to the grid once it has closed, wherever it
 * was opened from (a menu, the toolbar, a key), so typing goes on in the sheet.
 */
export const focusGridOnClose = (view: Pick<SheetView, 'focus'>) => (event: Event) => {
  event.preventDefault()
  view.focus()
}
