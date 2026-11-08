import type { PresentationController } from '@pulpo/client-core/office/presentation/view'
import { maxOf, minOf } from '@pulpo/client-core/collections'
import { EMU_PER_PX, PRESET_SHAPE_GALLERY } from '@pulpo/client-core/office/presentation'
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignLeft,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowDownToLine,
  ArrowUpToLine,
  Bold,
  BringToFront,
  CalendarClock,
  ClipboardPaste,
  Copy,
  CopyPlus,
  FlipHorizontal2,
  FlipVertical2,
  FolderPlus,
  Group,
  Hash,
  Highlighter,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  LayoutTemplate,
  Link2,
  List,
  ListOrdered,
  Minus,
  Omega,
  PaintBucket,
  PanelRight,
  Pencil,
  Plus,
  RemoveFormatting,
  RotateCcw,
  RotateCw,
  Scissors,
  SendToBack,
  Shapes,
  Table,
  Trash2,
  Type,
  Ungroup,
} from 'lucide-react'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { isAppleShortcut } from '../../browser/shortcuts'
import { separator, type MenuEntry, type MenuIcon } from '../chrome/menu'
import type { ShortcutSpec } from '../chrome/shortcuts'
import { findEntries, undoRedoEntries } from '../chrome/standard-menus'
import { galleryLabel, HIGHLIGHT_COLORS, shapeName } from './names'
import { MenuGridItem, MenuTableGrid, NoColorSwatch, ShapeIcon } from './pickers'

/**
 * The presentation editor's menus as data, shared by the menu bar (Edit, Insert, Format, Slide,
 * Arrange) and the right-click menus of the slide, its shapes, table cells, thumbnails, and
 * section headers, so a command reads and works the same everywhere. Everything is built when a
 * menu opens, from the controller's state at that moment.
 */

/** What the menus ask the editor for: its dialogs, panels, and the image picker. */
export interface PresentationMenuHost {
  controller: PresentationController
  /** The slide editor, or the slide sorter (where Edit's commands act on slides). */
  view: 'editor' | 'sorter'
  openFind(mode: 'find' | 'replace'): void
  openLink(): void
  /** Format options: the side panel for the selection. */
  openFormatPanel(): void
  /** Change background: the side panel for the slide (nothing selected). */
  openBackground(): void
  insertImage(): void
  /** Asks for a name, then starts a section at `firstSlide`. */
  addSection(firstSlide: string): void
  renameSection(sectionKey: string): void
  /** Shapes align to each other (`auto`: a single shape to the slide) or always to the slide. */
  alignTo: 'auto' | 'slide'
  setAlignTo(value: 'auto' | 'slide'): void
}

type Cell = { row: string; column: string }

const mod = (key: string, more: { shift?: boolean; alt?: boolean } = {}): ShortcutSpec => ({ key, mod: true, ...more })
/** Ctrl+M on every platform (Cmd+M minimizes on macOS): menus show it where Ctrl is the modifier. */
export const newSlideShortcut = (): ShortcutSpec | undefined => (isAppleShortcut() ? undefined : mod('m'))

/** Insert ▸ Special characters, as Docs and Slides offer the common ones first. */
export const SPECIAL_CHARACTERS = ['©', '®', '™', '§', '¶', '†', '‡', '•', '…', '–', '—', '€', '£', '¥', '¢', '°', '±', '×', '÷', '≠', '≈', '≤', '≥', '∞', '√', '∑', 'π', 'Ω', 'α', 'β', 'µ', '←', '→', '↑', '↓', '↔', '✓', '★', '♥', '½']

/** Line spacing multiples, as Slides lists them. */
export const LINE_SPACING = [1, 1.15, 1.5, 2, 2.5, 3]
export const lineSpacingLabel = (value: number) => (value === 1 ? ui("Single") : value === 2 ? ui("Double") : String(value))

/**
 * Every command of a menu as an undo step of its own, as menu commands are in Docs and Office:
 * never merged with typing or a drag just before or after it.
 */
export function asUndoSteps(controller: PresentationController, entries: readonly MenuEntry[]): MenuEntry[] {
  return entries.map((entry): MenuEntry => {
    if (entry.type === 'submenu') return { ...entry, items: asUndoSteps(controller, entry.items) }
    if (entry.type !== 'item') return entry
    return {
      ...entry,
      onSelect: () => {
        controller.undoManager.stopCapturing()
        entry.onSelect()
        controller.undoManager.stopCapturing()
      },
    }
  })
}

// -------------------------------------------------------------------------------------------
// What the selection is

function currentSlideShapes(controller: PresentationController) {
  const slide = controller.state.slide
  return slide ? controller.slide(slide)?.shapes ?? [] : []
}

function selectedShapes(controller: PresentationController) {
  const slide = controller.state.slide
  return slide ? controller.state.shapes.map((key) => controller.shape(slide, key)).filter((shape) => shape !== undefined) : []
}

/** The text editor open on the slide, if any (its selection is what text commands act on). */
function slideTextEditor(controller: PresentationController) {
  if (controller.notesFocused || !controller.state.editing) return undefined
  const editor = controller.activeEditor
  return editor && !editor.view.isDestroyed ? editor : undefined
}

/** Text is being typed: on the slide, or in the speaker notes. */
export function typingText(controller: PresentationController): boolean {
  return controller.notesFocused || slideTextEditor(controller) !== undefined
}

const canTurn = (controller: PresentationController) => selectedShapes(controller).some((shape) => shape.kind !== 'graphicFrame' && shape.kind !== 'opaque')

/** The section a slide is in: the last one starting at or before it. */
export function sectionOf(controller: PresentationController, slideKey: string): { key: string; name: string; firstSlide?: string } | undefined {
  const keys = controller.slideKeys()
  const index = keys.indexOf(slideKey)
  if (index < 0) return undefined
  let found: { key: string; name: string; firstSlide?: string } | undefined
  let foundAt = -1
  for (const section of controller.sections()) {
    const first = section.firstSlide ? keys.indexOf(section.firstSlide) : -1
    if (first >= 0 && first <= index && first >= foundAt) {
      found = section
      foundAt = first
    }
  }
  return found
}

// -------------------------------------------------------------------------------------------
// Clipboard and editing

/** Runs the browser's cut or copy in the slide text being edited, so its own handler copies the selection with formatting. */
function textClipboard(controller: PresentationController, command: 'cut' | 'copy'): void {
  const editor = slideTextEditor(controller)
  if (!editor) return
  editor.view.focus()
  document.execCommand(command)
}

/** Paste while typing: the clipboard's text at the caret (the browser gives menus no richer access without a prompt). */
async function pasteText(controller: PresentationController): Promise<void> {
  const text = await navigator.clipboard?.readText().catch(() => '')
  if (text) controller.insertText(text)
}

const ignore = () => {}

/** Cut, Copy, and Paste: of the text being typed, the selected shapes, or (`slides`) the selected slides. */
export function clipboardEntries(controller: PresentationController, target: 'auto' | 'slides' = 'auto'): MenuEntry[] {
  const readOnly = controller.readOnly
  const typing = target === 'auto' && typingText(controller)
  // Speaker notes take the keyboard's Cut and Copy; menus reach only the slide's text.
  const onSlideText = slideTextEditor(controller) !== undefined
  const nothing = target === 'auto' && !controller.state.shapes.length
  return [
    {
      type: 'item', id: 'cut', label: ui("Cut"), icon: Scissors, shortcut: mod('x'),
      disabled: readOnly || (typing ? !onSlideText : nothing),
      onSelect: () => { if (typing) textClipboard(controller, 'cut'); else void controller.cutToClipboard(target).catch(ignore) },
    },
    {
      type: 'item', id: 'copy', label: ui("Copy"), icon: Copy, shortcut: mod('c'),
      disabled: typing ? !onSlideText : nothing && !controller.state.slide,
      onSelect: () => { if (typing) textClipboard(controller, 'copy'); else void controller.copyToClipboard(target).catch(ignore) },
    },
    {
      type: 'item', id: 'paste', label: ui("Paste"), icon: ClipboardPaste, shortcut: mod('v'), disabled: readOnly,
      onSelect: () => { if (typing) void pasteText(controller); else void controller.pasteFromClipboard(target).catch(ignore) },
    },
  ]
}

/** Edit ▸ Undo … Find and replace. */
export function editMenuEntries(host: PresentationMenuHost): MenuEntry[] {
  const { controller } = host
  const readOnly = controller.readOnly
  const sorter = host.view === 'sorter'
  const editor = sorter ? undefined : slideTextEditor(controller)
  const shapes = !sorter && controller.state.shapes.length > 0
  const deleteText = () => editor?.run((state, dispatch) => {
    if (state.selection.empty) return false
    dispatch?.(state.tr.deleteSelection())
    return true
  })
  return [
    ...undoRedoEntries({ undo: () => controller.undo(), redo: () => controller.redo(), canUndo: !readOnly && controller.canUndo(), canRedo: !readOnly && controller.canRedo() }),
    separator,
    ...clipboardEntries(controller, sorter ? 'slides' : 'auto'),
    separator,
    {
      type: 'item', id: 'duplicate', label: ui("Duplicate"), icon: CopyPlus, shortcut: mod('d'), disabled: readOnly || controller.notesFocused,
      onSelect: () => { if (shapes) controller.duplicateSelection(); else controller.duplicateSlides() },
    },
    {
      type: 'item', id: 'delete', label: ui("Delete"), icon: Trash2,
      disabled: readOnly || (sorter ? controller.state.slides.length >= controller.slideKeys().length : !shapes),
      onSelect: () => {
        if (sorter) controller.deleteSlides()
        else if (editor) deleteText()
        else controller.deleteSelection()
      },
    },
    separator,
    {
      type: 'item', id: 'select-all', label: ui("Select all"), shortcut: mod('a'),
      onSelect: () => {
        if (sorter) controller.selectAllSlides()
        else if (editor) {
          editor.selectAll()
          editor.view.focus()
        } else controller.selectShapes(currentSlideShapes(controller).map((shape) => shape.key))
      },
    },
    separator,
    ...findEntries({ find: () => host.openFind('find'), ...(readOnly ? {} : { replace: () => host.openFind('replace') }) }),
  ]
}

// -------------------------------------------------------------------------------------------
// Insert

function shapeGrid(controller: PresentationController, shapes: readonly string[]): MenuEntry {
  return {
    type: 'custom',
    id: 'shape-grid',
    render: (close) => (
      <div className="grid w-max grid-cols-7 gap-0.5 p-1" role="group">
        {shapes.map((preset) => (
          <MenuGridItem
            key={preset}
            id={`shape-${preset}`}
            label={shapeName(preset)}
            className="size-8"
            onSelect={() => {
              controller.insertShape(preset)
              close()
            }}
          >
            <ShapeIcon preset={preset} className="text-foreground/80" />
          </MenuGridItem>
        ))}
      </div>
    ),
  }
}

/** Insert ▸ Shape ▸ each gallery group as a grid. */
export function shapeSubmenu(controller: PresentationController): MenuEntry {
  return {
    type: 'submenu',
    id: 'insert-shape',
    label: ui("Shape"),
    icon: Shapes,
    disabled: controller.readOnly,
    items: PRESET_SHAPE_GALLERY.filter((group) => group.id !== 'lines').map((group): MenuEntry => ({
      type: 'submenu',
      id: `shape-group-${group.id}`,
      label: galleryLabel(group.id, group.label),
      items: [shapeGrid(controller, group.shapes)],
    })),
  }
}

/** Line, Arrow, Double arrow, and the connectors, for Insert ▸ Line and the toolbar's Line menu. */
export function lineEntries(controller: PresentationController): MenuEntry[] {
  return [
    { type: 'item', id: 'line', label: ui("Line"), icon: Minus, onSelect: () => controller.insertShape('line') },
    { type: 'item', id: 'arrow', label: ui("Arrow"), onSelect: () => controller.insertShape('straightConnector1', undefined, { tail: 'triangle' }) },
    { type: 'item', id: 'double-arrow', label: ui("Double arrow"), onSelect: () => controller.insertShape('straightConnector1', undefined, { head: 'triangle', tail: 'triangle' }) },
    separator,
    { type: 'item', id: 'elbow-connector', label: shapeName('bentConnector3'), onSelect: () => controller.insertShape('bentConnector3') },
    { type: 'item', id: 'curved-connector', label: shapeName('curvedConnector3'), onSelect: () => controller.insertShape('curvedConnector3') },
  ]
}

export function insertMenuEntries(host: PresentationMenuHost): MenuEntry[] {
  const { controller } = host
  const readOnly = controller.readOnly
  const onSlideText = slideTextEditor(controller) !== undefined
  const typing = typingText(controller)
  const format = controller.formatState()
  return [
    { type: 'item', id: 'text-box', label: ui("Text box"), icon: Type, disabled: readOnly, onSelect: () => controller.insertTextBox() },
    { type: 'item', id: 'image', label: ui("Image…"), icon: ImagePlus, disabled: readOnly, onSelect: host.insertImage },
    shapeSubmenu(controller),
    { type: 'submenu', id: 'insert-line', label: ui("Line"), icon: Minus, disabled: readOnly, items: lineEntries(controller) },
    {
      type: 'submenu', id: 'insert-table', label: ui("Table"), icon: Table, disabled: readOnly,
      items: [{ type: 'custom', id: 'table-grid', render: (close) => <MenuTableGrid onPick={(rows, columns) => { controller.insertTable(rows, columns); close() }} /> }],
    },
    separator,
    { type: 'item', id: 'link', label: ui("Link…"), icon: Link2, shortcut: mod('k'), disabled: readOnly || !format.canFormatText, onSelect: host.openLink },
    separator,
    // Fields go in at the caret, as PowerPoint's Insert ▸ Slide Number does while text is being edited.
    { type: 'item', id: 'slide-number', label: ui("Slide number"), icon: Hash, disabled: readOnly || !onSlideText, onSelect: () => controller.insertField('slideNumber') },
    {
      type: 'submenu', id: 'date-time', label: ui("Date and time"), icon: CalendarClock, disabled: readOnly || !onSlideText,
      items: [
        { type: 'item', id: 'date', label: ui("Date"), onSelect: () => controller.insertField('date') },
        { type: 'item', id: 'time', label: ui("Time"), onSelect: () => controller.insertField('time') },
      ],
    },
    {
      type: 'submenu', id: 'special-characters', label: ui("Special characters"), icon: Omega, disabled: readOnly || !typing,
      items: [{
        type: 'custom',
        id: 'characters',
        render: (close) => (
          <div className="grid w-max grid-cols-8 gap-0.5 p-1" role="group" aria-label={ui("Special characters")}>
            {SPECIAL_CHARACTERS.map((character) => (
              <MenuGridItem
                key={character}
                id={`character-${character}`}
                label={character}
                className="size-7 text-sm"
                onSelect={() => {
                  controller.insertText(character)
                  close()
                }}
              >
                {character}
              </MenuGridItem>
            ))}
          </div>
        ),
      }],
    },
    separator,
    { type: 'item', id: 'new-slide', label: ui("New slide"), icon: Plus, shortcut: newSlideShortcut(), disabled: readOnly, onSelect: () => controller.addSlide() },
    { type: 'item', id: 'duplicate-slide', label: ui("Duplicate slide"), icon: CopyPlus, disabled: readOnly, onSelect: () => controller.duplicateSlides() },
  ]
}

// -------------------------------------------------------------------------------------------
// Format

/** A color swatch for a menu row (made once per color, so menus never create components while rendering). */
const swatches = new Map<string, MenuIcon>()
function swatch(hex: string): MenuIcon {
  let icon = swatches.get(hex)
  if (!icon) {
    icon = ({ className }) => <span aria-hidden className={cn('size-4 shrink-0 rounded-sm border border-black/15 dark:border-white/20', className)} style={{ background: `#${hex}` }} />
    swatches.set(hex, icon)
  }
  return icon
}

/** An RGB highlight as `setHighlight` takes it. */
export const highlightColor = (hex: string) => `<a:srgbClr val="${hex}"/>`

export function formatMenuEntries(host: PresentationMenuHost): MenuEntry[] {
  const { controller } = host
  const format = controller.formatState()
  const readOnly = controller.readOnly
  const disabled = readOnly || !format.canFormatText
  const box = format.textBox
  const align = (value: 'l' | 'ctr' | 'r' | 'just', label: string, key: string): MenuEntry => ({
    type: 'item', id: `align-${value}`, label, radio: true, checked: format.align === value, shortcut: mod(key, { shift: true }), onSelect: () => controller.setAlign(value),
  })
  const anchor = (value: 't' | 'ctr' | 'b', label: string): MenuEntry => ({
    type: 'item', id: `anchor-${value}`, label, radio: true, checked: box?.anchor === value, disabled: !box, onSelect: () => controller.setTextAnchor(value),
  })
  const autofit = (value: 'none' | 'norm' | 'shape', label: string): MenuEntry => ({
    type: 'item', id: `autofit-${value}`, label, radio: true, checked: box?.autofit === value, onSelect: () => controller.setAutofit(value),
  })
  return [
    {
      type: 'submenu', id: 'text', label: ui("Text"), icon: Bold, disabled,
      items: [
        // Toggles show their state with a check, as Docs' Format ▸ Text does.
        { type: 'item', id: 'bold', label: ui("Bold"), shortcut: mod('b'), checked: format.bold, onSelect: () => controller.toggleMark('b') },
        { type: 'item', id: 'italic', label: ui("Italic"), shortcut: mod('i'), checked: format.italic, onSelect: () => controller.toggleMark('i') },
        { type: 'item', id: 'underline', label: ui("Underline"), shortcut: mod('u'), checked: format.underline, onSelect: () => controller.toggleMark('u') },
        { type: 'item', id: 'strikethrough', label: ui("Strikethrough"), checked: format.strike, onSelect: () => controller.toggleMark('strike') },
        separator,
        { type: 'item', id: 'superscript', label: ui("Superscript"), checked: format.baseline === 'sup', onSelect: () => controller.toggleBaseline('sup') },
        { type: 'item', id: 'subscript', label: ui("Subscript"), checked: format.baseline === 'sub', onSelect: () => controller.toggleBaseline('sub') },
        separator,
        { type: 'item', id: 'font-bigger', label: ui("Increase font size"), shortcut: mod('>', { shift: true }), onSelect: () => controller.stepFontSize(1) },
        { type: 'item', id: 'font-smaller', label: ui("Decrease font size"), shortcut: mod('<', { shift: true }), onSelect: () => controller.stepFontSize(-1) },
      ],
    },
    {
      type: 'submenu', id: 'highlight', label: ui("Highlight color"), icon: Highlighter, disabled,
      items: [
        { type: 'item', id: 'highlight-none', label: ui("No highlight"), icon: NoColorSwatch, radio: true, checked: !format.highlight, onSelect: () => controller.setHighlight(undefined) },
        separator,
        ...HIGHLIGHT_COLORS.map(({ hex, name }): MenuEntry => ({
          type: 'item', id: `highlight-${hex}`, label: name(), icon: swatch(hex), radio: true, checked: format.highlight?.includes(`"${hex}"`) ?? false, onSelect: () => controller.setHighlight(highlightColor(hex)),
        })),
      ],
    },
    {
      type: 'submenu', id: 'align-indent', label: ui("Align & indent"), icon: AlignLeft, disabled,
      items: [
        align('l', ui("Align left"), 'l'),
        align('ctr', ui("Center"), 'e'),
        align('r', ui("Align right"), 'r'),
        align('just', ui("Justify"), 'j'),
        separator,
        anchor('t', ui("Top")),
        anchor('ctr', ui("Middle")),
        anchor('b', ui("Bottom")),
        separator,
        { type: 'item', id: 'indent-more', label: ui("Increase indent"), icon: IndentIncrease, onSelect: () => controller.changeLevel(1) },
        { type: 'item', id: 'indent-less', label: ui("Decrease indent"), icon: IndentDecrease, onSelect: () => controller.changeLevel(-1) },
      ],
    },
    {
      type: 'submenu', id: 'line-spacing', label: ui("Line spacing"), disabled,
      items: LINE_SPACING.map((value): MenuEntry => ({ type: 'item', id: `line-spacing-${value}`, label: lineSpacingLabel(value), onSelect: () => controller.setLineSpacing(value) })),
    },
    {
      type: 'submenu', id: 'lists', label: ui("Bullets & numbering"), icon: List, disabled,
      items: [
        { type: 'item', id: 'bulleted', label: ui("Bulleted list"), icon: List, shortcut: mod('8', { shift: true }), checked: format.bullets === 'char', onSelect: () => controller.setBullets('char') },
        { type: 'item', id: 'numbered', label: ui("Numbered list"), icon: ListOrdered, shortcut: mod('7', { shift: true }), checked: format.bullets === 'number', onSelect: () => controller.setBullets('number') },
      ],
    },
    {
      type: 'submenu', id: 'text-fitting', label: ui("Text fitting"), disabled: readOnly || !box,
      items: [
        autofit('none', ui("Do not autofit")),
        autofit('norm', ui("Shrink text on overflow")),
        autofit('shape', ui("Resize shape to fit text")),
      ],
    },
    separator,
    { type: 'item', id: 'clear-formatting', label: ui("Clear formatting"), icon: RemoveFormatting, shortcut: mod('\\'), disabled, onSelect: () => controller.clearFormatting() },
    separator,
    { type: 'item', id: 'format-options', label: ui("Format options"), icon: PanelRight, disabled: readOnly, onSelect: host.openFormatPanel },
  ]
}

// -------------------------------------------------------------------------------------------
// Slides

/** Layout ▸ the deck's layouts, with the selected slides' own checked. */
export function layoutSubmenu(controller: PresentationController, label = ui("Layout")): MenuEntry {
  const current = new Set(controller.state.slides.map((key) => controller.slide(key)?.layout))
  return {
    type: 'submenu',
    id: 'layout',
    label,
    icon: LayoutTemplate,
    disabled: controller.readOnly,
    items: controller.layouts().map((layout): MenuEntry => ({
      type: 'item', id: `layout-${layout.path}`, label: layout.name || ui("Untitled layout"), radio: true, checked: current.size === 1 && current.has(layout.path), onSelect: () => controller.setLayout(layout.path),
    })),
  }
}

/** Moves the selected slides to the beginning, one place up or down, or to the end (one undo step). */
export function moveSlides(controller: PresentationController, where: 'start' | 'up' | 'down' | 'end'): void {
  const keys = controller.slideKeys()
  const selected = keys.filter((key) => controller.state.slides.includes(key))
  if (!selected.length) return
  const remaining = keys.length - selected.length
  // Where a slide lands, counted among the slides that do not move.
  const before = (key: string) => keys.slice(0, keys.indexOf(key)).filter((other) => !selected.includes(other)).length
  const index = where === 'start' ? 0 : where === 'end' ? remaining : where === 'up' ? before(selected[0]!) - 1 : before(selected[selected.length - 1]!) + 1
  controller.moveSlides(selected, Math.max(0, Math.min(remaining, index)))
}

/** Where the selected slides are: whether they can move up (to the beginning) or down (to the end). */
export function slidePosition(controller: PresentationController): { count: number; selected: number; canMoveUp: boolean; canMoveDown: boolean } {
  const keys = controller.slideKeys()
  const indexes = controller.state.slides.map((key) => keys.indexOf(key)).filter((index) => index >= 0)
  const count = keys.length
  const selected = indexes.length
  const first = selected ? minOf(indexes) : -1
  const last = selected ? maxOf(indexes) : -1
  // Already together at the top (or bottom): nothing to move.
  const atTop = first === 0 && last === selected - 1
  const atBottom = last === count - 1 && first === count - selected
  return { count, selected, canMoveUp: selected > 0 && !atTop, canMoveDown: selected > 0 && !atBottom }
}

function hiddenEntry(controller: PresentationController): MenuEntry {
  const hidden = controller.state.slides.length > 0 && controller.state.slides.every((key) => controller.slide(key)?.hidden)
  return { type: 'item', id: 'hide-slide', label: ui("Hide slide"), checked: hidden, disabled: controller.readOnly, onSelect: () => controller.setSlidesHidden(!hidden) }
}

function slideEntries(controller: PresentationController, duplicateShortcut = false): MenuEntry[] {
  const readOnly = controller.readOnly
  const position = slidePosition(controller)
  return [
    { type: 'item', id: 'new-slide', label: ui("New slide"), icon: Plus, shortcut: newSlideShortcut(), disabled: readOnly, onSelect: () => controller.addSlide() },
    { type: 'item', id: 'duplicate-slide', label: ui("Duplicate slide"), icon: CopyPlus, ...(duplicateShortcut ? { shortcut: mod('d') } : {}), disabled: readOnly, onSelect: () => controller.duplicateSlides() },
    { type: 'item', id: 'delete-slide', label: ui("Delete slide"), icon: Trash2, disabled: readOnly || !position.selected || position.selected >= position.count, onSelect: () => controller.deleteSlides() },
    hiddenEntry(controller),
  ]
}

/** The menu bar's Slide menu. */
export function slideMenuEntries(host: PresentationMenuHost): MenuEntry[] {
  const { controller } = host
  const readOnly = controller.readOnly
  const position = slidePosition(controller)
  const slide = controller.state.slide
  return [
    ...slideEntries(controller),
    separator,
    layoutSubmenu(controller, ui("Apply layout")),
    { type: 'item', id: 'reset-slide', label: ui("Reset slide"), disabled: readOnly, onSelect: () => controller.resetSlides() },
    { type: 'item', id: 'change-background', label: ui("Change background"), icon: PaintBucket, disabled: readOnly, onSelect: host.openBackground },
    separator,
    {
      type: 'submenu', id: 'move-slide', label: ui("Move slide"), disabled: readOnly || (!position.canMoveUp && !position.canMoveDown),
      items: [
        { type: 'item', id: 'move-start', label: ui("Move slide to beginning"), icon: ArrowUpToLine, disabled: !position.canMoveUp, onSelect: () => moveSlides(controller, 'start') },
        { type: 'item', id: 'move-up', label: ui("Move slide up"), disabled: !position.canMoveUp, onSelect: () => moveSlides(controller, 'up') },
        { type: 'item', id: 'move-down', label: ui("Move slide down"), disabled: !position.canMoveDown, onSelect: () => moveSlides(controller, 'down') },
        { type: 'item', id: 'move-end', label: ui("Move slide to end"), icon: ArrowDownToLine, disabled: !position.canMoveDown, onSelect: () => moveSlides(controller, 'end') },
      ],
    },
    separator,
    { type: 'item', id: 'add-section', label: ui("Add section…"), icon: FolderPlus, disabled: readOnly || !slide, onSelect: () => { if (slide) host.addSection(slide) } },
  ]
}

/** Right-click on a thumbnail (strip or sorter): the selected slides. */
export function slideContextEntries(host: PresentationMenuHost, slideKey: string): MenuEntry[] {
  const { controller } = host
  const readOnly = controller.readOnly
  const position = slidePosition(controller)
  const section = sectionOf(controller, slideKey)
  return [
    ...slideEntries(controller, true),
    separator,
    ...clipboardEntries(controller, 'slides'),
    separator,
    layoutSubmenu(controller),
    { type: 'item', id: 'reset-slide', label: ui("Reset slide"), disabled: readOnly, onSelect: () => controller.resetSlides() },
    { type: 'item', id: 'change-background', label: ui("Change background"), icon: PaintBucket, disabled: readOnly, onSelect: host.openBackground },
    separator,
    { type: 'item', id: 'move-start', label: ui("Move slide to beginning"), icon: ArrowUpToLine, disabled: readOnly || !position.canMoveUp, onSelect: () => moveSlides(controller, 'start') },
    { type: 'item', id: 'move-end', label: ui("Move slide to end"), icon: ArrowDownToLine, disabled: readOnly || !position.canMoveDown, onSelect: () => moveSlides(controller, 'end') },
    separator,
    { type: 'item', id: 'add-section', label: ui("Add section…"), icon: FolderPlus, disabled: readOnly, onSelect: () => host.addSection(slideKey) },
    ...(section ? sectionEntries(host, section.key) : []),
  ]
}

/** Right-click on a section header; also under a thumbnail, for the section the slide is in. */
export function sectionEntries(host: PresentationMenuHost, sectionKey: string): MenuEntry[] {
  const readOnly = host.controller.readOnly
  return [
    { type: 'item', id: 'rename-section', label: ui("Rename section…"), icon: Pencil, disabled: readOnly, onSelect: () => host.renameSection(sectionKey) },
    { type: 'item', id: 'remove-section', label: ui("Remove section"), disabled: readOnly, onSelect: () => host.controller.removeSection(sectionKey) },
  ]
}

// -------------------------------------------------------------------------------------------
// Arrange

export function orderSubmenu(controller: PresentationController): MenuEntry {
  return {
    type: 'submenu', id: 'order', label: ui("Order"), icon: BringToFront, disabled: controller.readOnly || !controller.state.shapes.length,
    items: [
      { type: 'item', id: 'bring-to-front', label: ui("Bring to front"), icon: BringToFront, onSelect: () => controller.reorder('front') },
      { type: 'item', id: 'bring-forward', label: ui("Bring forward"), onSelect: () => controller.reorder('forward') },
      { type: 'item', id: 'send-backward', label: ui("Send backward"), onSelect: () => controller.reorder('backward') },
      { type: 'item', id: 'send-to-back', label: ui("Send to back"), icon: SendToBack, onSelect: () => controller.reorder('back') },
    ],
  }
}

export function alignSubmenu(host: PresentationMenuHost): MenuEntry {
  const { controller } = host
  const count = controller.state.shapes.length
  // One shape always aligns to the slide, as in PowerPoint and Slides.
  const toSlide = host.alignTo === 'slide' || count < 2
  const edge = (value: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom', label: string, icon: MenuIcon): MenuEntry => ({
    type: 'item', id: `align-${value}`, label, icon, onSelect: () => controller.align(value, toSlide ? 'slide' : 'selection'),
  })
  return {
    type: 'submenu', id: 'align', label: ui("Align"), icon: AlignStartVertical, disabled: controller.readOnly || !count,
    items: [
      edge('left', ui("Align left edges"), AlignStartVertical),
      edge('center', ui("Align centers"), AlignCenterVertical),
      edge('right', ui("Align right edges"), AlignEndVertical),
      separator,
      edge('top', ui("Align top edges"), AlignStartHorizontal),
      edge('middle', ui("Align middles"), AlignCenterHorizontal),
      edge('bottom', ui("Align bottom edges"), AlignEndHorizontal),
      separator,
      { type: 'item', id: 'align-to-selection', label: ui("Align selected objects"), radio: true, checked: !toSlide, disabled: count < 2, onSelect: () => host.setAlignTo('auto') },
      { type: 'item', id: 'align-to-slide', label: ui("Align to slide"), radio: true, checked: toSlide, disabled: count < 2, onSelect: () => host.setAlignTo('slide') },
    ],
  }
}

export function distributeSubmenu(host: PresentationMenuHost): MenuEntry {
  const { controller } = host
  const toSlide = host.alignTo === 'slide'
  const count = controller.state.shapes.length
  const relativeTo = toSlide ? 'slide' : 'selection'
  return {
    type: 'submenu', id: 'distribute', label: ui("Distribute"), icon: AlignHorizontalDistributeCenter, disabled: controller.readOnly || count < (toSlide ? 1 : 3),
    items: [
      { type: 'item', id: 'distribute-horizontal', label: ui("Horizontally"), icon: AlignHorizontalDistributeCenter, onSelect: () => controller.distribute('horizontal', relativeTo) },
      { type: 'item', id: 'distribute-vertical', label: ui("Vertically"), icon: AlignVerticalDistributeCenter, onSelect: () => controller.distribute('vertical', relativeTo) },
    ],
  }
}

/**
 * Slides' Center on page: the selection moves as one into the middle of the slide, keeping the
 * shapes where they are relative to each other (Align ▸ Align to slide stacks each on the center).
 * One undo step.
 */
export function centerOnPage(controller: PresentationController, axis: 'horizontal' | 'vertical'): void {
  const slide = controller.state.slide
  if (!slide) return
  const xfrms = controller.state.shapes.map((key) => controller.shapeXfrm(slide, key)).filter((xfrm) => xfrm !== undefined)
  if (!xfrms.length) return
  const horizontal = axis === 'horizontal'
  const start = minOf(xfrms.map((xfrm) => (horizontal ? xfrm.x : xfrm.y)))
  const end = maxOf(xfrms.map((xfrm) => (horizontal ? xfrm.x + xfrm.cx : xfrm.y + xfrm.cy)))
  const size = controller.size()
  const extent = (horizontal ? size.width : size.height) * EMU_PER_PX
  const delta = Math.round((extent - (end - start)) / 2 - start)
  if (delta) controller.nudge(horizontal ? delta : 0, horizontal ? 0 : delta)
}

export function centerSubmenu(controller: PresentationController): MenuEntry {
  return {
    type: 'submenu', id: 'center-on-page', label: ui("Center on page"), icon: AlignCenterHorizontal, disabled: controller.readOnly || !controller.state.shapes.length,
    items: [
      { type: 'item', id: 'center-horizontal', label: ui("Horizontally"), icon: AlignCenterVertical, onSelect: () => centerOnPage(controller, 'horizontal') },
      { type: 'item', id: 'center-vertical', label: ui("Vertically"), icon: AlignCenterHorizontal, onSelect: () => centerOnPage(controller, 'vertical') },
    ],
  }
}

export function rotateSubmenu(controller: PresentationController): MenuEntry {
  return {
    type: 'submenu', id: 'rotate', label: ui("Rotate"), icon: RotateCw, disabled: controller.readOnly || !canTurn(controller),
    items: [
      { type: 'item', id: 'rotate-right', label: ui("Rotate clockwise 90°"), icon: RotateCw, onSelect: () => controller.rotateBy(90) },
      { type: 'item', id: 'rotate-left', label: ui("Rotate counter-clockwise 90°"), icon: RotateCcw, onSelect: () => controller.rotateBy(-90) },
      separator,
      { type: 'item', id: 'flip-horizontal', label: ui("Flip horizontally"), icon: FlipHorizontal2, onSelect: () => controller.flip('horizontal') },
      { type: 'item', id: 'flip-vertical', label: ui("Flip vertically"), icon: FlipVertical2, onSelect: () => controller.flip('vertical') },
    ],
  }
}

export function groupEntries(controller: PresentationController): MenuEntry[] {
  const readOnly = controller.readOnly
  const grouped = selectedShapes(controller).some((shape) => shape.kind === 'grpSp')
  return [
    { type: 'item', id: 'group', label: ui("Group"), icon: Group, shortcut: mod('g'), disabled: readOnly || controller.state.shapes.length < 2, onSelect: () => controller.group() },
    { type: 'item', id: 'ungroup', label: ui("Ungroup"), icon: Ungroup, shortcut: mod('g', { shift: true }), disabled: readOnly || !grouped, onSelect: () => controller.ungroup() },
  ]
}

export function arrangeMenuEntries(host: PresentationMenuHost): MenuEntry[] {
  const { controller } = host
  return [
    orderSubmenu(controller),
    alignSubmenu(host),
    distributeSubmenu(host),
    centerSubmenu(controller),
    rotateSubmenu(controller),
    separator,
    ...groupEntries(controller),
  ]
}

// -------------------------------------------------------------------------------------------
// The slide's right-click menus

/** Insert rows and columns around the cell; delete its rows, its columns, or the table. */
export function tableEntries(controller: PresentationController, cell?: Cell): MenuEntry[] {
  const target = controller.tableSelection(cell)
  const disabled = controller.readOnly || !target
  const onCell = !disabled && target?.cell !== undefined
  return [
    { type: 'item', id: 'insert-row-above', label: ui("Insert row above"), disabled, onSelect: () => controller.insertTableRow('above', cell) },
    { type: 'item', id: 'insert-row-below', label: ui("Insert row below"), disabled, onSelect: () => controller.insertTableRow('below', cell) },
    { type: 'item', id: 'insert-column-left', label: ui("Insert column left"), disabled, onSelect: () => controller.insertTableColumn('left', cell) },
    { type: 'item', id: 'insert-column-right', label: ui("Insert column right"), disabled, onSelect: () => controller.insertTableColumn('right', cell) },
    separator,
    { type: 'item', id: 'delete-row', label: ui("Delete row"), disabled: !onCell, onSelect: () => controller.deleteTableRows(cell) },
    { type: 'item', id: 'delete-column', label: ui("Delete column"), disabled: !onCell, onSelect: () => controller.deleteTableColumns(cell) },
    { type: 'item', id: 'delete-table', label: ui("Delete table"), icon: Trash2, disabled, onSelect: () => controller.deleteTable() },
  ]
}

/** Right-click on a shape (and, on a table, its cell). */
export function shapeContextEntries(host: PresentationMenuHost, shapeKey: string, cell?: Cell): MenuEntry[] {
  const { controller } = host
  const readOnly = controller.readOnly
  const slide = controller.state.slide
  const shape = slide ? controller.shape(slide, shapeKey) : undefined
  const editable = !readOnly && slide !== undefined && (shape?.table ? cell !== undefined : shape?.kind === 'sp')
  return [
    ...clipboardEntries(controller),
    separator,
    { type: 'item', id: 'duplicate', label: ui("Duplicate"), icon: CopyPlus, shortcut: mod('d'), disabled: readOnly, onSelect: () => controller.duplicateSelection() },
    { type: 'item', id: 'delete', label: ui("Delete"), icon: Trash2, disabled: readOnly, onSelect: () => controller.deleteSelection() },
    separator,
    ...(shape?.table ? [...tableEntries(controller, cell), separator] : []),
    orderSubmenu(controller),
    alignSubmenu(host),
    rotateSubmenu(controller),
    separator,
    ...groupEntries(controller),
    separator,
    {
      type: 'item', id: 'edit-text', label: ui("Edit text"), icon: Type, disabled: !editable,
      onSelect: () => {
        if (slide) controller.setState({ shapes: [shapeKey], editing: { slide, shape: shapeKey, ...(shape?.table && cell ? cell : {}) } })
      },
    },
    { type: 'item', id: 'link', label: ui("Link…"), icon: Link2, shortcut: mod('k'), disabled: readOnly || !controller.formatState().canFormatText, onSelect: host.openLink },
    { type: 'item', id: 'format-options', label: ui("Format options"), icon: PanelRight, disabled: readOnly, onSelect: host.openFormatPanel },
  ]
}

/** Right-click on the slide where there is no shape. */
export function canvasContextEntries(host: PresentationMenuHost): MenuEntry[] {
  const { controller } = host
  const readOnly = controller.readOnly
  return [
    { type: 'item', id: 'paste', label: ui("Paste"), icon: ClipboardPaste, shortcut: mod('v'), disabled: readOnly, onSelect: () => void controller.pasteFromClipboard().catch(ignore) },
    separator,
    { type: 'item', id: 'new-slide', label: ui("New slide"), icon: Plus, shortcut: newSlideShortcut(), disabled: readOnly, onSelect: () => controller.addSlide() },
    { type: 'item', id: 'duplicate-slide', label: ui("Duplicate slide"), icon: CopyPlus, disabled: readOnly, onSelect: () => controller.duplicateSlides() },
    layoutSubmenu(controller),
    { type: 'item', id: 'reset-slide', label: ui("Reset slide"), disabled: readOnly, onSelect: () => controller.resetSlides() },
    { type: 'item', id: 'change-background', label: ui("Change background"), icon: PaintBucket, disabled: readOnly, onSelect: host.openBackground },
    hiddenEntry(controller),
  ]
}
