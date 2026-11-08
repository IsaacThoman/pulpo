import { fileExtension } from '@pulpo/contracts'
import { Copy, Download, FilePlus2, FolderInput, FolderOpen, Info, Link2, Pencil, Pin, PinOff, Printer, Trash2 } from 'lucide-react'
import { ui } from '@/i18n/ui'
import { normalizeEntries, separator, type MenuDefinition, type MenuEntry, type MenuIcon } from './menu'
import { PRINT_SHORTCUT } from './use-editor-shortcuts'

/** A command the Files page offers in an editor's File menu, e.g. File ▸ New ▸ Spreadsheet. */
export interface FileMenuCommand {
  id: string
  label: string
  icon?: MenuIcon
  disabled?: boolean
  onSelect: () => void
}

/**
 * What Files offers around an open document, passed to editors as `LiveEditorProps.fileMenu`.
 * Every part is optional: harness pages and read-only views pass less, or nothing.
 */
export interface FileMenuHost {
  /** The file's name, for the native download's label ("Microsoft Word (.docx)"). */
  name: string
  /** File ▸ New: a document of each live format, created beside this one and opened. */
  create?: readonly FileMenuCommand[]
  makeCopy?: () => void
  /** The native format, exported from the open document (edits not synced yet included). */
  download?: () => void
  /** The server's PDF, when the office converter is configured. */
  downloadPdf?: () => void
  /** True while that PDF is being exported (a toast shows it): the item waits for it. */
  pdfBusy?: boolean
  copyLink?: () => void
  /** Puts focus in the title, with the name selected. */
  rename?: () => void
  move?: () => void
  pin?: { pinned: boolean; toggle: () => void }
  showInFolder?: () => void
  /** Moves the file to the trash (with an undo toast) and leaves the view. */
  trash?: () => void
  details?: () => void
  /**
   * True while the file cannot change (in the trash, or read-only): commands that change it, or
   * that need it live (New beside it, Pin, Show in folder), are disabled.
   */
  locked?: boolean
}

/** An editor's own parts of its File menu. */
export interface EditorFileMenuParts {
  /** More Download ▸ formats the editor exports itself (e.g. CSV of the current sheet). */
  downloads?: readonly MenuEntry[]
  /** Document commands before Print, e.g. Page setup. */
  items?: readonly MenuEntry[]
  /** Prints the document; also File ▸ Download ▸ PDF without the converter. */
  print?: () => void
}

const NATIVE_LABELS: Record<string, () => string> = {
  docx: () => ui("Microsoft Word (.docx)"),
  xlsx: () => ui("Microsoft Excel (.xlsx)"),
  pptx: () => ui("Microsoft PowerPoint (.pptx)"),
  ipynb: () => ui("Jupyter notebook (.ipynb)"),
  csv: () => ui("Comma-separated values (.csv)"),
  tsv: () => ui("Tab-separated values (.tsv)"),
}

/** What File ▸ Download calls the file's own format. */
export function nativeDownloadLabel(name: string): string {
  const extension = fileExtension(name)
  return NATIVE_LABELS[extension]?.() ?? (extension ? ui("Original format (.{{extension}})", { extension }) : ui("Original file"))
}

const item = (id: string, label: string, onSelect: (() => void) | undefined, extra: Partial<Extract<MenuEntry, { type: 'item' }>> = {}): MenuEntry[] =>
  onSelect ? [{ type: 'item', id, label, onSelect, ...extra }] : []

/**
 * An editor's File menu, as Docs and Office lay theirs out: New and Make a copy; Download and
 * Copy link; Rename, Move, Pin, Show in folder, and Move to trash; Details; then the editor's
 * own commands and Print. Call it when the menu opens; without a host only the editor's parts show.
 */
export function composeFileMenu(host: FileMenuHost | undefined, parts: EditorFileMenuParts = {}): MenuEntry[] {
  const locked = host?.locked ?? false
  const downloads: MenuEntry[] = host ? [
    ...item('download-native', nativeDownloadLabel(host.name), host.download),
    ...(host.downloadPdf
      // The converter exports the stored file, which it refuses while in the trash.
      ? item('download-pdf', ui("PDF document (.pdf)"), host.downloadPdf, { disabled: locked || Boolean(host.pdfBusy) })
      : item('download-pdf-print', ui("PDF (print, then save as PDF)"), parts.print)),
    ...(parts.downloads ?? []),
  ] : [...(parts.downloads ?? [])]
  return normalizeEntries([
    ...(host?.create?.length ? [{
      type: 'submenu',
      id: 'new',
      label: ui("New"),
      icon: FilePlus2,
      // Beside a file in the trash, possibly in a trashed folder too.
      disabled: locked,
      items: host.create.map((command): MenuEntry => ({ type: 'item', ...command })),
    } satisfies MenuEntry] : []),
    ...item('make-copy', ui("Make a copy"), host?.makeCopy, { icon: Copy, disabled: locked }),
    separator,
    ...(downloads.length ? [{ type: 'submenu', id: 'download', label: ui("Download"), icon: Download, items: downloads } satisfies MenuEntry] : []),
    ...item('copy-link', ui("Copy link"), host?.copyLink, { icon: Link2 }),
    separator,
    ...item('rename', ui("Rename"), host?.rename, { icon: Pencil, disabled: locked }),
    ...item('move', ui("Move to…"), host?.move, { icon: FolderInput, disabled: locked }),
    // The sidebar refuses trashed files, and their folder no longer lists them.
    ...(host?.pin ? item('pin', host.pin.pinned ? ui("Unpin from sidebar") : ui("Pin to sidebar"), host.pin.toggle, { icon: host.pin.pinned ? PinOff : Pin, disabled: locked }) : []),
    ...item('show-in-folder', ui("Show in folder"), host?.showInFolder, { icon: FolderOpen, disabled: locked }),
    ...item('trash', ui("Move to trash"), host?.trash, { icon: Trash2, destructive: true, disabled: locked }),
    separator,
    ...item('details', ui("Details"), host?.details, { icon: Info }),
    separator,
    ...(parts.items ?? []),
    ...item('print', ui("Print"), parts.print, { icon: Printer, shortcut: PRINT_SHORTCUT }),
  ])
}

/** The File menu for a menu bar: `composeFileMenu`, built each time it opens. */
export function fileMenuDefinition(host: FileMenuHost | undefined, parts: () => EditorFileMenuParts): MenuDefinition {
  return { id: 'file', label: ui("File"), items: () => composeFileMenu(host, parts()) }
}
