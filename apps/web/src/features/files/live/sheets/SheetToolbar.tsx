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
  DollarSign,
  Euro,
  Funnel,
  Grid2x2,
  ImagePlus,
  Italic,
  Link2,
  MessageSquarePlus,
  PaintBucket,
  Paintbrush,
  Percent,
  Printer,
  Redo2,
  RemoveFormatting,
  Search,
  Sigma,
  Snowflake,
  Strikethrough,
  TableCellsMerge,
  Underline,
  Undo2,
  WrapText,
} from 'lucide-react'
import { cssColor, type BorderPreset, type QuickFormat, type SheetView, type SheetViewState } from '@pulpo/client-core/office/sheets/view'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { isAppleShortcut } from '../../browser/shortcuts'
import { ToolbarButton } from '../../editor/ToolbarButton'
import { FontSizeInput } from '../chrome/FontSizeInput'
import { ColorBar, ColorPicker } from './ColorPicker'
import { focusIsIdle } from './dialog-focus'
import { FunctionMenuItems } from './FunctionMenu'
import { runCommonFunction } from './functions'
import { NUMBER_FORMATS, numberFormatChoice, numberFormatCode } from './number-formats'
import { QUICK_FORMAT_DIGITS } from './sheet-menus'

function Divider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border" />
}

/** A toolbar dropdown: a labeled trigger and its items. */
function Menu({ label, trigger, disabled, children, wide, className, contentClassName, onDone }: { label: string; trigger: ReactNode; disabled?: boolean; children: ReactNode; wide?: boolean; className?: string; contentClassName?: string; onDone: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={label}
          title={label}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          className={cn('flex h-8 shrink-0 cursor-pointer items-center gap-0.5 rounded-md px-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40', wide && 'min-w-16 justify-between', className)}
        >
          {trigger}
          <ChevronDown className="size-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className={contentClassName}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          // Back to the grid, unless a command moved focus on (a dialog).
          if (focusIsIdle()) onDone()
        }}
      >
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

/** A shortcut as the toolbar shows and announces it. */
const keys = (key: string) => {
  const mac = isAppleShortcut()
  return { label: mac ? `⌘${key.toUpperCase()}` : `Ctrl+${key.toUpperCase()}`, aria: `${mac ? 'Meta' : 'Control'}+${key}` }
}
/** The format keys: Ctrl+Shift+digit everywhere (Cmd+Shift+4 takes a screenshot on a Mac). */
const formatKeys = (kind: QuickFormat) => {
  const digit = QUICK_FORMAT_DIGITS[kind]
  return { label: isAppleShortcut() ? `⌃⇧${digit}` : `Ctrl+Shift+${digit}`, aria: `Control+Shift+${digit}` }
}
/**
 * AutoSum: Alt+= on Windows and Linux, ⌃= on a Mac (Option+= types ≠ there, and Chrome keeps
 * Cmd+Shift+T, the grid's other Mac key, for reopening a closed tab).
 */
const autoSumKeys = () => isAppleShortcut() ? { label: '⌃=', aria: 'Control+=' } : { label: 'Alt+=', aria: 'Alt+=' }

export function SheetToolbar({ view, state, onFind, onNote, onLink, onInsertImage, onPrint, onCustomNumberFormat, slot }: {
  view: SheetView
  state: SheetViewState
  onFind: () => void
  onNote: () => void
  onLink: () => void
  onInsertImage: () => void
  onPrint: () => void
  onCustomNumberFormat: () => void
  /** Rendered at the end of the toolbar (Files puts its own controls there). */
  slot?: ReactNode
}) {
  const style = state.activeStyle
  const disabled = state.readOnly
  const valuesOnly = state.valuesOnly
  const formatDisabled = disabled || valuesOnly
  const fontColor = cssColor(style.fontColor, view.theme) ?? (document.documentElement.classList.contains('dark') ? '#E3E3E3' : '#000000')
  const fillColor = cssColor(style.fill, view.theme)
  const currentFormat = numberFormatChoice(view, style.numFmt)
  const currency = view.quickFormat('currency')
  const CurrencyIcon = currency.includes('€') ? Euro : DollarSign
  const painting = state.formatPainter
  const focusGrid = () => view.focus()
  // Click picks formats up for one paste and click again puts them down; a double-click keeps
  // painting until Escape or another click (Google's Paint format, Excel's Format Painter).
  const togglePainter = () => {
    if (view.getState().formatPainter) view.cancelFormatPainter()
    else view.startFormatPainter(false)
  }

  return (
    <div role="toolbar" aria-label={ui("Spreadsheet formatting")} className="flex min-h-10 shrink-0 flex-wrap items-center gap-px border-b border-border bg-background px-1.5 py-1">
      <ToolbarButton label={ui("Undo")} shortcut={keys('z')} disabled={disabled || !state.canUndo} onClick={() => view.undo()}>
        <Undo2 className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={ui("Redo")} shortcut={keys('y')} disabled={disabled || !state.canRedo} onClick={() => view.redo()}>
        <Redo2 className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={ui("Print")} shortcut={keys('p')} onClick={onPrint}>
        <Printer className="size-4" />
      </ToolbarButton>
      <span className="contents" onDoubleClick={() => { if (!formatDisabled) view.startFormatPainter(true) }} data-sheet-paint-format={painting ? (painting.sticky ? 'sticky' : 'once') : undefined}>
        <ToolbarButton label={ui("Paint format")} active={!!painting} disabled={formatDisabled} onClick={togglePainter}>
          <Paintbrush className="size-4" />
        </ToolbarButton>
      </span>
      <Divider />
      <ToolbarButton label={ui("Format as currency")} shortcut={formatKeys('currency')} active={style.numFmt === currency} disabled={formatDisabled} onClick={() => view.applyQuickFormat('currency')}>
        <CurrencyIcon className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={ui("Format as percent")} shortcut={formatKeys('percent')} active={style.numFmt === view.quickFormat('percent')} disabled={formatDisabled} onClick={() => view.applyQuickFormat('percent')}>
        <Percent className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={ui("Decrease decimal places")} disabled={formatDisabled} onClick={() => view.changeDecimals(-1)}>
        <span className="text-[11px] font-medium">.0←</span>
      </ToolbarButton>
      <ToolbarButton label={ui("Increase decimal places")} disabled={formatDisabled} onClick={() => view.changeDecimals(1)}>
        <span className="text-[11px] font-medium">.00→</span>
      </ToolbarButton>
      <Menu onDone={focusGrid} label={ui("Number format")} disabled={formatDisabled} trigger={<span className="max-w-20 truncate">{currentFormat?.label() ?? ui("Custom")}</span>} wide>
        {NUMBER_FORMATS.map((format) => (
          <DropdownMenuItem key={format.id} onSelect={() => view.setNumberFormat(numberFormatCode(view, format))} className="justify-between gap-6">
            <span>{format.label()}</span>
            <span className="text-xs text-muted-foreground">{format.example}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onCustomNumberFormat}>{ui("Custom number format…")}</DropdownMenuItem>
      </Menu>
      <Divider />
      <Menu onDone={focusGrid} label={ui("Font")} disabled={formatDisabled} trigger={<span className="max-w-20 truncate" style={{ fontFamily: style.fontName }}>{style.fontName}</span>} wide>
        {FONTS.map((font) => (
          <DropdownMenuItem key={font} onSelect={() => view.setStyle({ fontName: font })} style={{ fontFamily: font }}>
            {font}
          </DropdownMenuItem>
        ))}
      </Menu>
      <FontSizeInput value={style.fontSize} sizes={SIZES} min={1} max={409} disabled={formatDisabled} onChange={(size) => view.setStyle({ fontSize: size })} onDone={focusGrid} />
      <Divider />
      <ToolbarButton label={ui("Bold")} shortcut={keys('b')} active={style.bold} disabled={formatDisabled} onClick={() => view.toggleStyle('bold')}>
        <Bold className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={ui("Italic")} shortcut={keys('i')} active={style.italic} disabled={formatDisabled} onClick={() => view.toggleStyle('italic')}>
        <Italic className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={ui("Underline")} shortcut={keys('u')} active={!!style.underline} disabled={formatDisabled} onClick={() => view.toggleUnderline()}>
        <Underline className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={ui("Strikethrough")} shortcut={keys('5')} active={style.strike} disabled={formatDisabled} onClick={() => view.toggleStyle('strike')}>
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
      <Menu onDone={focusGrid} label={ui("Borders")} disabled={formatDisabled} trigger={<Grid2x2 className="size-4" />}>
        {BORDER_PRESETS.map((entry) => (
          <DropdownMenuItem key={entry.preset} onSelect={() => view.setBorders(entry.preset)}>
            {entry.label()}
          </DropdownMenuItem>
        ))}
      </Menu>
      <Menu onDone={focusGrid} label={ui("Merge cells")} disabled={formatDisabled} trigger={<TableCellsMerge className="size-4" />}>
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
      <Menu onDone={focusGrid} label={ui("Vertical align")} disabled={formatDisabled} trigger={style.vAlign === 'top' ? <AlignVerticalJustifyStart className="size-4" /> : style.vAlign === 'center' ? <AlignVerticalJustifyCenter className="size-4" /> : <AlignVerticalJustifyEnd className="size-4" />}>
        <DropdownMenuItem onSelect={() => view.setStyle({ vAlign: 'top' })}>{ui("Top")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => view.setStyle({ vAlign: 'center' })}>{ui("Middle")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => view.setStyle({ vAlign: 'bottom' })}>{ui("Bottom")}</DropdownMenuItem>
      </Menu>
      <ToolbarButton label={ui("Wrap text")} active={style.wrap} disabled={formatDisabled} onClick={() => view.toggleStyle('wrap')}>
        <WrapText className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={ui("Clear formatting")} shortcut={keys('\\')} disabled={formatDisabled} onClick={() => view.clearFormats()}>
        <RemoveFormatting className="size-4" />
      </ToolbarButton>
      <Divider />
      <Menu onDone={focusGrid} label={ui("Freeze")} disabled={disabled} trigger={<Snowflake className="size-4" />}>
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
      <ToolbarButton label={ui("Insert link")} shortcut={keys('k')} disabled={formatDisabled} active={!!state.activeLink} onClick={onLink}>
        <Link2 className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={ui("Note")} disabled={formatDisabled} active={!!state.activeNote} onClick={onNote}>
        <MessageSquarePlus className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={ui("Insert image")} disabled={formatDisabled} onClick={onInsertImage}>
        <ImagePlus className="size-4" />
      </ToolbarButton>
      {/* Excel's AutoSum: the button sums, its arrow lists the other functions. */}
      <div className="flex shrink-0 items-center" data-sheet-functions="">
        <ToolbarButton label={ui("Sum")} shortcut={autoSumKeys()} disabled={formatDisabled} onClick={() => runCommonFunction(view, 'SUM')}>
          <Sigma className="size-4" />
        </ToolbarButton>
        <Menu onDone={focusGrid} label={ui("Functions")} disabled={formatDisabled} trigger={null} className="-ml-1 w-4 justify-center px-0" contentClassName="min-w-44">
          <FunctionMenuItems view={view} />
        </Menu>
      </div>
      <ToolbarButton label={ui("Find and replace")} shortcut={keys('f')} onClick={onFind}>
        <Search className="size-4" />
      </ToolbarButton>
      {slot && <div className="ml-auto flex items-center gap-1">{slot}</div>}
    </div>
  )
}
