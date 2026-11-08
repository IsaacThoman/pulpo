import type { ReactNode } from 'react'
import { cssFontFamily } from '@pulpo/client-core/office/presentation'
import type { PresentationController } from '@pulpo/client-core/office/presentation/view'
import {
  AlignCenter,
  AlignHorizontalJustifyCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  Baseline,
  Bold,
  ChevronDown,
  Copy,
  EyeOff,
  Group,
  Highlighter,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Italic,
  LayoutGrid,
  LayoutTemplate,
  Link2,
  List,
  ListOrdered,
  Minus,
  PaintBucket,
  PanelRight,
  Play,
  Plus,
  Printer,
  Redo2,
  RemoveFormatting,
  Shapes,
  Strikethrough,
  Table,
  Trash2,
  Type,
  Underline,
  Undo2,
  Ungroup,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ToolbarButton } from '@/features/files/editor/ToolbarButton'
import { ui, uit } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { isAppleShortcut } from '../../browser/shortcuts'
import { FontSizeInput } from '../chrome/FontSizeInput'
import { ariaKeyShortcuts, formatShortcut, type ShortcutSpec } from '../chrome/shortcuts'
import { redoShortcut, UNDO_SHORTCUT } from '../chrome/standard-menus'
import { MenuEntries } from '../chrome/EditorMenuBar'
import { ColorPicker, ShapeGallery, TablePicker } from './pickers'
import { asUndoSteps, LINE_SPACING, lineEntries, lineSpacingLabel } from './presentation-menus'
import { themeColors } from './theme'

/** PowerPoint's font size list. */
const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96]
const FONTS = ['Calibri', 'Calibri Light', 'Aptos', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Courier New', 'Segoe UI', 'Century Gothic', 'Garamond']
/** Theme font references (PowerPoint's "Headings" and "Body" fonts). */
const HEADINGS_FONT = '+mj-lt'
const BODY_FONT = '+mn-lt'

/** A ToolbarButton's tooltip and aria-keyshortcuts for a shortcut. */
const hint = (spec: ShortcutSpec) => ({ label: formatShortcut(spec), aria: ariaKeyShortcuts(spec) })
const mod = (key: string, more: { shift?: boolean } = {}): ShortcutSpec => ({ key, mod: true, ...more })
/** Ctrl+M on every platform (Cmd+M minimizes the window on macOS). */
const NEW_SLIDE_HINT = { label: isAppleShortcut() ? '⌃M' : 'Ctrl+M', aria: 'Control+M' }

function Divider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-border" />
}

const pickerTriggerClass = 'grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40'
const triggerClass = 'flex h-8 shrink-0 cursor-pointer items-center gap-0.5 rounded-md px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40'

/** A toolbar menu; closing it hands focus back to the slide or its text (`onDone`), not the button. */
function MenuButton({ label, children, icon, disabled, onDone }: { label: string; children: ReactNode; icon: ReactNode; disabled?: boolean; onDone?: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button type="button" aria-label={label} title={label} onMouseDown={(event) => event.preventDefault()} className={triggerClass}>
          {icon}
          <ChevronDown className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onCloseAutoFocus={(event) => { event.preventDefault(); onDone?.() }}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The highlight's color for the button's color bar, when it is an RGB one. */
function highlightCss(xml: string | undefined): string | undefined {
  const hex = xml ? /srgbClr val="([0-9A-Fa-f]{6})"/.exec(xml)?.[1] : undefined
  return hex ? `#${hex}` : undefined
}

export interface PresentationToolbarProps {
  controller: PresentationController
  view: 'editor' | 'sorter'
  onViewChange(view: 'editor' | 'sorter'): void
  formatPanel: boolean
  onFormatPanelChange(open: boolean): void
  onPresent(mode: 'start' | 'current' | 'presenter'): void
  onPrint(): void
  printing?: boolean
  /** Opens the image file picker. */
  onInsertImage(): void
  /** Opens the link dialog. */
  onLink(): void
  /** Puts focus back in the slide or text after typing a font size. */
  onDone?(): void
}

export function PresentationToolbar({ controller, view, onViewChange, formatPanel, onFormatPanelChange, onPresent, onPrint, printing, onInsertImage, onLink, onDone }: PresentationToolbarProps) {
  const readOnly = controller.readOnly
  const format = controller.formatState()
  const shapes = controller.state.shapes
  const theme = themeColors(controller)
  const layouts = controller.layouts()
  const textDisabled = readOnly || !format.canFormatText
  // Text boxes, shapes, lines, pictures, and tables go on the slide: not from the sorter.
  const onSlide = view === 'editor'
  const themeFonts = controller.themeFonts()
  const fontLabel = format.resolvedFontFamily ?? format.fontFamily ?? ui("Font")
  const fonts = [...new Set([...(format.fontFamily && !format.fontFamily.startsWith('+') ? [format.fontFamily] : []), ...FONTS])]
  return (
    <div role="toolbar" aria-label={ui("Presentation")} className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:thin]">
      <ToolbarButton label={ui("Undo")} shortcut={hint(UNDO_SHORTCUT)} disabled={readOnly || !controller.canUndo()} onClick={() => controller.undo()}>
        <Undo2 className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={ui("Redo")} shortcut={hint(redoShortcut())} disabled={readOnly || !controller.canRedo()} onClick={() => controller.redo()}>
        <Redo2 className="size-4" />
      </ToolbarButton>
      <Divider />
      {!readOnly && (
        <>
          {/* Google Slides' split button: + adds a slide like the current one, the arrow picks a layout. */}
          <div className="flex shrink-0 items-center" data-new-slide="">
            <ToolbarButton label={ui("New slide")} shortcut={NEW_SLIDE_HINT} onClick={() => controller.addSlide()}>
              <Plus className="size-4" />
            </ToolbarButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label={ui("New slide with layout")} title={ui("New slide with layout")} onMouseDown={(event) => event.preventDefault()} className="-ml-1 grid h-8 w-4 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                  <ChevronDown className="size-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" onCloseAutoFocus={(event) => { event.preventDefault(); onDone?.() }}>
                <DropdownMenuLabel>{ui("New slide")}</DropdownMenuLabel>
                {layouts.map((layout) => (
                  <DropdownMenuItem key={layout.path} onSelect={() => controller.addSlide(layout.path)}>
                    {layout.name || ui("Untitled layout")}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <ToolbarButton label={ui("Text box")} disabled={!onSlide} onClick={() => controller.insertTextBox()}>
            <Type className="size-4" />
          </ToolbarButton>
          <ShapeGallery
            onPick={(preset) => controller.insertShape(preset)}
            onDone={onDone}
            trigger={
              <button type="button" aria-label={ui("Shapes")} title={ui("Shapes")} disabled={!onSlide} onMouseDown={(event) => event.preventDefault()} className={pickerTriggerClass}>
                <Shapes className="size-4" />
              </button>
            }
          />
          <MenuButton label={ui("Line")} icon={<Minus className="size-4 -rotate-45" />} disabled={!onSlide} onDone={onDone}>
            <MenuEntries entries={asUndoSteps(controller, lineEntries(controller))} close={() => {}} />
          </MenuButton>
          <ToolbarButton label={ui("Image")} disabled={!onSlide} onClick={onInsertImage}>
            <ImagePlus className="size-4" />
          </ToolbarButton>
          <TablePicker
            onPick={(rows, columns) => controller.insertTable(rows, columns)}
            onDone={onDone}
            trigger={
              <button type="button" aria-label={ui("Table")} title={ui("Table")} disabled={!onSlide} onMouseDown={(event) => event.preventDefault()} className={pickerTriggerClass}>
                <Table className="size-4" />
              </button>
            }
          />
          <Divider />
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={textDisabled}>
              <button type="button" aria-label={ui("Font")} title={ui("Font")} onMouseDown={(event) => event.preventDefault()} className={cn(triggerClass, 'gap-1 px-2 text-sm')} data-font-menu="">
                <span className="w-24 truncate text-left text-foreground" style={{ fontFamily: format.resolvedFontFamily ? cssFontFamily(format.resolvedFontFamily) : undefined }}>{fontLabel}</span>
                <ChevronDown className="size-3.5 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80" onCloseAutoFocus={(event) => { event.preventDefault(); onDone?.() }}>
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{ui("Theme fonts")}</DropdownMenuLabel>
              <DropdownMenuCheckboxItem role="menuitemradio" checked={format.fontFamily === HEADINGS_FONT} onSelect={() => controller.setMark('font', HEADINGS_FONT)} style={{ fontFamily: cssFontFamily(themeFonts.major) }}>
                {uit`${themeFonts.major} (Headings)`}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem role="menuitemradio" checked={format.fontFamily === BODY_FONT} onSelect={() => controller.setMark('font', BODY_FONT)} style={{ fontFamily: cssFontFamily(themeFonts.minor) }}>
                {uit`${themeFonts.minor} (Body)`}
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{ui("All fonts")}</DropdownMenuLabel>
              {fonts.map((font) => (
                <DropdownMenuCheckboxItem key={font} role="menuitemradio" checked={format.fontFamily === font} onSelect={() => controller.setMark('font', font)} style={{ fontFamily: cssFontFamily(font) }}>
                  {font}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <FontSizeInput
            value={format.fontSize ?? null}
            sizes={FONT_SIZES}
            max={4000}
            disabled={textDisabled}
            onChange={(size) => controller.setFontSize(size)}
            onStep={(direction) => controller.stepFontSize(direction)}
            onDone={onDone}
          />
          <ToolbarButton label={ui("Bold")} shortcut={hint(mod('b'))} active={format.bold} disabled={textDisabled} onClick={() => controller.toggleMark('b')}>
            <Bold className="size-4" />
          </ToolbarButton>
          <ToolbarButton label={ui("Italic")} shortcut={hint(mod('i'))} active={format.italic} disabled={textDisabled} onClick={() => controller.toggleMark('i')}>
            <Italic className="size-4" />
          </ToolbarButton>
          <ToolbarButton label={ui("Underline")} shortcut={hint(mod('u'))} active={format.underline} disabled={textDisabled} onClick={() => controller.toggleMark('u')}>
            <Underline className="size-4" />
          </ToolbarButton>
          <ToolbarButton label={ui("Strikethrough")} active={format.strike} disabled={textDisabled} onClick={() => controller.toggleMark('strike')}>
            <Strikethrough className="size-4" />
          </ToolbarButton>
          <ColorPicker
            label={ui("Text color")}
            icon={<Baseline className="size-4" />}
            theme={theme}
            onDone={onDone}
            noneLabel={ui("Automatic")}
            disabled={textDisabled}
            onPick={(choice) => controller.setMark('fill', choice.kind === 'fill' ? choice.xml : undefined)}
          />
          <ColorPicker
            label={ui("Highlight color")}
            icon={<Highlighter className="size-4" />}
            theme={theme}
            onDone={onDone}
            noneLabel={ui("No highlight")}
            disabled={textDisabled}
            current={highlightCss(format.highlight)}
            onPick={(choice) => controller.setHighlight(choice.kind === 'fill' ? choice.xml : undefined)}
          />
          <ToolbarButton label={ui("Link")} shortcut={hint(mod('k'))} active={Boolean(format.link)} disabled={textDisabled} onClick={onLink}>
            <Link2 className="size-4" />
          </ToolbarButton>
          <Divider />
          {(
            [
              ['l', ui("Align left"), AlignLeft, 'l'],
              ['ctr', ui("Center"), AlignCenter, 'e'],
              ['r', ui("Align right"), AlignRight, 'r'],
              ['just', ui("Justify"), AlignJustify, 'j'],
            ] as const
          ).map(([value, label, Icon, key]) => (
            <ToolbarButton key={value} label={label} shortcut={hint(mod(key, { shift: true }))} active={!textDisabled && format.align === value} disabled={textDisabled} onClick={() => controller.setAlign(value)}>
              <Icon className="size-4" />
            </ToolbarButton>
          ))}
          <ToolbarButton label={ui("Bulleted list")} shortcut={hint(mod('8', { shift: true }))} active={format.bullets === 'char'} disabled={textDisabled} onClick={() => controller.setBullets('char')}>
            <List className="size-4" />
          </ToolbarButton>
          <ToolbarButton label={ui("Numbered list")} shortcut={hint(mod('7', { shift: true }))} active={format.bullets === 'number'} disabled={textDisabled} onClick={() => controller.setBullets('number')}>
            <ListOrdered className="size-4" />
          </ToolbarButton>
          <ToolbarButton label={ui("Decrease list level")} shortcut={hint({ key: 'Tab', shift: true })} disabled={textDisabled} onClick={() => controller.changeLevel(-1)}>
            <IndentDecrease className="size-4" />
          </ToolbarButton>
          <ToolbarButton label={ui("Increase list level")} shortcut={hint({ key: 'Tab' })} disabled={textDisabled} onClick={() => controller.changeLevel(1)}>
            <IndentIncrease className="size-4" />
          </ToolbarButton>
          <MenuButton label={ui("Line spacing")} icon={<AlignHorizontalJustifyCenter className="size-4 rotate-90" />} onDone={onDone}>
            {LINE_SPACING.map((value) => (
              <DropdownMenuItem key={value} disabled={textDisabled} onSelect={() => controller.setLineSpacing(value)}>
                {lineSpacingLabel(value)}
              </DropdownMenuItem>
            ))}
          </MenuButton>
          <ToolbarButton label={ui("Clear formatting")} shortcut={hint(mod('\\'))} disabled={textDisabled} onClick={() => controller.clearFormatting()}>
            <RemoveFormatting className="size-4" />
          </ToolbarButton>
          <Divider />
          <ColorPicker
            label={ui("Shape fill")}
            icon={<PaintBucket className="size-4" />}
            theme={theme}
            onDone={onDone}
            allowNone
            disabled={!shapes.length}
            onPick={(choice) => controller.setShapeProperty('fill', choice.kind === 'fill' ? choice.xml : '<a:noFill/>')}
          />
          <MenuButton label={ui("Arrange")} icon={<Group className="size-4" />} onDone={onDone}>
            <DropdownMenuItem disabled={!shapes.length} onSelect={() => controller.reorder('front')}>
              <ArrowUpToLine className="size-4" /> {ui("Bring to front")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!shapes.length} onSelect={() => controller.reorder('forward')}>
              {ui("Bring forward")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!shapes.length} onSelect={() => controller.reorder('backward')}>
              {ui("Send backward")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!shapes.length} onSelect={() => controller.reorder('back')}>
              <ArrowDownToLine className="size-4" /> {ui("Send to back")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={shapes.length < 2} onSelect={() => controller.group()}>
              <Group className="size-4" /> {ui("Group")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!shapes.length} onSelect={() => controller.ungroup()}>
              <Ungroup className="size-4" /> {ui("Ungroup")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!shapes.length} onSelect={() => controller.align('left')}>{ui("Align left edges")}</DropdownMenuItem>
            <DropdownMenuItem disabled={!shapes.length} onSelect={() => controller.align('center')}>{ui("Align centers")}</DropdownMenuItem>
            <DropdownMenuItem disabled={!shapes.length} onSelect={() => controller.align('right')}>{ui("Align right edges")}</DropdownMenuItem>
            <DropdownMenuItem disabled={!shapes.length} onSelect={() => controller.align('top')}>{ui("Align top edges")}</DropdownMenuItem>
            <DropdownMenuItem disabled={!shapes.length} onSelect={() => controller.align('middle')}>{ui("Align middles")}</DropdownMenuItem>
            <DropdownMenuItem disabled={!shapes.length} onSelect={() => controller.align('bottom')}>{ui("Align bottom edges")}</DropdownMenuItem>
            <DropdownMenuItem disabled={shapes.length < 3} onSelect={() => controller.distribute('horizontal')}>{ui("Distribute horizontally")}</DropdownMenuItem>
            <DropdownMenuItem disabled={shapes.length < 3} onSelect={() => controller.distribute('vertical')}>{ui("Distribute vertically")}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!shapes.length} onSelect={() => controller.duplicateSelection()}>
              <Copy className="size-4" /> {ui("Duplicate")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!shapes.length} onSelect={() => controller.deleteSelection()}>
              <Trash2 className="size-4" /> {ui("Delete")}
            </DropdownMenuItem>
          </MenuButton>
          <MenuButton label={ui("Slide")} icon={<LayoutTemplate className="size-4" />} onDone={onDone}>
            <DropdownMenuLabel>{ui("Layout")}</DropdownMenuLabel>
            {layouts.map((layout) => (
              <DropdownMenuItem key={layout.path} onSelect={() => controller.setLayout(layout.path)}>
                {layout.name || ui("Untitled layout")}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => controller.duplicateSlides()}>{ui("Duplicate slide")}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => controller.setSlidesHidden(!controller.slide(controller.state.slide ?? '')?.hidden)}>
              <EyeOff className="size-4" /> {controller.slide(controller.state.slide ?? '')?.hidden ? ui("Show slide") : ui("Hide slide")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={controller.slideKeys().length < 2} onSelect={() => controller.deleteSlides()}>
              <Trash2 className="size-4" /> {ui("Delete slide")}
            </DropdownMenuItem>
          </MenuButton>
        </>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-0.5 pl-1">
        <ToolbarButton label={ui("Slide sorter")} active={view === 'sorter'} onClick={() => onViewChange(view === 'sorter' ? 'editor' : 'sorter')}>
          <LayoutGrid className="size-4" />
        </ToolbarButton>
        {!readOnly && (
          <ToolbarButton label={ui("Format panel")} active={formatPanel} onClick={() => onFormatPanelChange(!formatPanel)}>
            <PanelRight className="size-4" />
          </ToolbarButton>
        )}
        <ToolbarButton label={ui("Export to PDF")} disabled={printing} onClick={onPrint}>
          <Printer className="size-4" />
        </ToolbarButton>
        {/* Google Slides' Slideshow button: from the current slide, the arrow for the other ways to present. */}
        <div className="flex h-8 shrink-0 items-stretch overflow-hidden rounded-md bg-primary text-primary-foreground" data-present="">
          <button
            type="button"
            title={`${ui("Present")} (${formatShortcut({ key: 'Enter', mod: true })})`}
            aria-keyshortcuts={ariaKeyShortcuts({ key: 'Enter', mod: true })}
            className="flex cursor-pointer items-center gap-1 pr-1.5 pl-2.5 text-sm font-medium hover:bg-primary/90"
            onClick={() => onPresent('current')}
          >
            <Play className="size-3.5" /> {ui("Present")}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label={ui("Present options")} title={ui("Present options")} className="grid w-6 cursor-pointer place-items-center border-l border-primary-foreground/25 hover:bg-primary/90">
                <ChevronDown className="size-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onPresent('start')}>{ui("From beginning")}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onPresent('current')}>{ui("From current slide")}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onPresent('presenter')}>{ui("Presenter view")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  )
}

