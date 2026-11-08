import { NodeSelection } from '@tiptap/pm/state'
import type { CellVerticalAlign, DocxEditor } from '@pulpo/client-core/office/docx/view'
import { ClipboardPaste, ClipboardType, Copy, ExternalLink, Link2, MessageSquare, MessageSquareCheck, Scissors, Trash2, Unlink } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ui } from '@/i18n/ui'
import { ariaKeyShortcuts, formatShortcut, type ShortcutSpec } from '../chrome/shortcuts'
import { copyFromMenu, pasteFromClipboard } from './docx-clipboard'
import type { DocxContextMenuState } from './docx-context'
import { OPENABLE_LINK } from './link-targets'

const CUT: ShortcutSpec = { key: 'x', mod: true }
const COPY: ShortcutSpec = { key: 'c', mod: true }
const PASTE: ShortcutSpec = { key: 'v', mod: true }
const PASTE_PLAIN: ShortcutSpec = { key: 'v', mod: true, shift: true }

/** Deletes the selected picture (a tracked deletion while suggesting). */
function deletePicture(editor: DocxEditor): boolean {
  return editor.run((state) => state.selection instanceof NodeSelection ? state.tr.deleteSelection() : null)
}

/**
 * Word's and Docs' right-click menu for tables, pictures, links, and comments: Cut, Copy, and
 * Paste, then what applies to what is under the pointer. It opens where the pointer is and hands
 * focus back to the document when it closes.
 */
export function DocxContextMenu({ editor, menu, onClose, onEditLink, onOpenComment }: {
  editor: DocxEditor
  menu: DocxContextMenuState | null
  onClose: () => void
  /** Opens the link dialog for the link under the pointer (now selected). */
  onEditLink: () => void
  onOpenComment: (id: string) => void
}) {
  if (!menu) return null
  const { info } = menu
  const state = editor.state()
  const editable = info.editable && !state.readOnly
  const columns = !state.tableColumnsEditable
  const cells = !state.untrackedFormattingEditable
  const links = !state.untrackedFormattingEditable
  const item = (id: string, label: string, onSelect: () => void, options: { icon?: React.ReactNode; shortcut?: ShortcutSpec; disabled?: boolean; destructive?: boolean } = {}) => (
    <DropdownMenuItem
      key={id}
      disabled={options.disabled}
      variant={options.destructive ? 'destructive' : 'default'}
      onSelect={onSelect}
      aria-keyshortcuts={options.shortcut ? ariaKeyShortcuts(options.shortcut) : undefined}
      data-menu-item={id}
      inset={!options.icon || undefined}
    >
      {options.icon}
      <span className="min-w-0 flex-1">{label}</span>
      {options.shortcut && <DropdownMenuShortcut className="pl-6 tracking-normal">{formatShortcut(options.shortcut)}</DropdownMenuShortcut>}
    </DropdownMenuItem>
  )
  const comment = info.comments[0]
  const link = info.link
  const verticalAlign = (value: CellVerticalAlign, label: string) => item(`cell-align-${value}`, label, () => editor.setCellVerticalAlign(value), { disabled: cells })
  return (
    <DropdownMenu key={`${menu.x}:${menu.y}`} open modal={false} onOpenChange={(open) => { if (!open) onClose() }}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden className="pointer-events-none fixed size-0" style={{ left: menu.x, top: menu.y }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={2}
        className="w-max min-w-56"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          // A command that opened a dialog keeps its focus there.
          const active = document.activeElement
          if (!active || active === document.body) editor.focus()
        }}
        data-docx-context-menu=""
      >
        {item('cut', ui("Cut"), () => copyFromMenu(editor, true), { icon: <Scissors />, shortcut: CUT, disabled: !editable || state.empty })}
        {item('copy', ui("Copy"), () => copyFromMenu(editor, false), { icon: <Copy />, shortcut: COPY, disabled: state.empty })}
        {item('paste', ui("Paste"), () => void pasteFromClipboard(editor), { icon: <ClipboardPaste />, shortcut: PASTE, disabled: !editable })}
        {item('paste-plain', ui("Paste without formatting"), () => void pasteFromClipboard(editor, true), { icon: <ClipboardType />, shortcut: PASTE_PLAIN, disabled: !editable })}
        {link && (
          <>
            <DropdownMenuSeparator />
            {item('open-link', ui("Open link"), () => {
              if (link.href && OPENABLE_LINK.test(link.href)) window.open(link.href, '_blank', 'noopener,noreferrer')
              else if (link.anchor) editor.goToBookmark(link.anchor)
            }, { icon: <ExternalLink />, disabled: !(link.href && OPENABLE_LINK.test(link.href)) && !link.anchor })}
            {item('edit-link', ui("Edit link"), onEditLink, { icon: <Link2 />, disabled: links })}
            {item('remove-link', ui("Remove link"), () => editor.setLink(null), { icon: <Unlink />, disabled: links })}
          </>
        )}
        {comment && (
          <>
            <DropdownMenuSeparator />
            {item('open-comment', ui("Open comment"), () => onOpenComment(comment), { icon: <MessageSquare /> })}
            {item('resolve-comment', ui("Resolve comment"), () => editor.resolveComment(comment, true), { icon: <MessageSquareCheck />, disabled: !editor.canComment })}
          </>
        )}
        {info.table && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel inset className="text-xs font-normal text-muted-foreground">{ui("Table")}</DropdownMenuLabel>
            {item('table-row-above', ui("Insert row above"), () => editor.addRowBefore(), { disabled: !editable })}
            {item('table-row-below', ui("Insert row below"), () => editor.addRowAfter(), { disabled: !editable })}
            {item('table-column-left', ui("Insert column left"), () => editor.addColumnBefore(), { disabled: !editable || columns })}
            {item('table-column-right', ui("Insert column right"), () => editor.addColumnAfter(), { disabled: !editable || columns })}
            <DropdownMenuSeparator />
            {item('table-delete-row', ui("Delete row"), () => editor.deleteRow(), { disabled: !editable })}
            {item('table-delete-column', ui("Delete column"), () => editor.deleteColumn(), { disabled: !editable || columns })}
            {item('table-delete', ui("Delete table"), () => editor.deleteTable(), { disabled: !editable, destructive: true })}
            <DropdownMenuSeparator />
            {item('table-merge', ui("Merge cells"), () => editor.mergeCells(), { disabled: !editable || columns })}
            {item('table-split', ui("Split cell"), () => editor.splitCell(), { disabled: !editable || columns })}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger inset disabled={!editable || cells} data-menu-item="table-cell-align">{ui("Cell vertical alignment")}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {verticalAlign('top', ui("Top"))}
                {verticalAlign('center', ui("Middle"))}
                {verticalAlign('bottom', ui("Bottom"))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
        {info.picture && (
          <>
            <DropdownMenuSeparator />
            {item('delete-picture', ui("Delete picture"), () => deletePicture(editor), { icon: <Trash2 />, disabled: !editable, destructive: true })}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
