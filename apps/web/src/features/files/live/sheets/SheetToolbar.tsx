import type { ReactNode } from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  ArrowDownAZ,
  ArrowUpAZ,
  Baseline,
  Bold,
  ChevronDown,
  Funnel,
  Grid2x2,
  ImagePlus,
  Italic,
  Link2,
  MessageSquarePlus,
  PaintBucket,
  Printer,
  Redo2,
  RemoveFormatting,
  Search,
  Snowflake,
  Strikethrough,
  TableCellsMerge,
  Underline,
  Undo2,
  WrapText,
} from 'lucide-react'
import { cssColor, type BorderPreset, type SheetView, type SheetViewState } from '@pulpo/client-core/office/sheets/view'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { ColorBar, ColorPicker } from './ColorPicker'
import { NUMBER_FORMATS } from './number-formats'

function ToolbarButton({ label, shortcut, active, disabled, onClick, children }: {
  label: string
  shortcut?: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        'relative grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40',
        active && 'bg-accent text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />
}

/** A toolbar dropdown: a labeled trigger and its items. */
function Menu({ label, trigger, disabled, children, wide }: { label: string; trigger: ReactNode; disabled?: boolean; children: ReactNode; wide?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={label}
          title={label}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          className={cn('flex h-8 shrink-0 cursor-pointer items-center gap-0.5 rounded-md px-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40', wide && 'min-w-24 justify-between')}
        >
          {trigger}
          <ChevronDown className="size-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onCloseAutoFocus={(event) => event.preventDefault()}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const FONTS = ['Aptos', 'Arial', 'Calibri', 'Cambria', 'Courier New', 'Georgia', 'Helvetica', 'Times New Roman', 'Verdana']
const SIZES = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72]

const BORDER_PRESETS: { preset: BorderPreset; label: () => string }[] = [
  { preset: 'all', label: () => ui("All borders") },
  { preset: 'outer', label: () => ui("Outside borders") },
  { preset: 'inner', label: () => ui("Inside borders") },
  { preset: 'horizontal', label: () => ui("Horizontal borders") },
  { preset: 'vertical', label: () => ui("Vertical borders") },
  { preset: 'top', label: () => ui("Top border") },
  { preset: 'bottom', label: () => ui("Bottom border") },
  { preset: 'left', label: () => ui("Left border") },
  { preset: 'right', label: () => ui("Right border") },
  { preset: 'thickOuter', label: () => ui("Thick outside borders") },
  { preset: 'bottomDouble', label: () => ui("Bottom double border") },
  { preset: 'none', label: () => ui("No borders") },
]

const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

export function SheetToolbar({ view, state, onFind, onNote, onInsertImage, onPrint }: {
  view: SheetView
  state: SheetViewState
  onFind: () => void
  onNote: () => void
  onInsertImage: () => void
  onPrint: () => void
}) {
  const style = state.activeStyle
  const disabled = state.readOnly
  const valuesOnly = state.valuesOnly
  const formatDisabled = disabled || valuesOnly
  const fontColor = cssColor(style.fontColor, view.theme) ?? (document.documentElement.classList.contains('dark') ? '#E3E3E3' : '#000000')
  const fillColor = cssColor(style.fill, view.theme)
  const currentFormat = NUMBER_FORMATS.find((format) => format.code === style.numFmt)
  const askFormat = () => {
    const code = window.prompt(ui("Custom number format"), style.numFmt)
    if (code) view.setNumberFormat(code)
  }
  const askLink = () => {
    const current = state.activeLink?.target ?? state.activeLink?.location ?? 'https://'
    const target = window.prompt(ui("Link URL or cell (Sheet1!A1)"), current)
    if (target === null) return
    if (!target.trim()) view.setLink(undefined)
    else if (/^[a-z][\w+.-]*:/i.test(target.trim())) view.setLink({ target: target.trim() })
    else view.setLink({ location: target.trim() })
  }
  const zoomSteps = [0.5, 0.75, 0.9, 1, 1.25, 1.5, 2]

  return (
    <div role="toolbar" aria-label={ui("Spreadsheet formatting")} className="flex min-h-10 shrink-0 flex-wrap items-center gap-0.5 border-b border-border bg-background px-2 py-1">
      <ToolbarButton label={ui("Undo")} shortcut={`${mod}Z`} disabled={disabled || !state.canUndo} onClick={() => view.undo()}>
        <Undo2 className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={ui("Redo")} shortcut={`${mod}Y`} disabled={disabled || !state.canRedo} onClick={() => view.redo()}>
        <Redo2 className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={ui("Print")} onClick={onPrint}>
        <Printer className="size-4" />
      </ToolbarButton>
      <Menu label={ui("Zoom")} trigger={<span className="tabular-nums">{Math.round(state.zoom * 100)}%</span>}>
        {zoomSteps.map((step) => (
          <DropdownMenuItem key={step} onSelect={() => view.setZoom(step)}>
            {Math.round(step * 100)}%
          </DropdownMenuItem>
        ))}
      </Menu>
      <Divider />
      <Menu label={ui("Number format")} disabled={formatDisabled} trigger={<span className="max-w-24 truncate">{currentFormat?.label() ?? ui("Custom")}</span>} wide>
        {NUMBER_FORMATS.map((format) => (
          <DropdownMenuItem key={format.code} onSelect={() => view.setNumberFormat(format.code)} className="justify-between gap-6">
            <span>{format.label()}</span>
            <span className="text-xs text-muted-foreground">{format.example}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={askFormat}>{ui("Custom number format…")}</DropdownMenuItem>
      </Menu>
      <ToolbarButton label={ui("Decrease decimal places")} disabled={formatDisabled} onClick={() => view.changeDecimals(-1)}>
        <span className="text-[11px] font-medium">.0←</span>
      </ToolbarButton>
      <ToolbarButton label={ui("Increase decimal places")} disabled={formatDisabled} onClick={() => view.changeDecimals(1)}>
        <span className="text-[11px] font-medium">.00→</span>
      </ToolbarButton>
      <Divider />
      <Menu label={ui("Font")} disabled={formatDisabled} trigger={<span className="max-w-24 truncate" style={{ fontFamily: style.fontName }}>{style.fontName}</span>} wide>
        {FONTS.map((font) => (
          <DropdownMenuItem key={font} onSelect={() => view.setStyle({ fontName: font })} style={{ fontFamily: font }}>
            {font}
          </DropdownMenuItem>
        ))}
      </Menu>
      <Menu label={ui("Font size")} disabled={formatDisabled} trigger={<span className="w-6 text-center tabular-nums">{style.fontSize}</span>}>
        {SIZES.map((size) => (
          <DropdownMenuItem key={size} onSelect={() => view.setStyle({ fontSize: size })}>
            {size}
          </DropdownMenuItem>
        ))}
      </Menu>
      <Divider />
      <ToolbarButton label={ui("Bold")} shortcut={`${mod}B`} active={style.bold} disabled={formatDisabled} onClick={() => view.toggleStyle('bold')}>
        <Bold className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={ui("Italic")} shortcut={`${mod}I`} active={style.italic} disabled={formatDisabled} onClick={() => view.toggleStyle('italic')}>
        <Italic className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={ui("Underline")} shortcut={`${mod}U`} active={!!style.underline} disabled={formatDisabled} onClick={() => view.toggleUnderline()}>
        <Underline className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={ui("Strikethrough")} active={style.strike} disabled={formatDisabled} onClick={() => view.toggleStyle('strike')}>
        <Strikethrough className="size-4" />
      </ToolbarButton>
      <ColorPicker label={ui("Text color")} theme={view.theme} automaticLabel={ui("Automatic")} disabled={formatDisabled} onPick={(color) => view.setStyle({ fontColor: color })}>
        <Baseline className="size-4" />
        <ColorBar color={fontColor} />
      </ColorPicker>
      <Divider />
      <ColorPicker label={ui("Fill color")} theme={view.theme} automaticLabel={ui("No fill")} disabled={formatDisabled} onPick={(color) => view.setStyle({ fill: color })}>
        <PaintBucket className="size-4" />
        <ColorBar color={fillColor} />
      </ColorPicker>
      <Menu label={ui("Borders")} disabled={formatDisabled} trigger={<Grid2x2 className="size-4" />}>
        {BORDER_PRESETS.map((entry) => (
          <DropdownMenuItem key={entry.preset} onSelect={() => view.setBorders(entry.preset)}>
            {entry.label()}
          </DropdownMenuItem>
        ))}
      </Menu>
      <Menu label={ui("Merge cells")} disabled={formatDisabled} trigger={<TableCellsMerge className="size-4" />}>
        <DropdownMenuItem onSelect={() => view.merge('all')}>{ui("Merge all")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => view.merge('center')}>{ui("Merge and center")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => view.merge('across')}>{ui("Merge horizontally")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => view.unmerge()}>{ui("Unmerge")}</DropdownMenuItem>
      </Menu>
      <Divider />
      <ToolbarButton label={ui("Align left")} active={style.hAlign === 'left'} disabled={formatDisabled} onClick={() => view.setStyle({ hAlign: style.hAlign === 'left' ? 'general' : 'left' })}>
        <AlignLeft className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={ui("Align center")} active={style.hAlign === 'center'} disabled={formatDisabled} onClick={() => view.setStyle({ hAlign: style.hAlign === 'center' ? 'general' : 'center' })}>
        <AlignCenter className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={ui("Align right")} active={style.hAlign === 'right'} disabled={formatDisabled} onClick={() => view.setStyle({ hAlign: style.hAlign === 'right' ? 'general' : 'right' })}>
        <AlignRight className="size-4" />
      </ToolbarButton>
      <Menu label={ui("Vertical align")} disabled={formatDisabled} trigger={style.vAlign === 'top' ? <AlignVerticalJustifyStart className="size-4" /> : style.vAlign === 'center' ? <AlignVerticalJustifyCenter className="size-4" /> : <AlignVerticalJustifyEnd className="size-4" />}>
        <DropdownMenuItem onSelect={() => view.setStyle({ vAlign: 'top' })}>{ui("Top")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => view.setStyle({ vAlign: 'center' })}>{ui("Middle")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => view.setStyle({ vAlign: 'bottom' })}>{ui("Bottom")}</DropdownMenuItem>
      </Menu>
      <ToolbarButton label={ui("Wrap text")} active={style.wrap} disabled={formatDisabled} onClick={() => view.toggleStyle('wrap')}>
        <WrapText className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={ui("Clear formatting")} disabled={formatDisabled} onClick={() => view.clearFormats()}>
        <RemoveFormatting className="size-4" />
      </ToolbarButton>
      <Divider />
      <Menu label={ui("Freeze")} disabled={disabled} trigger={<Snowflake className="size-4" />}>
        <DropdownMenuItem onSelect={() => view.freeze(0, 0)}>{ui("No frozen rows or columns")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => view.freeze(1, state.frozen.cols)}>{ui("Freeze first row")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => view.freeze(state.frozen.rows, 1)}>{ui("Freeze first column")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => view.freeze()}>{ui("Freeze up to the current cell")}</DropdownMenuItem>
      </Menu>
      <ToolbarButton label={ui("Sort A to Z")} disabled={disabled} onClick={() => view.sort(false)}>
        <ArrowDownAZ className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={ui("Sort Z to A")} disabled={disabled} onClick={() => view.sort(true)}>
        <ArrowUpAZ className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={state.hasFilter ? ui("Remove filter") : ui("Create a filter")} active={state.hasFilter} disabled={disabled} onClick={() => view.toggleFilter()}>
        <Funnel className="size-4" />
      </ToolbarButton>
      <Divider />
      <ToolbarButton label={ui("Insert link")} disabled={disabled} active={!!state.activeLink} onClick={askLink}>
        <Link2 className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={ui("Note")} disabled={disabled} active={!!state.activeNote} onClick={onNote}>
        <MessageSquarePlus className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={ui("Insert image")} disabled={formatDisabled} onClick={onInsertImage}>
        <ImagePlus className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={ui("Find and replace")} shortcut={`${mod}F`} onClick={onFind}>
        <Search className="size-4" />
      </ToolbarButton>
    </div>
  )
}
