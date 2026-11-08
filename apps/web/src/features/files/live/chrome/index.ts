/**
 * Shared chrome for the live editors (Word, spreadsheets, presentations, notebooks, text): the
 * menu bar and its File menu, the shortcuts dialog and keys, and controls the toolbars share.
 * See docs/files.md ("Editor chrome").
 */
export { EditorMenuBar } from './EditorMenuBar'
export { normalizeEntries, separator, shortcutGroupsFromMenus, type MenuDefinition, type MenuEntry, type MenuIcon, type MenuItemEntry } from './menu'
export { MenuSearchDialog } from './MenuSearchDialog'
export { flattenMenus, searchMenuCommands, type MenuCommand } from './menu-search'
export { isMenuBarKey, isMenuSearchKey, MENU_SEARCH_ID, MENU_SEARCH_SHORTCUT, menuBarAriaKeys, menuBarKeyText } from './menu-keys'
export { ariaKeyShortcuts, filterShortcutGroups, formatShortcut, keyName, matchesShortcut, shortcutKeyText, type ShortcutGroup, type ShortcutItem, type ShortcutSpec } from './shortcuts'
export { editorOwnsKey, FILE_EDITOR_ATTRIBUTE, fileEditorRoot, isInFileEditor } from './editor-root'
export { composeFileMenu, fileMenuDefinition, nativeDownloadLabel, type EditorFileMenuParts, type FileMenuCommand, type FileMenuHost } from './file-menu'
export { findEntries, helpMenu, redoShortcut, UNDO_SHORTCUT, undoRedoEntries } from './standard-menus'
export { ShortcutsDialog } from './ShortcutsDialog'
export {
  FIND_SHORTCUT,
  focusFileEditorIn,
  PRINT_SHORTCUT,
  replaceShortcut,
  SAVE_SHORTCUT,
  SHORTCUTS_SHORTCUT,
  useEditorShortcuts,
  type EditorShortcutHandlers,
} from './use-editor-shortcuts'
export { LinkDialog, type LinkDialogValue } from './LinkDialog'
export { normalizeLink, type LinkCheck, type LinkTargetAccept } from './link'
export { FontSizeInput } from './FontSizeInput'
export { FONT_SIZE_PRESETS, formatFontSize, MAX_FONT_SIZE, MIN_FONT_SIZE, parseFontSize } from './font-size'
export { ZoomControl } from './ZoomControl'
export { steppedZoom, ZOOM_PRESETS, zoomMenu, zoomPercent, type ZoomOptions } from './zoom'
export { printHtmlDocument, saveFile, textPrintHtml } from './output'
