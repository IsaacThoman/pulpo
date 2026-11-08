import { useState, type ReactNode } from 'react'
import type { DocxEditor, DocxFormattingState, DocxMode, ListKind } from '@pulpo/client-core/office/docx/view'
import {
  Baseline,
  Bold,
  ChevronDown,
  Eye,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  ListIndentDecrease,
  ListIndentIncrease,
  List,
  ListOrdered,
  ListTree,
  MessageSquarePlus,
  Paintbrush,
  PenLine,
  Pencil,
  Printer,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Subscript,
  Superscript,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignJustify,
  TextAlignStart,
  Underline,
  Undo2,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { FontSizeInput } from '../chrome/FontSizeInput'
import { formatShortcut } from '../chrome/shortcuts'
import type { DocxPanelsState } from './docx-menus'
import { TEXT_COLORS } from './docx-colors'
import { SymbolGrid, TableGridPicker } from './docx-pickers'
import { useEditorValue } from './use-editor-value'

export function ToolbarButton({ label, shortcut, description, active, disabled, onClick, onDoubleClick, badge, children, className }: {
  label: string
  shortcut?: string
  /** More than the name, for the tooltip ("Double-click to keep it on"). */
  description?: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  onDoubleClick?: () => void
  /** A small count over the icon (open comments); `description` says what it counts. */
  badge?: number
  children: ReactNode
  className?: string
}) {
  const title = [shortcut ? `${label} (${shortcut})` : label, description].filter(Boolean).join('\n')
  return (
    <button
      type="button"
      aria-label={label}
      aria-description={description}
      title={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(
        'relative grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40',
        active && 'bg-accent text-foreground',
        className,
      )}
    >
      {children}
      {badge ? (
        <span aria-hidden className="pointer-events-none absolute -top-0.5 -right-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-primary px-1 text-[9px] leading-none font-semibold text-primary-foreground tabular-nums" data-badge="">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </button>
  )
}

const Separator = () => <span className="mx-1 h-5 w-px shrink-0 bg-border" />

const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

const FONTS = ['Calibri', 'Cambria', 'Arial', 'Times New Roman', 'Georgia', 'Verdana', 'Courier New', 'Aptos', 'Helvetica', 'Segoe UI']
/** Word's size list. */
const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72]
const HIGHLIGHTS: [string, string][] = [['yellow', '#ffff00'], ['green', '#00ff00'], ['cyan', '#00ffff'], ['magenta', '#ff00ff'], ['blue', '#0000ff'], ['red', '#ff0000'], ['darkBlue', '#000080'], ['darkCyan', '#008080'], ['darkGreen', '#008000'], ['darkMagenta', '#800080'], ['darkRed', '#800000'], ['darkYellow', '#808000'], ['darkGray', '#808080'], ['lightGray', '#c0c0c0'], ['black', '#000000']]
const LINE_SPACINGS = [1, 1.15, 1.5, 2, 2.5, 3]

function ColorPicker({ label, icon, colors, current, onPick, onClear, clearLabel }: {
  label: string
  icon: ReactNode
  colors: [string, string][]
  current: string | null
  onPick: (value: string) => void
  onClear: () => void
  clearLabel: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          onMouseDown={(event) => event.preventDefault()}
          className="relative grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {icon}
          <span className="absolute bottom-1 left-2 right-2 h-0.5 rounded-full" style={{ background: current ?? 'currentColor' }} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" onOpenAutoFocus={(event) => event.preventDefault()}>
        <div className="grid grid-cols-8 gap-1">
          {colors.map(([value, swatch]) => (
            <button
              key={value}
              type="button"
              aria-label={value}
              title={value}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onPick(value)
                setOpen(false)
              }}
              className="size-6 cursor-pointer rounded border border-border"
              style={{ background: swatch }}
            />
          ))}
        </div>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onClear()
            setOpen(false)
          }}
          className="mt-2 w-full cursor-pointer rounded-md px-2 py-1 text-left text-sm hover:bg-accent"
        >
          {clearLabel}
        </button>
      </PopoverContent>
    </Popover>
  )
}

export type ToolbarPanels = DocxPanelsState

export function DocxToolbar({ editor, state, onRequestLink, onRequestComment, onInsertImage, onTogglePanel, panels }: {
  editor: DocxEditor
  state: DocxFormattingState
  onRequestLink: () => void
  /** Opens the comments panel with a new comment on the selection (Docs' Add comment). */
  onRequestComment: () => void
  /** Picks a picture file to insert. */
  onInsertImage: () => void
  onTogglePanel: (panel: keyof ToolbarPanels) => void
  panels: ToolbarPanels
}) {
  // Unresolved threads, counted on the Comment button; reading them walks every comment.
  const openComments = useEditorValue(editor, () => editor.comments().filter((thread) => !thread.meta.done).length, 400)
  const [insertOpen, setInsertOpen] = useState(false)
  // Menus hand focus back to the document, so typing continues where the command applied.
  const keepEditorFocus = (event: Event) => {
    event.preventDefault()
    editor.focus()
  }
  const readOnly = state.readOnly
  const button = (label: string, icon: ReactNode, onClick: () => void, options: { active?: boolean; shortcut?: string; disabled?: boolean } = {}) => (
    <ToolbarButton label={label} shortcut={options.shortcut} active={options.active} disabled={options.disabled ?? readOnly} onClick={onClick}>
      {icon}
    </ToolbarButton>
  )
  const styles = editor.styles()
  const styleName = styles.find((style) => style.id === state.styleId)?.name ?? state.styleId ?? ui("Normal")
  const fonts = state.fontFamily && !FONTS.includes(state.fontFamily) ? [state.fontFamily, ...FONTS] : FONTS
  const modeLabels: Record<DocxMode, string> = { editing: ui("Editing"), suggesting: ui("Suggesting"), viewing: ui("Viewing") }
  const modeIcons: Record<DocxMode, ReactNode> = { editing: <Pencil className="size-4" />, suggesting: <PenLine className="size-4" />, viewing: <Eye className="size-4" /> }
  const listButton = (kind: ListKind, label: string, icon: ReactNode, shortcut?: string) => button(label, icon, () => editor.toggleList(kind), { active: state.list === kind, shortcut })
  const menuTrigger = (label: string, content: ReactNode, wide = false) => (
    <DropdownMenuTrigger asChild disabled={readOnly}>
      <button
        type="button"
        aria-label={label}
        title={label}
        onMouseDown={(event) => event.preventDefault()}
        className={cn('flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40', wide && 'min-w-0')}
      >
        {content}
        <ChevronDown className="size-3.5 opacity-60" />
      </button>
    </DropdownMenuTrigger>
  )
  return (
    <div role="toolbar" aria-label={ui("Formatting")} className="flex flex-wrap items-center gap-0.5" data-docx-toolbar>
      {button(ui("Undo"), <Undo2 className="size-4" />, () => editor.undo(), { shortcut: `${mod}Z`, disabled: readOnly || !state.canUndo })}
      {button(ui("Redo"), <Redo2 className="size-4" />, () => editor.redo(), { shortcut: `${mod}Y`, disabled: readOnly || !state.canRedo })}
      {button(ui("Print"), <Printer className="size-4" />, () => editor.print(), { disabled: false })}
      {/* Word and Docs: a click paints once; a double-click keeps painting until Esc. */}
      <ToolbarButton
        label={ui("Format painter")}
        description={state.formatPainterSticky ? ui("On until you press Esc") : ui("Double-click to keep it on")}
        active={state.formatPainter}
        disabled={readOnly}
        onClick={() => editor.formatPainter()}
        onDoubleClick={() => editor.formatPainter({ sticky: true })}
        className={cn(state.formatPainterSticky && 'ring-1 ring-primary/60')}
      >
        <Paintbrush className="size-4" />
      </ToolbarButton>
      <Separator />
      <DropdownMenu>
        {menuTrigger(ui("Style"), <span className="w-24 truncate text-left text-foreground" data-docx-style>{styleName}</span>, true)}
        <DropdownMenuContent onCloseAutoFocus={keepEditorFocus} align="start" className="max-h-80 w-64">
          {styles.map((style) => (
            <DropdownMenuItem key={style.id} onSelect={() => editor.setStyle(style.id)} className={cn(style.id === state.styleId && 'bg-accent')}>
              {style.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        {menuTrigger(ui("Font"), <span className="w-24 truncate text-left text-foreground" style={{ fontFamily: state.fontFamily ? editor.fontStack(state.fontFamily) : undefined }}>{state.fontFamily ?? ui("Font")}</span>, true)}
        <DropdownMenuContent onCloseAutoFocus={keepEditorFocus} align="start" className="max-h-80">
          {fonts.map((font) => (
            <DropdownMenuItem key={font} onSelect={() => editor.setFontFamily(font)} style={{ fontFamily: editor.fontStack(font) }}>
              {font}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <FontSizeInput
        value={state.fontSize ?? 11}
        sizes={SIZES}
        disabled={readOnly}
        onChange={(size) => editor.setFontSize(size)}
        onStep={(direction) => editor.stepFontSize(direction)}
        onDone={() => editor.focus()}
        className="mx-0.5"
      />
      <Separator />
      {button(ui("Bold"), <Bold className="size-4" />, () => editor.toggleBold(), { active: state.bold, shortcut: `${mod}B` })}
      {button(ui("Italic"), <Italic className="size-4" />, () => editor.toggleItalic(), { active: state.italic, shortcut: `${mod}I` })}
      {button(ui("Underline"), <Underline className="size-4" />, () => editor.toggleUnderline(), { active: state.underline, shortcut: `${mod}U` })}
      {button(ui("Strikethrough"), <Strikethrough className="size-4" />, () => editor.toggleStrike(), { active: state.strike })}
      {button(ui("Superscript"), <Superscript className="size-4" />, () => editor.setSuperscript(), { active: state.superscript })}
      {button(ui("Subscript"), <Subscript className="size-4" />, () => editor.setSubscript(), { active: state.subscript })}
      {!readOnly && (
        <>
          <ColorPicker label={ui("Text color")} icon={<Baseline className="size-4" />} colors={TEXT_COLORS.map((color) => [color, color])} current={state.color} onPick={(color) => editor.setColor(color)} onClear={() => editor.setColor(null)} clearLabel={ui("Automatic")} />
          <ColorPicker label={ui("Highlight color")} icon={<Highlighter className="size-4" />} colors={HIGHLIGHTS} current={HIGHLIGHTS.find(([name]) => name === state.highlight)?.[1] ?? null} onPick={(name) => editor.setHighlight(name)} onClear={() => editor.setHighlight(null)} clearLabel={ui("No highlight")} />
        </>
      )}
      <Separator />
      {button(ui("Link"), <Link2 className="size-4" />, onRequestLink, { active: Boolean(state.link), disabled: !state.untrackedFormattingEditable, shortcut: `${mod}K` })}
      {/* Docs' Add comment for those who can comment; for a read-only viewer it shows or hides the threads. */}
      <ToolbarButton
        label={ui("Comment")}
        shortcut={state.canComment ? formatShortcut({ key: 'm', mod: true, alt: true }) : undefined}
        description={openComments ? (openComments === 1 ? ui("1 open comment") : ui("{{count}} open comments", { count: openComments })) : undefined}
        active={state.canComment ? undefined : panels.comments}
        disabled={Boolean(state.editingStory)}
        badge={openComments}
        onClick={state.canComment ? onRequestComment : () => onTogglePanel('comments')}
      >
        <MessageSquarePlus className="size-4" />
      </ToolbarButton>
      {button(ui("Image"), <ImagePlus className="size-4" />, onInsertImage)}
      <DropdownMenu open={insertOpen} onOpenChange={setInsertOpen}>
        {menuTrigger(ui("Insert"), <span className="text-foreground">{ui("Insert")}</span>)}
        <DropdownMenuContent onCloseAutoFocus={keepEditorFocus} align="start" className="w-56">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>{ui("Table")}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <TableGridPicker onPick={(rows, cols) => {
                setInsertOpen(false)
                editor.insertTable(rows, cols)
              }} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem onSelect={() => editor.insertPageBreak()}>{ui("Page break")}</DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={!state.untrackedFormattingEditable}>{ui("Section break")}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem disabled={!state.untrackedFormattingEditable || !state.bodyCommandsEditable} onSelect={() => editor.insertSectionBreak('nextPage')}>{ui("Next page")}</DropdownMenuItem>
              <DropdownMenuItem disabled={!state.untrackedFormattingEditable || !state.bodyCommandsEditable} onSelect={() => editor.insertSectionBreak('continuous')}>{ui("Continuous")}</DropdownMenuItem>
              <DropdownMenuItem disabled={!state.untrackedFormattingEditable || !state.bodyCommandsEditable} onSelect={() => editor.insertSectionBreak('evenPage')}>{ui("Even page")}</DropdownMenuItem>
              <DropdownMenuItem disabled={!state.untrackedFormattingEditable || !state.bodyCommandsEditable} onSelect={() => editor.insertSectionBreak('oddPage')}>{ui("Odd page")}</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem disabled={!state.bodyCommandsEditable} onSelect={() => editor.insertNote('footnote')}>{ui("Footnote")}</DropdownMenuItem>
          <DropdownMenuItem disabled={!state.bodyCommandsEditable} onSelect={() => editor.insertNote('endnote')}>{ui("Endnote")}</DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>{ui("Symbol")}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-56">
              <SymbolGrid onPick={(symbol) => {
                setInsertOpen(false)
                editor.insertSymbol(symbol)
              }} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!state.bodyCommandsEditable} onSelect={() => editor.insertTableOfContents()}>{ui("Table of contents")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => editor.updateTableOfContents()}>{ui("Update table of contents")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Separator />
      {button(ui("Align left"), <TextAlignStart className="size-4" />, () => editor.setAlignment('left'), { active: state.alignment === 'left', shortcut: `${mod}L` })}
      {button(ui("Center"), <TextAlignCenter className="size-4" />, () => editor.setAlignment('center'), { active: state.alignment === 'center', shortcut: `${mod}E` })}
      {button(ui("Align right"), <TextAlignEnd className="size-4" />, () => editor.setAlignment('right'), { active: state.alignment === 'right', shortcut: `${mod}R` })}
      {button(ui("Justify"), <TextAlignJustify className="size-4" />, () => editor.setAlignment('both'), { active: state.alignment === 'both', shortcut: `${mod}J` })}
      <DropdownMenu>
        {menuTrigger(ui("Line and paragraph spacing"), <span className="text-foreground tabular-nums">{state.lineSpacing ?? '—'}</span>)}
        <DropdownMenuContent onCloseAutoFocus={keepEditorFocus} align="start">
          <DropdownMenuLabel>{ui("Line spacing")}</DropdownMenuLabel>
          {LINE_SPACINGS.map((value) => (
            <DropdownMenuItem key={value} onSelect={() => editor.setLineSpacing(value)} className={cn(state.lineSpacing === value && 'bg-accent')}>{value}</DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => editor.setParagraphSpacing(12, undefined)}>{ui("Add space before paragraph")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => editor.setParagraphSpacing(undefined, 8)}>{ui("Add space after paragraph")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => editor.setParagraphSpacing(0, 0)}>{ui("Remove paragraph spacing")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {listButton('bullet', ui("Bulleted list"), <List className="size-4" />)}
      {listButton('decimal', ui("Numbered list"), <ListOrdered className="size-4" />)}
      {listButton('multilevel', ui("Multilevel list"), <ListTree className="size-4" />)}
      {button(ui("Decrease indent"), <ListIndentDecrease className="size-4" />, () => editor.outdent())}
      {button(ui("Increase indent"), <ListIndentIncrease className="size-4" />, () => editor.indent())}
      {button(ui("Clear formatting"), <RemoveFormatting className="size-4" />, () => editor.clearFormatting(), { shortcut: `${mod}\\` })}
      {state.inTable && !readOnly && (
        <DropdownMenu>
          {menuTrigger(ui("Table"), <span className="text-foreground">{ui("Table")}</span>)}
          <DropdownMenuContent onCloseAutoFocus={keepEditorFocus} align="start" className="w-56">
            <DropdownMenuItem onSelect={() => editor.addRowBefore()}>{ui("Insert row above")}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => editor.addRowAfter()}>{ui("Insert row below")}</DropdownMenuItem>
            <DropdownMenuItem disabled={!state.tableColumnsEditable} onSelect={() => editor.addColumnBefore()}>{ui("Insert column left")}</DropdownMenuItem>
            <DropdownMenuItem disabled={!state.tableColumnsEditable} onSelect={() => editor.addColumnAfter()}>{ui("Insert column right")}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!state.tableColumnsEditable} onSelect={() => editor.mergeCells()}>{ui("Merge cells")}</DropdownMenuItem>
            <DropdownMenuItem disabled={!state.tableColumnsEditable} onSelect={() => editor.splitCell()}>{ui("Split cell")}</DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={!state.untrackedFormattingEditable}>{ui("Borders")}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => editor.setCellBorders('all')}>{ui("All borders")}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => editor.setCellBorders('outside')}>{ui("Outside borders")}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => editor.setCellBorders('inside')}>{ui("Inside borders")}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => editor.setCellBorders('none')}>{ui("No borders")}</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={!state.untrackedFormattingEditable}>{ui("Cell shading")}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-auto">
                <div className="grid grid-cols-8 gap-1 p-1">
                  {TEXT_COLORS.map((color) => (
                    <button key={color} type="button" aria-label={color} title={color} onClick={() => editor.setCellShading(color)} className="size-5 cursor-pointer rounded border border-border" style={{ background: color }} />
                  ))}
                </div>
                <DropdownMenuItem onSelect={() => editor.setCellShading(null)}>{ui("No shading")}</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => editor.deleteRow()}>{ui("Delete row")}</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" disabled={!state.tableColumnsEditable} onSelect={() => editor.deleteColumn()}>{ui("Delete column")}</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => editor.deleteTable()}>{ui("Delete table")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Separator />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={ui("Editing mode")}
            title={ui("Editing mode")}
            onMouseDown={(event) => event.preventDefault()}
            className="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-sm text-foreground hover:bg-accent"
            data-docx-mode={state.mode}
          >
            {modeIcons[state.mode]}
            <span>{modeLabels[state.mode]}</span>
            <ChevronDown className="size-3.5 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent onCloseAutoFocus={keepEditorFocus} align="end" className="w-64">
          {(['editing', 'suggesting', 'viewing'] as const).map((mode) => (
            <DropdownMenuItem key={mode} onSelect={() => editor.setMode(mode)}>
              {modeIcons[mode]}
              <div>
                <div>{modeLabels[mode]}</div>
                <div className="text-xs text-muted-foreground">
                  {mode === 'editing' ? ui("Edit the document directly") : mode === 'suggesting' ? ui("Edits become tracked changes") : ui("Read or print the final document")}
                </div>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="ml-auto flex items-center gap-0.5">
        {button(ui("Outline"), <ListTree className="size-4" />, () => onTogglePanel('outline'), { active: panels.outline, disabled: false })}
        {button(ui("Review changes"), <PenLine className="size-4" />, () => onTogglePanel('review'), { active: panels.review, disabled: false })}
      </div>
    </div>
  )
}
