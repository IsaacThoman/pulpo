import { maxOf } from '../../../collections.js'
import * as Y from 'yjs'
import type { Awareness } from 'y-protocols/awareness'
import type { LiveAssetStore } from '../../live-format.js'
import { MAX_EXPANDED_CELLS } from '../limits.js'
import { columnIntervalProps } from '../model/column-intervals.js'
import { cellName, MAX_COLS, MAX_ROWS, parseCellName, parseRangeName, rangeContains, rangeName, type CellRange } from '../address.js'
import { toA1Form, toIdForm } from '../model/formula-ids.js'
import type { AutoFilter, DrawingObject, Hyperlink, Note, RangeIds, SheetColor, SheetFormat, StyleProps } from '../model/schema.js'
import { WorkbookModel, type SheetModel } from '../model/workbook.js'
import { Stylesheet, type ResolvedStyle } from '../styles/stylesheet.js'
import { CachedValues, isErrorValue, type CellValue, type SheetValues } from '../values.js'
import { cssColor, readThemeColors, type ThemeColors } from './colors.js'
import * as commands from './commands.js'
import { ConditionalFormatter } from './conditional.js'
import { CellDisplay, type CellRender } from './display.js'
import { canInsertReference, formulaReferences, insertReference, type FunctionDoc } from './formula-assist.js'
import { AxisLayout, columnWidthToPixels, defaultColumnPixels, pixelsToColumnWidth, POINTS_TO_PIXELS } from './layout.js'
import { DARK_PALETTE, GridRenderer, LIGHT_PALETTE, type RemoteSelection, type Scene } from './renderer.js'
import { SheetInteractions } from './interactions.js'
import { trackEdits } from '../model/edits.js'
import { SheetCalc } from '../calc.js'
import { parseChart, renderChartSvg } from '../chart/index.js'
import { errorFromCode } from '../formula/types.js'
import { FUNCTION_DOCS } from '../formula/functions/docs.js'
import { formatValue } from '../numfmt/index.js'

export interface SheetViewLabels {
  sortAscending: string
  sortDescending: string
  selectAll: string
  blanks: string
  ok: string
  cancel: string
  search: string
  clearFilter: string
  dataErrors: Record<keyof typeof commands.DATA_ERRORS, string>
  invalidValue: string
  chartUnavailable: string
  imageUnavailable: string
  linkHint: string
}

export const DEFAULT_LABELS: SheetViewLabels = {
  dataErrors: commands.DATA_ERRORS,
  sortAscending: 'Sort A to Z',
  sortDescending: 'Sort Z to A',
  selectAll: 'Select all',
  blanks: '(Blanks)',
  ok: 'OK',
  cancel: 'Cancel',
  search: 'Search',
  clearFilter: 'Clear filter',
  invalidValue: "This value doesn't match the data validation rules for this cell.",
  chartUnavailable: "This chart type can't be shown yet",
  imageUnavailable: "This image can't be shown",
  linkHint: 'Ctrl+click to open the link',
}

export interface SheetViewUser {
  name: string
  color: string
}

export interface SheetViewOptions {
  container: HTMLElement
  doc: Y.Doc
  awareness?: Awareness
  readOnly?: boolean
  /** The current file extension takes precedence over the imported workbook format. */
  fileFormat?: SheetFormat
  assets: LiveAssetStore
  user: SheetViewUser
  labels?: Partial<SheetViewLabels>
  /** Values to show: by default formulas are calculated live; 'cached' shows the file's cached values. */
  values?: SheetValues | 'cached'
  /** Function documentation for formula autocomplete and hints. */
  functions?: readonly FunctionDoc[]
  appearance?: 'light' | 'dark'
  /** Renders a chart part (DrawingML chart XML) as an SVG string; the built-in renderer by default. */
  renderChart?: (xml: string, size: { width: number; height: number }, theme: ThemeColors, resolve: (formula: string) => CellValue[][] | undefined) => string | undefined
  /** Opens an external link (never fetched automatically). Default: a new tab without opener. */
  openLink?: (url: string) => void
}

export interface Selection {
  ranges: CellRange[]
  active: { row: number; col: number }
  /** The corner the selection extends from (the active cell unless moved with Enter/Tab). */
  anchor: { row: number; col: number }
}

export interface EditState {
  sheetId: string
  rowId: string
  colId: string
  ranges: RangeIds[]
  row: number
  col: number
  text: string
  caret: number
  /** Started by typing (arrows commit) rather than F2/double-click (arrows move the caret). */
  enterMode: boolean
}

export interface FindOptions {
  matchCase?: boolean
  /** The whole cell must match. */
  entireCell?: boolean
  /** Search formulas rather than shown values. */
  formulas?: boolean
  allSheets?: boolean
}

export interface SheetSummary {
  count: number
  numbers: number
  sum: number
  average: number | undefined
  min: number | undefined
  max: number | undefined
}

export interface SheetViewState {
  sheetId: string
  sheets: { id: string; name: string; state: string; color?: string }[]
  selection: Selection
  /** `B3` or `B3:D9`. */
  selectionLabel: string
  /** What the formula bar shows for the active cell. */
  activeInput: string
  activeStyle: ResolvedStyle
  activeNote?: Note
  activeLink?: Hyperlink
  editing?: EditState
  canUndo: boolean
  canRedo: boolean
  zoom: number
  frozen: { rows: number; cols: number }
  readOnly: boolean
  valuesOnly: boolean
  hasFilter: boolean
  summary: SheetSummary
}

const FONT_FALLBACKS: Record<string, string> = {
  calibri: 'Calibri, Carlito, "Segoe UI", system-ui, sans-serif',
  'calibri light': '"Calibri Light", Carlito, "Segoe UI Light", system-ui, sans-serif',
  cambria: 'Cambria, Caladea, Georgia, serif',
  arial: 'Arial, "Liberation Sans", Helvetica, sans-serif',
  helvetica: 'Helvetica, Arial, "Liberation Sans", sans-serif',
  'times new roman': '"Times New Roman", "Liberation Serif", Times, serif',
  'courier new': '"Courier New", "Liberation Mono", Courier, monospace',
  aptos: 'Aptos, Calibri, Carlito, "Segoe UI", system-ui, sans-serif',
  'aptos narrow': '"Aptos Narrow", "Arial Narrow", Calibri, sans-serif',
  verdana: 'Verdana, "DejaVu Sans", sans-serif',
  tahoma: 'Tahoma, Verdana, sans-serif',
  georgia: 'Georgia, serif',
}

/** Quotes a CSS string without allowing file text to introduce declarations. */
function cssString(value: string): string {
  return '"' + value.replace(/[\\"\n\r\f]/g, (char) => char === '\\' || char === '"' ? '\\' + char : '\\' + char.charCodeAt(0).toString(16) + ' ') + '"'
}

function printColor(value: string | undefined): string {
  return value && (/^#[0-9a-f]{3,8}$/i.test(value) || /^(?:black|white|red|green|blue|yellow|cyan|magenta|gray|grey|silver|maroon|olive|lime|aqua|teal|navy|fuchsia|purple|orange|transparent|currentColor)$/i.test(value)) ? value : ''
}

export function cssFontFamily(name: string): string {
  return FONT_FALLBACKS[name.toLowerCase()] ?? `${cssString(name)}, system-ui, sans-serif`
}

/** EMUs per CSS pixel. */
export const EMU_PER_PIXEL = 9525

/**
 * A spreadsheet editor in a container: a canvas-rendered grid with selection, editing, and
 * collaboration. Framework-free, so web and mobile web views share it. Toolbars call `commands`
 * and read `getState()`; `subscribe` reports changes.
 */
export class SheetView {
  readonly workbook: WorkbookModel
  readonly origin = { sheetView: true }
  readonly undoManager: Y.UndoManager
  readonly labels: SheetViewLabels
  readonly root: HTMLDivElement
  readonly scroller: HTMLDivElement
  readonly spacer: HTMLDivElement
  readonly canvas: HTMLCanvasElement
  readonly overlay: HTMLDivElement
  readonly input: HTMLTextAreaElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly renderer: GridRenderer
  readonly values: SheetValues
  /** Function documentation for formula autocomplete and hints. */
  readonly functions: readonly FunctionDoc[]
  private readonly ownsValues: boolean
  private readonly listeners = new Set<() => void>()
  private readonly disposers: (() => void)[] = []
  private interactions!: SheetInteractions

  private sheetIdValue = ''
  selection: Selection = { ranges: [{ top: 0, left: 0, bottom: 0, right: 0 }], active: { row: 0, col: 0 }, anchor: { row: 0, col: 0 } }
  editing: EditState | undefined
  zoom = 1
  private width = 0
  private height = 0
  private dpr = 1
  private rowLayout!: AxisLayout
  private colLayout!: AxisLayout
  private rowCount = 1000
  private colCount = 26
  private stylesheet: Stylesheet
  private stylesXml: string | undefined
  theme: ThemeColors
  private display!: CellDisplay
  private conditional!: ConditionalFormatter
  digitWidth = 7
  /** The file font's digit width over the drawn font's (see Scene.widthScale). */
  widthScale = 1
  private frame = 0
  private notifyFrame = 0
  copyRange: CellRange | undefined
  /** A reference being inserted by pointing while editing a formula. */
  pointing: { start: number; end: number; anchor: { row: number; col: number }; corner: { row: number; col: number } } | undefined
  private readOnlyValue = false
  /** Invalidates chart output when cells or calculated values change. */
  valuesRevision = 0
  private themeXml: string | undefined
  private destroyed = false

  constructor(readonly options: SheetViewOptions) {
    this.workbook = new WorkbookModel(options.doc, this.origin)
    this.disposers.push(trackEdits(options.doc))
    this.labels = { ...DEFAULT_LABELS, ...options.labels }
    this.functions = options.functions ?? FUNCTION_DOCS
    this.readOnlyValue = !!options.readOnly
    this.ownsValues = !options.values || options.values === 'cached'
    // Formulas are calculated live unless the host passes its own values ('cached' shows the
    // values the file had cached, for read-only previews).
    this.values = options.values === 'cached' ? new CachedValues(this.workbook) : (options.values ?? new SheetCalc(this.workbook))
    this.stylesXml = this.workbook.metaValue('stylesXml')
    this.stylesheet = new Stylesheet(this.stylesXml)
    this.themeXml = this.workbook.metaValue('themeXml')
    this.theme = readThemeColors(this.themeXml)
    this.undoManager = new Y.UndoManager(this.workbook.root, { trackedOrigins: new Set([this.origin]), captureTimeout: 0 })
    for (const sheet of this.workbook.sheets()) this.undoManager.addToScope([sheet.positionRows.order, sheet.positionRows.dead])
    this.undoManager.on('stack-item-added', (event: { stackItem: { meta: Map<string, unknown> } }) => {
      event.stackItem.meta.set('selection', this.selection)
      event.stackItem.meta.set('sheet', this.sheetIdValue)
    })
    this.undoManager.on('stack-item-popped', (event: { stackItem: { meta: Map<string, unknown> } }) => {
      const sheet = event.stackItem.meta.get('sheet') as string | undefined
      const selection = event.stackItem.meta.get('selection') as Selection | undefined
      if (sheet && this.workbook.sheet(sheet)) this.sheetIdValue = sheet
      if (selection) this.selection = selection
      this.invalidateAll()
    })

    const root = document.createElement('div')
    root.className = 'pulpo-sheet'
    root.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;user-select:none;-webkit-user-select:none;outline:none;'
    this.root = root
    const scroller = document.createElement('div')
    scroller.className = 'pulpo-sheet-scroller'
    scroller.style.cssText = 'position:absolute;inset:0;overflow:auto;touch-action:pan-x pan-y;z-index:1;'
    this.scroller = scroller
    const spacer = document.createElement('div')
    spacer.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:1px;pointer-events:none;'
    this.spacer = spacer
    scroller.appendChild(spacer)
    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:0;'
    canvas.setAttribute('aria-hidden', 'true')
    this.canvas = canvas
    const overlay = document.createElement('div')
    overlay.className = 'pulpo-sheet-overlay'
    overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:2;'
    this.overlay = overlay
    const input = document.createElement('textarea')
    input.className = 'pulpo-sheet-input'
    input.setAttribute('aria-label', 'Cell')
    input.setAttribute('autocapitalize', 'off')
    input.setAttribute('autocomplete', 'off')
    input.setAttribute('spellcheck', 'false')
    input.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;resize:none;border:0;padding:0;margin:0;outline:none;overflow:hidden;white-space:pre-wrap;z-index:3;'
    this.input = input
    root.append(canvas, scroller, overlay, input)
    options.container.appendChild(root)
    this.ctx = canvas.getContext('2d')!
    this.renderer = new GridRenderer(this.ctx)

    const sheets = this.workbook.sheets()
    const active = this.workbook.metaValue('activeSheet')
    this.sheetIdValue = sheets.find((sheet) => sheet.id === active && sheet.state === 'visible')?.id ?? sheets.find((sheet) => sheet.state === 'visible')?.id ?? sheets[0]?.id ?? ''
    this.measureDigitWidth()
    this.rebuildSheet()
    this.restoreViewState()

    const onDocChange = (events: Y.YEvent<Y.AbstractType<unknown>>[], transaction: Y.Transaction) => this.onDocChange(events, transaction)
    this.workbook.root.observeDeep(onDocChange)
    this.disposers.push(() => this.workbook.root.unobserveDeep(onDocChange))
    this.disposers.push(this.values.subscribe(() => this.invalidateValues()))
    const resize = new ResizeObserver(() => this.resize())
    resize.observe(root)
    this.disposers.push(() => resize.disconnect())
    const onScroll = () => {
      this.maybeGrow()
      this.scheduleRender()
      this.interactions.onScroll()
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    this.disposers.push(() => scroller.removeEventListener('scroll', onScroll))
    if (options.awareness) {
      const awareness = options.awareness
      const onAwareness = () => this.scheduleRender()
      awareness.on('change', onAwareness)
      this.disposers.push(() => awareness.off('change', onAwareness))
      awareness.setLocalStateField('user', { name: options.user.name, color: options.user.color })
    }
    this.interactions = new SheetInteractions(this)
    this.resize()
    this.publishAwareness()
  }

  destroy(): void {
    if (this.destroyed) return
    this.settleEdit()
    this.destroyed = true
    cancelAnimationFrame(this.frame)
    cancelAnimationFrame(this.notifyFrame)
    for (const dispose of this.disposers) dispose()
    this.interactions.destroy()
    if (this.ownsValues) (this.values as CachedValues | SheetCalc).destroy()
    this.undoManager.destroy()
    this.options.awareness?.setLocalStateField('sheet', null)
    this.root.remove()
    this.listeners.clear()
  }

  // ── Accessors ────────────────────────────────────────────────────────────

  get sheetId(): string {
    return this.sheetIdValue
  }

  get sheet(): SheetModel {
    return this.workbook.sheet(this.sheetIdValue) ?? this.workbook.sheets()[0]!
  }

  get rows(): AxisLayout {
    return this.rowLayout
  }

  get cols(): AxisLayout {
    return this.colLayout
  }

  get readOnly(): boolean {
    return this.readOnlyValue
  }

  set readOnly(value: boolean) {
    this.readOnlyValue = value
    if (value) this.cancelEdit()
    this.scheduleRender()
    this.notify()
  }

  setFileFormat(format: SheetFormat | undefined): void {
    if (format === this.options.fileFormat) return
    this.settleEdit()
    this.options.fileFormat = format
    this.scheduleRender()
    this.notify()
  }

  get valuesOnly(): boolean {
    const format = this.options.fileFormat ?? this.workbook.metaValue('format')
    return format === 'csv' || format === 'tsv'
  }

  get headerHeight(): number {
    return this.sheet.viewProp('showHeadings') === false ? 0 : Math.round(20 * this.zoom)
  }

  get headerWidth(): number {
    if (this.sheet.viewProp('showHeadings') === false) return 0
    const lastRow = this.rowLayout ? this.rowLayout.indexAt(this.scrollY + this.rowLayout.offset(this.frozenRows) + this.height / this.zoom) : 1000
    return Math.round((Math.max(3, String(lastRow + 1).length) * 7 + 12) * this.zoom)
  }

  get frozenRows(): number {
    return this.sheet.viewProp('frozenRows') ?? 0
  }

  get frozenCols(): number {
    return this.sheet.viewProp('frozenCols') ?? 0
  }

  /** Scroll of the unfrozen pane in unzoomed pixels. */
  get scrollX(): number {
    return this.scroller.scrollLeft / this.zoom
  }

  get scrollY(): number {
    return this.scroller.scrollTop / this.zoom
  }

  get viewport(): { width: number; height: number } {
    return { width: this.width, height: this.height }
  }

  cellRender(row: number, col: number): CellRender {
    return this.display.render(row, col)
  }

  styleAt(row: number, col: number): ResolvedStyle {
    return this.display.style(row, col)
  }

  valueAt(row: number, col: number): CellValue {
    return this.values.get(this.sheet, row, col)
  }

  /** What a cell shows, as text (filters and find match against it). */
  displayText(row: number, col: number): string {
    return this.display.render(row, col).text
  }

  get stylesheetFor(): Stylesheet {
    return this.stylesheet
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // ── Setup and invalidation ───────────────────────────────────────────────

  private measureDigitWidth(): void {
    const font = this.stylesheet.defaultFont
    // Excel sizes columns by the default font's widest digit; Calibri 11 is 7 pixels wide, and
    // that holds for its metric-compatible stand-ins, so column widths match Excel exactly.
    const known: Record<string, number> = { 'calibri|11': 7, 'aptos narrow|11': 7, 'aptos|11': 7, 'arial|10': 7, 'arial|11': 8, 'calibri|10': 7, 'calibri|12': 8 }
    const fixed = known[`${font.name.toLowerCase()}|${font.size}`]
    this.ctx.font = `${font.size * POINTS_TO_PIXELS}px ${cssFontFamily(font.name)}`
    const measured = this.ctx.measureText('0').width || 7
    this.digitWidth = fixed ?? Math.max(5, Math.round(measured))
    this.widthScale = Math.min(1, this.digitWidth / measured)
  }

  /** Recomputes everything that depends on the current sheet. */
  private rebuildSheet(): void {
    this.conditional = new ConditionalFormatter(this.sheet, this.values, this.stylesheet, this.theme)
    this.display = new CellDisplay(this.sheet, this.stylesheet, this.values, this.theme, this.conditional, this.workbook.date1904)
    this.zoom = (this.sheet.viewProp('zoom') ?? 100) / 100
    const used = this.sheet.usedRange()
    this.rowCount = Math.min(MAX_ROWS, Math.max(1000, (used?.bottom ?? 0) + 100))
    this.colCount = Math.min(MAX_COLS, Math.max(26, (used?.right ?? 0) + 10))
    this.rebuildLayout()
  }

  /** Row heights and column widths in pixels. */
  rebuildLayout(): void {
    const sheet = this.sheet
    const format = (sheet.raw.get('format') as { defaultRowHeight?: number; defaultColWidth?: number; baseColWidth?: number } | undefined) ?? {}
    const defaultRow = Math.round((format.defaultRowHeight ?? 15) * POINTS_TO_PIXELS)
    const defaultCol = format.defaultColWidth ? columnWidthToPixels(format.defaultColWidth, this.digitWidth) : defaultColumnPixels(format.baseColWidth ?? 8, this.digitWidth)
    const rowSizes = new Map<number, number>()
    const colSizes = new Map<number, number>()
    // Rows without a stored height grow to fit their largest font, as Excel sizes them.
    const autoHeights = new Map<number, number>()
    const owners = new Set<string>([...sheet.xf.keys(), ...[...sheet.fmt.keys()].filter((key) => key.endsWith('|fontSize')).map((key) => key.slice(0, key.lastIndexOf('|')))])
    for (const key of owners) {
      const position = sheet.position(key)
      if (!position || sheet.rowProp(position.row, 'size') !== undefined) continue
      const size = this.display.style(position.row, position.col).fontSize
      const pixels = Math.round(size * 1.3 * POINTS_TO_PIXELS)
      if (pixels > defaultRow && pixels > (autoHeights.get(position.row) ?? 0)) autoHeights.set(position.row, pixels)
    }
    for (const [row, pixels] of autoHeights) rowSizes.set(row, pixels)
    for (const [key, value] of sheet.rowMeta) {
      const bar = key.lastIndexOf('|')
      const prop = key.slice(bar + 1)
      if (prop !== 'size' && prop !== 'hidden') continue
      const index = sheet.rowMetaPosition(key.slice(0, bar), prop)
      if (index < 0) continue
      if (prop === 'hidden' && sheet.rowProp(index, 'hidden')) rowSizes.set(index, 0)
      else if (prop === 'size' && rowSizes.get(index) !== 0) rowSizes.set(index, Math.round((sheet.rowProp(index, 'size') ?? value as number) * POINTS_TO_PIXELS))
    }
    for (const [key, value] of sheet.colMeta) {
      const bar = key.lastIndexOf('|')
      const prop = key.slice(bar + 1)
      if (prop !== 'size' && prop !== 'hidden') continue
      const index = sheet.cols.indexOf(key.slice(0, bar))
      if (index < 0) continue
      if (prop === 'hidden' && value) colSizes.set(index, 0)
      else if (prop === 'size' && colSizes.get(index) !== 0) colSizes.set(index, columnWidthToPixels(value as number, this.digitWidth))
    }
    for (let col = 0; col < Math.min(this.colCount, MAX_COLS); col++) {
      const props = columnIntervalProps(sheet, col)
      if (!colSizes.has(col) && (props.size !== undefined || props.hidden)) colSizes.set(col, props.hidden ? 0 : columnWidthToPixels(props.size!, this.digitWidth))
    }
    this.rowLayout = new AxisLayout(defaultRow, rowSizes, this.rowCount)
    this.colLayout = new AxisLayout(defaultCol, colSizes, this.colCount)
    this.updateSpacer()
  }

  private updateSpacer(): void {
    this.spacer.style.width = `${Math.ceil(this.colLayout.total * this.zoom + this.headerWidth)}px`
    this.spacer.style.height = `${Math.ceil(this.rowLayout.total * this.zoom + this.headerHeight)}px`
  }

  /** Adds rows and columns as the user scrolls or moves toward the end, like an endless sheet. */
  private maybeGrow(): void {
    const nearBottom = this.scroller.scrollTop + this.height * 2 > this.rowLayout.total * this.zoom
    const nearRight = this.scroller.scrollLeft + this.width * 2 > this.colLayout.total * this.zoom
    let grew = false
    if (nearBottom && this.rowCount < MAX_ROWS) {
      this.rowCount = Math.min(MAX_ROWS, this.rowCount + 1000)
      grew = true
    }
    if (nearRight && this.colCount < MAX_COLS) {
      this.colCount = Math.min(MAX_COLS, this.colCount + 26)
      grew = true
    }
    if (grew) this.rebuildLayout()
  }

  /** Makes sure the grid reaches a cell (navigation past the end). */
  ensureExtent(row: number, col: number): void {
    let grew = false
    if (row >= this.rowCount - 20 && this.rowCount < MAX_ROWS) {
      this.rowCount = Math.min(MAX_ROWS, Math.max(this.rowCount + 1000, row + 100))
      grew = true
    }
    if (col >= this.colCount - 5 && this.colCount < MAX_COLS) {
      this.colCount = Math.min(MAX_COLS, Math.max(this.colCount + 26, col + 10))
      grew = true
    }
    if (grew) this.rebuildLayout()
  }

  private onDocChange(events: Y.YEvent<Y.AbstractType<unknown>>[], transaction: Y.Transaction): void {
    this.valuesRevision++
    if (this.workbook.sheet(this.sheetIdValue)?.state !== 'visible') {
      this.cancelEdit()
      // Remote deletion or hiding must move the selection to a live visible sheet.
      this.sheetIdValue = this.workbook.sheets().find((sheet) => sheet.state === 'visible')?.id ?? this.workbook.sheetIds()[0] ?? ''
      this.selection = { ranges: [{ top: 0, left: 0, bottom: 0, right: 0 }], active: { row: 0, col: 0 }, anchor: { row: 0, col: 0 } }
      this.rebuildSheet()
    }
    const stylesXml = this.workbook.metaValue('stylesXml')
    const themeXml = this.workbook.metaValue('themeXml')
    if (stylesXml !== this.stylesXml || themeXml !== this.themeXml) {
      this.stylesXml = stylesXml
      this.stylesheet = new Stylesheet(stylesXml)
      this.themeXml = themeXml
      this.theme = readThemeColors(themeXml)
      this.rebuildSheet()
    }
    let layout = false
    let styles = false
    const sheetMap = this.sheet.map
    for (const event of events) {
      // Changes in other sheets only matter for formulas (values) and tabs.
      {
        const target = event.target as unknown
        if (target === this.sheet.rowMeta || target === this.sheet.colMeta || target === this.sheet.rows.order || target === this.sheet.cols.order || target === this.sheet.view || target === this.sheet.raw || target === sheetMap) layout = true
        if (target === this.sheet.xf || target === this.sheet.fmt || target === this.sheet.rowMeta || target === this.sheet.colMeta || target === this.sheet.rows.order || target === this.sheet.cols.order) styles = true
        if (target === this.sheet.view) this.zoom = (this.sheet.viewProp('zoom') ?? 100) / 100
        // Font size changes resize rows that fit their content.
        if (target === this.sheet.fmt && [...(event as Y.YMapEvent<unknown>).keysChanged].some((changed) => changed.endsWith('|fontSize'))) layout = true
      }
    }
    if (styles) this.display.invalidateStyles()
    if (layout) this.rebuildLayout()
    this.conditional.invalidate()
    // Remote edits may have deleted the rows under the selection.
    if (transaction.origin !== this.origin) this.clampSelection()
    if (this.editing) {
      const sheet = this.workbook.sheet(this.editing.sheetId)
      const row = sheet?.rows.indexOf(this.editing.rowId) ?? -1
      const col = sheet?.cols.indexOf(this.editing.colId) ?? -1
      if (row < 0 || col < 0) this.cancelEdit()
      else this.editing = { ...this.editing, row, col }
    }
    this.interactions.onDocChange()
    this.scheduleRender()
    this.notify()
  }

  private invalidateValues(): void {
    this.valuesRevision++
    this.conditional.invalidate()
    this.interactions.onDocChange()
    this.scheduleRender()
    this.notify()
  }

  /** Redraws everything (after undo, theme, or sheet changes). */
  invalidateAll(): void {
    this.rebuildSheet()
    this.scheduleRender()
    this.notify()
  }

  private clampSelection(): void {
    const clamp = (range: CellRange): CellRange => ({
      top: Math.min(range.top, MAX_ROWS - 1),
      left: Math.min(range.left, MAX_COLS - 1),
      bottom: Math.min(range.bottom, MAX_ROWS - 1),
      right: Math.min(range.right, MAX_COLS - 1),
    })
    this.selection = { ...this.selection, ranges: this.selection.ranges.map(clamp) }
  }

  resize(): void {
    const rect = this.root.getBoundingClientRect()
    this.width = Math.max(1, Math.floor(rect.width))
    this.height = Math.max(1, Math.floor(rect.height))
    this.dpr = window.devicePixelRatio || 1
    this.canvas.width = Math.round(this.width * this.dpr)
    this.canvas.height = Math.round(this.height * this.dpr)
    this.canvas.style.width = `${this.width}px`
    this.canvas.style.height = `${this.height}px`
    this.updateSpacer()
    this.renderNow()
  }

  scheduleRender(): void {
    if (this.frame || this.destroyed) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.renderNow()
    })
  }

  /** Builds the scene and draws it. */
  renderNow(): void {
    if (this.destroyed) return
    const scene = this.scene()
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    this.renderer.draw(scene)
    this.interactions.layoutOverlays(scene)
  }

  scene(): Scene {
    const sheet = this.sheet
    const merges = sheet.mergedRanges().map((merge) => merge.range)
    const filter = sheet.filter.get('value') as AutoFilter | undefined
    const filterRange = filter && sheet.resolveRange(filter.range)
    const notes = new Set<string>()
    for (const key of sheet.notes.keys()) {
      const position = sheet.position(key)
      if (position) notes.add(`${position.row},${position.col}`)
    }
    const editingRefs = this.editing ? formulaReferences(this.editing.text).filter((ref) => !ref.sheet || ref.sheet.toLowerCase() === sheet.name.toLowerCase()) : []
    const list = !this.editing && !this.readOnly ? commands.validationAt(sheet, this.selection.active.row, this.selection.active.col) : undefined
    const palette = this.options.appearance === 'dark' ? DARK_PALETTE : LIGHT_PALETTE
    return {
      width: this.width,
      height: this.height,
      zoom: this.zoom,
      headerWidth: this.headerWidth,
      headerHeight: this.headerHeight,
      rows: this.rowLayout,
      cols: this.colLayout,
      scrollX: this.scrollX,
      scrollY: this.scrollY,
      frozenRows: this.frozenRows,
      frozenCols: this.frozenCols,
      palette,
      showGridLines: sheet.viewProp('showGridLines') !== false,
      showHeadings: sheet.viewProp('showHeadings') !== false,
      cell: (row, col) => this.display.render(row, col),
      occupied: (row, col) => {
        const value = this.values.get(sheet, row, col)
        return value !== null && value !== ''
      },
      merges,
      selection: { ranges: this.selection.ranges, active: this.selection.active },
      remote: this.remoteSelections(),
      ...(this.editing ? { editing: { row: this.editing.row, col: this.editing.col } } : {}),
      notes,
      ...(filterRange && filter ? { filter: { range: filterRange, active: new Set(filter.columns.filter((column) => column.values || column.xml).map((column) => column.col)) } } : {}),
      ...(list?.type === 'list' && !list.showDropDown ? { listCell: this.selection.active } : {}),
      ...(this.copyRange ? { copyRange: this.copyRange } : {}),
      referenceHighlights: editingRefs.map((ref) => ({ range: ref.range, color: ref.color })),
      fontFamily: cssFontFamily,
      digitWidth: this.digitWidth,
      widthScale: this.widthScale,
      fillHandle: !this.readOnly && !this.editing && this.selection.ranges.length === 1,
    }
  }

  // ── Collaboration ────────────────────────────────────────────────────────

  private remoteSelections(): RemoteSelection[] {
    const awareness = this.options.awareness
    if (!awareness) return []
    const result: RemoteSelection[] = []
    for (const [client, state] of awareness.getStates()) {
      if (client === awareness.clientID) continue
      const selection = state.sheet as { sheet?: string; ranges?: { top: string; left: string; bottom: string; right: string }[]; active?: { row: string; col: string } } | null | undefined
      if (!selection || selection.sheet !== this.sheetIdValue || !selection.active) continue
      const user = state.user as { name?: string; color?: string } | undefined
      const row = this.sheet.rows.indexOf(selection.active.row)
      const col = this.sheet.cols.indexOf(selection.active.col)
      if (row < 0 || col < 0) continue
      const ranges = (selection.ranges ?? [])
        .map((range) => this.sheet.resolveRange(range))
        .filter((range): range is CellRange => !!range)
      result.push({ name: user?.name ?? '', color: user?.color ?? '#888888', ranges, active: { row, col } })
    }
    return result
  }

  /** Shares the selection by row and column ids, so it survives others inserting rows. */
  publishAwareness(): void {
    const awareness = this.options.awareness
    if (!awareness || this.destroyed) return
    const sheet = this.sheet
    const idRange = (range: CellRange) => ({
      top: sheet.rows.idAt(range.top),
      left: sheet.cols.idAt(Math.min(range.left, this.colCount)),
      bottom: sheet.rows.idAt(Math.min(range.bottom, this.rowCount)),
      right: sheet.cols.idAt(Math.min(range.right, this.colCount)),
    })
    awareness.setLocalStateField('sheet', {
      sheet: this.sheetIdValue,
      ranges: this.selection.ranges.slice(0, 20).map(idRange),
      active: { row: sheet.rows.idAt(this.selection.active.row), col: sheet.cols.idAt(this.selection.active.col) },
      ...(this.editing ? { editing: true } : {}),
    })
  }

  // ── State for toolbars ───────────────────────────────────────────────────

  notify(): void {
    if (this.notifyFrame || this.destroyed) return
    this.notifyFrame = requestAnimationFrame(() => {
      this.notifyFrame = 0
      for (const listener of this.listeners) listener()
    })
  }

  getState(): SheetViewState {
    const sheet = this.sheet
    const { active } = this.selection
    const last = this.selection.ranges[this.selection.ranges.length - 1]!
    const key = sheet.keyAt(active.row, active.col)
    const note = sheet.notes.get(key) as Note | undefined
    const link = sheet.linkAt(active.row, active.col)
    return {
      sheetId: this.sheetIdValue,
      sheets: this.workbook.sheets().map((entry) => {
        const color = cssColor(entry.tabColor, this.theme)
        return { id: entry.id, name: entry.name, state: entry.state, ...(color ? { color } : {}) }
      }),
      selection: this.selection,
      selectionLabel: this.selectionLabel(last),
      activeInput: this.inputText(active.row, active.col),
      activeStyle: this.display.style(active.row, active.col),
      ...(note ? { activeNote: note } : {}),
      ...(link ? { activeLink: link } : {}),
      ...(this.editing ? { editing: this.editing } : {}),
      canUndo: this.undoManager.canUndo(),
      canRedo: this.undoManager.canRedo(),
      zoom: this.zoom,
      frozen: { rows: this.frozenRows, cols: this.frozenCols },
      readOnly: this.readOnly,
      valuesOnly: this.valuesOnly,
      hasFilter: sheet.filter.has('value'),
      summary: this.summary(),
    }
  }

  private selectionLabel(range: CellRange): string {
    if (commands.isWholeColumns(range) && !commands.isWholeRows(range)) return rangeName(range).replace(/\d+/g, '')
    if (commands.isWholeRows(range) && !commands.isWholeColumns(range)) return `${range.top + 1}:${range.bottom + 1}`
    return rangeName(range)
  }

  /** The formula bar text of a cell: its formula, or its value as typed. */
  inputText(row: number, col: number): string {
    const sheet = this.sheet
    const data = sheet.cell(row, col)
    if (!data) return ''
    if (data.f !== undefined) return `=${toA1Form(data.f, sheet)}`
    if (data.raw !== undefined) return data.raw.replace(/^"(.*)"$/s, '$1').replace(/""/g, '"')
    if (data.t === 'e') return String(data.v)
    const value = data.v ?? null
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
    if (typeof value === 'number') {
      const style = this.display.style(row, col)
      // Dates and percentages edit the way Excel shows them in the formula bar.
      if (/%/.test(style.numFmt)) return `${Number((value * 100).toPrecision(15))}%`
      const formatted = this.display.render(row, col)
      if (/[dmyhs]/i.test(style.numFmt.replace(/"[^"]*"|\[[^\]]*\]/g, '')) && style.numFmt !== 'General') return formatted.text
      return String(Number(value.toPrecision(15)))
    }
    const text = String(value)
    // Text that would read as a number or formula keeps its apostrophe.
    return data.t === 's' || /^[=+-]/.test(text) || (text && !Number.isNaN(Number(text))) ? `'${text}` : text
  }

  private summary(): SheetSummary {
    let count = 0
    let numbers = 0
    let sum = 0
    let min: number | undefined
    let max: number | undefined
    let visited = 0
    const sheet = this.sheet
    for (const raw of this.selection.ranges) {
      const range = commands.clampToUsed(sheet, raw)
      for (let row = range.top; row <= range.bottom && visited < 200_000; row++) {
        if (this.rowLayout.isHidden(row)) continue
        for (let col = range.left; col <= range.right && visited < 200_000; col++) {
          visited++
          const value = this.values.get(sheet, row, col)
          if (value === null || value === '') continue
          count++
          if (typeof value === 'number') {
            numbers++
            sum += value
            min = min === undefined ? value : Math.min(min, value)
            max = max === undefined ? value : Math.max(max, value)
          }
        }
      }
    }
    return { count, numbers, sum, average: numbers ? sum / numbers : undefined, min, max }
  }

  // ── Navigation and selection ─────────────────────────────────────────────

  setActiveSheet(id: string): void {
    if (!this.workbook.sheet(id) || id === this.sheetIdValue) return
    if (!this.commitEdit()) return
    this.saveViewState()
    this.sheetIdValue = id
    this.copyRange = undefined
    this.selection = { ranges: [{ top: 0, left: 0, bottom: 0, right: 0 }], active: { row: 0, col: 0 }, anchor: { row: 0, col: 0 } }
    this.rebuildSheet()
    this.restoreViewState()
    this.publishAwareness()
    this.scheduleRender()
    this.notify()
  }

  private readonly viewStates = new Map<string, { selection: Selection; scrollLeft: number; scrollTop: number }>()

  private saveViewState(): void {
    this.viewStates.set(this.sheetIdValue, { selection: this.selection, scrollLeft: this.scroller.scrollLeft, scrollTop: this.scroller.scrollTop })
  }

  private restoreViewState(): void {
    const saved = this.viewStates.get(this.sheetIdValue)
    if (saved) {
      this.selection = saved.selection
      this.scroller.scrollLeft = saved.scrollLeft
      this.scroller.scrollTop = saved.scrollTop
      return
    }
    // The selection the file was saved with.
    const stored = this.sheet.viewProp('selection')
    const first = stored?.split(/\s+/)[0]
    const range = first ? parseRangeName(first) : undefined
    if (range) this.selection = { ranges: [range], active: { row: range.top, col: range.left }, anchor: { row: range.top, col: range.left } }
    // A selection on a merged cell covers the whole merge.
    const merges = this.sheet.mergedRanges().map((merge) => merge.range)
    this.selection = { ...this.selection, ranges: this.selection.ranges.map((entry) => commands.expandToMerges(entry, merges)) }
    this.scroller.scrollLeft = 0
    this.scroller.scrollTop = 0
  }

  /** Selects a range (or adds it with `add`); the active cell is its first corner unless given. */
  select(range: CellRange, options: { add?: boolean; active?: { row: number; col: number }; scroll?: boolean } = {}): void {
    const merges = this.sheet.mergedRanges().map((merge) => merge.range)
    const normalized = commands.expandToMerges(
      {
        top: Math.max(0, Math.min(range.top, range.bottom)),
        left: Math.max(0, Math.min(range.left, range.right)),
        bottom: Math.min(MAX_ROWS - 1, Math.max(range.top, range.bottom)),
        right: Math.min(MAX_COLS - 1, Math.max(range.left, range.right)),
      },
      merges,
    )
    const active = options.active ?? { row: range.top, col: range.left }
    this.ensureExtent(active.row, active.col)
    this.selection = {
      ranges: options.add ? [...this.selection.ranges, normalized] : [normalized],
      active,
      anchor: active,
    }
    if (options.scroll !== false) this.scrollIntoView(active.row, active.col)
    this.afterSelectionChange()
  }

  /** Moves the selection's far corner (Shift+arrows, Shift+click). */
  extendTo(row: number, col: number): void {
    const { anchor } = this.selection
    const range = { top: Math.min(anchor.row, row), left: Math.min(anchor.col, col), bottom: Math.max(anchor.row, row), right: Math.max(anchor.col, col) }
    const merges = this.sheet.mergedRanges().map((merge) => merge.range)
    const expanded = commands.expandToMerges(range, merges)
    this.ensureExtent(row, col)
    this.selection = { ranges: [...this.selection.ranges.slice(0, -1), expanded], active: this.selection.active, anchor }
    this.scrollIntoView(row, col)
    this.afterSelectionChange()
  }

  afterSelectionChange(): void {
    this.publishAwareness()
    this.interactions.onSelectionChange()
    this.scheduleRender()
    this.notify()
  }

  /** Goes to `A1`, `Sheet2!B3`, `C3:D9`, or a defined name (the name box). */
  goTo(reference: string): boolean {
    const text = reference.trim()
    let target = text
    let sheet: SheetModel | undefined = this.sheet
    const bang = text.lastIndexOf('!')
    if (bang > 0) {
      sheet = this.workbook.sheetByName(text.slice(0, bang).replace(/^'|'$/g, '').replace(/''/g, "'"))
      target = text.slice(bang + 1)
    }
    let range = sheet ? parseRangeName(target) : undefined
    if (!range) {
      // A name scoped to the active sheet takes precedence over a workbook name, as in Excel.
      const matches = [...this.workbook.names.values()].filter((entry) => entry.name.toLowerCase() === text.toLowerCase() && (!entry.scope || entry.scope === this.sheetIdValue))
      const name = matches.find((entry) => entry.scope === this.sheetIdValue) ?? matches.find((entry) => !entry.scope)
      if (name) {
        const formula = toA1Form(name.formula, name.scope ? this.workbook.sheet(name.scope) : undefined, this.workbook)
        const resolved = formula.lastIndexOf('!')
        if (resolved > 0) {
          sheet = this.workbook.sheetByName(formula.slice(0, resolved).replace(/^'|'$/g, '').replace(/''/g, "'"))
          range = parseRangeName(formula.slice(resolved + 1).replace(/\$/g, ''))
        }
      }
    }
    if (!sheet || !range) return false
    if (sheet.id !== this.sheetIdValue) this.setActiveSheet(sheet.id)
    this.select(range)
    return true
  }

  /** Scrolls so a cell is visible (frozen cells are always visible). */
  scrollIntoView(row: number, col: number): void {
    const frozenWidth = this.colLayout.offset(this.frozenCols)
    const frozenHeight = this.rowLayout.offset(this.frozenRows)
    const viewWidth = (this.width - this.headerWidth) / this.zoom - frozenWidth
    const viewHeight = (this.height - this.headerHeight) / this.zoom - frozenHeight
    if (col >= this.frozenCols) {
      const left = this.colLayout.offset(col) - frozenWidth
      const right = left + this.colLayout.size(col)
      if (left < this.scrollX) this.scroller.scrollLeft = left * this.zoom
      else if (right > this.scrollX + viewWidth) this.scroller.scrollLeft = (right - viewWidth) * this.zoom
    }
    if (row >= this.frozenRows) {
      const top = this.rowLayout.offset(row) - frozenHeight
      const bottom = top + this.rowLayout.size(row)
      if (top < this.scrollY) this.scroller.scrollTop = top * this.zoom
      else if (bottom > this.scrollY + viewHeight) this.scroller.scrollTop = (bottom - viewHeight) * this.zoom
    }
  }

  /** The cell under a point in root coordinates, or a header hit. */
  hitTest(x: number, y: number): { area: 'cell' | 'colHeader' | 'rowHeader' | 'corner'; row: number; col: number } {
    const headerWidth = this.headerWidth
    const headerHeight = this.headerHeight
    const frozenWidth = this.colLayout.offset(this.frozenCols) * this.zoom
    const frozenHeight = this.rowLayout.offset(this.frozenRows) * this.zoom
    const gx = x - headerWidth < frozenWidth ? (x - headerWidth) / this.zoom : (x - headerWidth) / this.zoom + this.scrollX
    const gy = y - headerHeight < frozenHeight ? (y - headerHeight) / this.zoom : (y - headerHeight) / this.zoom + this.scrollY
    const col = this.colLayout.indexAt(Math.max(0, gx))
    const row = this.rowLayout.indexAt(Math.max(0, gy))
    if (x < headerWidth && y < headerHeight) return { area: 'corner', row: 0, col: 0 }
    if (y < headerHeight) return { area: 'colHeader', row: 0, col }
    if (x < headerWidth) return { area: 'rowHeader', row, col: 0 }
    return { area: 'cell', row, col }
  }

  /** Screen rectangle of a cell (merged cells: the whole merge) in root coordinates. */
  cellRect(row: number, col: number): { x: number; y: number; width: number; height: number } {
    const merge = this.sheet.mergedRanges().find((entry) => rangeContains(entry.range, row, col))?.range
    const scene = { ...this.sceneGeometry() }
    const range = merge ?? { top: row, left: col, bottom: row, right: col }
    const x = GridRenderer.x(scene as Scene, range.left)
    const y = GridRenderer.y(scene as Scene, range.top)
    return {
      x,
      y,
      width: GridRenderer.x(scene as Scene, range.right) + this.colLayout.size(range.right) * this.zoom - x,
      height: GridRenderer.y(scene as Scene, range.bottom) + this.rowLayout.size(range.bottom) * this.zoom - y,
    }
  }

  sceneGeometry(): Pick<Scene, 'zoom' | 'headerWidth' | 'headerHeight' | 'rows' | 'cols' | 'scrollX' | 'scrollY' | 'frozenRows' | 'frozenCols'> {
    return {
      zoom: this.zoom,
      headerWidth: this.headerWidth,
      headerHeight: this.headerHeight,
      rows: this.rowLayout,
      cols: this.colLayout,
      scrollX: this.scrollX,
      scrollY: this.scrollY,
      frozenRows: this.frozenRows,
      frozenCols: this.frozenCols,
    }
  }

  /** The next cell in a direction, jumping to the edge of data with `jump` (Ctrl+arrow). */
  nextCell(row: number, col: number, dRow: number, dCol: number, jump: boolean): { row: number; col: number } {
    const step = (r: number, c: number) => ({
      row: dRow ? this.rowLayout.step(r, dRow > 0 ? 1 : -1) : r,
      col: dCol ? this.colLayout.step(c, dCol > 0 ? 1 : -1) : c,
    })
    if (!jump) {
      // Moving out of a merged cell skips the rest of it.
      const merge = this.sheet.mergedRanges().find((entry) => rangeContains(entry.range, row, col))?.range
      if (merge) {
        const from = { row: dRow > 0 ? merge.bottom : dRow < 0 ? merge.top : row, col: dCol > 0 ? merge.right : dCol < 0 ? merge.left : col }
        const next = step(from.row, from.col)
        return next.row === from.row && next.col === from.col ? { row, col } : next
      }
      return step(row, col)
    }
    const filled = (r: number, c: number) => {
      const value = this.values.get(this.sheet, r, c)
      return value !== null && value !== ''
    }
    const used = this.sheet.usedRange()
    // Past the last filled cell there is nothing to find: go to the edge of the sheet, as Excel does.
    const edge = { row: dRow > 0 ? MAX_ROWS - 1 : dRow < 0 ? 0 : row, col: dCol > 0 ? MAX_COLS - 1 : dCol < 0 ? 0 : col }
    let current = { row, col }
    let next = step(current.row, current.col)
    if (next.row === current.row && next.col === current.col) return current
    if (filled(current.row, current.col) && filled(next.row, next.col)) {
      // Inside a block: go to its last filled cell.
      while (filled(next.row, next.col)) {
        current = next
        next = step(current.row, current.col)
        if (next.row === current.row && next.col === current.col) break
      }
      return current
    }
    // Otherwise: the next filled cell.
    current = next
    while (!filled(current.row, current.col)) {
      if (!used || (dRow > 0 && current.row > used.bottom) || (dCol > 0 && current.col > used.right)) return edge
      next = step(current.row, current.col)
      if (next.row === current.row && next.col === current.col) return current
      current = next
    }
    return current
  }

  // ── Editing ──────────────────────────────────────────────────────────────

  /** Starts editing the active cell, with its current content or `text` (typing replaces). */
  beginEdit(text?: string, enterMode = text !== undefined): boolean {
    if (this.readOnly) return false
    const { row, col } = this.selection.active
    const merge = this.sheet.mergedRanges().find((entry) => rangeContains(entry.range, row, col))?.range
    const target = merge ? { row: merge.top, col: merge.left } : { row, col }
    const initial = text ?? this.inputText(target.row, target.col)
    this.editing = {
      ...target, text: initial, caret: initial.length, enterMode,
      sheetId: this.sheet.id,
      rowId: this.sheet.rows.idAt(target.row),
      colId: this.sheet.cols.idAt(target.col),
      // Capture without materializing axes: opening an edit must not write to the document.
      ranges: this.selection.ranges.map((range) => ({
        top: this.sheet.rows.idAt(range.top), bottom: this.sheet.rows.idAt(range.bottom),
        left: this.sheet.cols.idAt(range.left), right: this.sheet.cols.idAt(range.right),
      })),
    }
    this.pointing = undefined
    this.interactions.onEditStart()
    this.publishAwareness()
    this.scheduleRender()
    this.notify()
    return true
  }

  /** Updates the text being edited (from the cell editor or the formula bar). */
  setEditText(text: string, caret = text.length): void {
    if (!this.editing) return
    this.editing = { ...this.editing, text, caret }
    // Typing past a pointed reference ends pointing.
    if (this.pointing && (caret < this.pointing.start || caret > this.pointing.end)) this.pointing = undefined
    this.interactions.onEditText()
    this.scheduleRender()
    this.notify()
  }

  /** Commits the edit; returns false when validation rejected it (the edit stays open). */
  commitEdit(options: { fill?: boolean } = {}): boolean {
    if (this.readOnly) {
      this.cancelEdit()
      return true
    }
    const edit = this.editing
    if (!edit) return true
    const sheet = this.workbook.sheet(edit.sheetId)
    const row = sheet?.rows.indexOf(edit.rowId) ?? -1
    const col = sheet?.cols.indexOf(edit.colId) ?? -1
    if (!sheet || row < 0 || col < 0) {
      this.cancelEdit()
      return true
    }
    edit.row = row
    edit.col = col
    const validation = commands.validationAt(sheet, row, col)
    if (validation && validation.showErrorMessage !== false && validation.errorStyle !== 'warning' && validation.errorStyle !== 'information' && !this.passesValidation(validation, edit.text)) {
      this.interactions.showMessage(validation.error || this.labels.invalidValue, edit.row, edit.col)
      return false
    }
    this.editing = undefined
    this.pointing = undefined
    const options2 = { valuesOnly: this.valuesOnly, date1904: this.workbook.date1904, currentFormat: this.display.style(edit.row, edit.col).numFmt }
    if (options.fill) commands.fillInput(sheet, edit.ranges.map((range) => sheet.resolveRange(range)).filter((range): range is CellRange => !!range), { row, col }, edit.text, options2)
    else if (edit.text !== this.inputText(edit.row, edit.col)) commands.setCellInput(sheet, edit.row, edit.col, edit.text, options2)
    this.interactions.onEditEnd()
    this.publishAwareness()
    this.scheduleRender()
    this.notify()
    return true
  }

  /** Commits before serialization or teardown; rejected drafts are cancelled. */
  settleEdit(): boolean {
    if (this.commitEdit()) return true
    this.cancelEdit()
    return false
  }

  cancelEdit(): void {
    if (!this.editing) return
    this.editing = undefined
    this.pointing = undefined
    this.interactions.onEditEnd()
    this.publishAwareness()
    this.scheduleRender()
    this.notify()
  }

  private passesValidation(validation: ReturnType<typeof commands.validationAt> & object, text: string): boolean {
    if (text === '') return validation.allowBlank !== false
    if (validation.type === 'list') {
      const items = this.listItems(validation)
      return !items || items.some((item) => item.toLowerCase() === text.toLowerCase())
    }
    const parsed = commands.contentFromInput(this.sheet, text, { date1904: this.workbook.date1904 }).data?.v
    const bound = (formula: string | undefined) => {
      if (formula === undefined) return undefined
      const result = this.values.evaluate?.(this.sheet, this.editing?.row ?? 0, this.editing?.col ?? 0, toA1Form(formula, this.sheet, this.workbook, { followDeletedRelative: true }))
      const value = Array.isArray(result) ? result[0]?.[0] : result
      return typeof value === 'number' ? value : Number(toA1Form(formula, this.sheet, this.workbook, { followDeletedRelative: true }))
    }
    const number = validation.type === 'textLength' ? text.length : typeof parsed === 'number' ? parsed : NaN
    if (validation.type === 'custom') return true
    if (Number.isNaN(number)) return false
    if (validation.type === 'whole' && !Number.isInteger(number)) return false
    const a = bound(validation.formula1)
    const b = bound(validation.formula2)
    if (a === undefined || Number.isNaN(a)) return true
    switch (validation.operator ?? 'between') {
      case 'between':
        return b === undefined || (number >= Math.min(a, b) && number <= Math.max(a, b))
      case 'notBetween':
        return b === undefined || number < Math.min(a, b) || number > Math.max(a, b)
      case 'equal':
        return number === a
      case 'notEqual':
        return number !== a
      case 'greaterThan':
        return number > a
      case 'lessThan':
        return number < a
      case 'greaterThanOrEqual':
        return number >= a
      case 'lessThanOrEqual':
        return number <= a
    }
    return true
  }

  /** The choices of a list validation: literal items, or the values of its range. */
  listItems(validation: { formula1?: string }): string[] | undefined {
    const literal = commands.literalListItems(validation.formula1 && toA1Form(validation.formula1, this.sheet, this.workbook, { followDeletedRelative: true }))
    if (literal) return literal
    if (!validation.formula1) return undefined
    const formula = toA1Form(validation.formula1, this.sheet, this.workbook, { followDeletedRelative: true })
    const evaluated = this.values.evaluate?.(this.sheet, this.selection.active.row, this.selection.active.col, formula)
    if (Array.isArray(evaluated)) return evaluated.flat().filter((value) => value !== null && value !== '').map((value) => (isErrorValue(value) ? value.e : String(value)))
    // Without an engine: read a plain range reference directly.
    const bang = formula.lastIndexOf('!')
    const sheet = bang > 0 ? this.workbook.sheetByName(formula.slice(0, bang).replace(/^'|'$/g, '')) : this.sheet
    const range = parseRangeName(formula.slice(bang + 1).replace(/\$/g, ''))
    if (!sheet || !range) return undefined
    const items: string[] = []
    for (let row = range.top; row <= Math.min(range.bottom, range.top + 1000); row++) {
      for (let col = range.left; col <= range.right; col++) {
        const value = this.values.get(sheet, row, col)
        if (value !== null && value !== '') items.push(isErrorValue(value) ? value.e : String(value))
      }
    }
    return items
  }

  /** While editing a formula, clicking or arrowing inserts references. */
  pointAt(range: CellRange, sheet?: SheetModel): boolean {
    const edit = this.editing
    if (!edit || !edit.text.startsWith('=')) return false
    if (!this.pointing && !canInsertReference(edit.text, edit.caret)) return false
    const prefix = sheet && sheet.id !== this.workbook.sheet(this.sheetIdValue)?.id ? `${sheet.name}!` : undefined
    const result = insertReference(edit.text, edit.caret, range, prefix, this.pointing)
    const anchor = this.pointing?.anchor ?? { row: range.top, col: range.left }
    // The corner that moves is the one away from the anchor.
    const corner = { row: range.top === anchor.row ? range.bottom : range.top, col: range.left === anchor.col ? range.right : range.left }
    this.pointing = { ...result.inserted, anchor, corner }
    this.editing = { ...edit, text: result.text, caret: result.caret }
    this.interactions.onEditText()
    this.scheduleRender()
    this.notify()
    return true
  }

  // ── Commands for toolbars ────────────────────────────────────────────────

  /** Runs a model change as one undo step, unless read-only. */
  private run(change: () => void): void {
    if (this.readOnly) return
    if (!this.commitEdit()) return
    for (const sheet of this.workbook.sheets()) this.undoManager.addToScope([sheet.positionRows.order, sheet.positionRows.dead])
    change()
    this.scheduleRender()
    this.notify()
  }

  get targetRanges(): CellRange[] {
    return this.selection.ranges
  }

  setStyle(patch: commands.StylePatch): void {
    this.run(() => commands.applyStyle(this.sheet, this.targetRanges, patch))
  }

  /** Toggles a boolean style (bold, italic, strike, wrap) based on the active cell. */
  toggleStyle(prop: 'bold' | 'italic' | 'strike' | 'wrap'): void {
    const current = this.display.style(this.selection.active.row, this.selection.active.col)[prop]
    this.setStyle({ [prop]: !current })
  }

  toggleUnderline(): void {
    const current = this.display.style(this.selection.active.row, this.selection.active.col).underline
    this.setStyle({ underline: current ? null : 'single' })
  }

  setBorders(preset: commands.BorderPreset, style?: Parameters<typeof commands.applyBorders>[3], color?: SheetColor): void {
    this.run(() => commands.applyBorders(this.sheet, this.targetRanges, preset, style, color))
  }

  setNumberFormat(code: string): void {
    this.setStyle({ numFmt: code })
  }

  changeDecimals(delta: 1 | -1): void {
    const { row, col } = this.selection.active
    const code = commands.adjustDecimals(this.display.style(row, col).numFmt, delta, this.values.get(this.sheet, row, col))
    this.setStyle({ numFmt: code })
  }

  clearContents(): void {
    this.run(() => commands.clearContents(this.sheet, this.targetRanges))
  }

  clearFormats(): void {
    this.run(() => commands.clearFormats(this.sheet, this.targetRanges))
  }

  clearAll(): void {
    this.run(() =>
      this.workbook.transact(() => {
        commands.clearContents(this.sheet, this.targetRanges)
        commands.clearFormats(this.sheet, this.targetRanges)
      }),
    )
  }

  merge(mode: commands.MergeMode = 'all'): void {
    this.run(() => commands.mergeRanges(this.sheet, this.targetRanges, mode))
  }

  unmerge(): void {
    this.run(() => commands.unmergeRanges(this.sheet, this.targetRanges))
  }

  /** Inserts rows above/below or columns left/right of the selection, as many as selected. */
  insert(kind: 'row' | 'col', where: 'before' | 'after'): void {
    const range = this.selection.ranges[this.selection.ranges.length - 1]!
    const count = kind === 'row' ? Math.min(range.bottom - range.top + 1, 10_000) : Math.min(range.right - range.left + 1, 1000)
    const at = kind === 'row' ? (where === 'before' ? range.top : range.bottom + 1) : where === 'before' ? range.left : range.right + 1
    this.run(() => commands.insertLines(this.sheet, kind, at, count))
    if (where === 'after') {
      const shifted = kind === 'row' ? { ...range, top: at, bottom: at + count - 1 } : { ...range, left: at, right: at + count - 1 }
      this.select(shifted, { active: { row: shifted.top, col: shifted.left } })
    }
  }

  deleteLines(kind: 'row' | 'col'): void {
    const range = this.selection.ranges[this.selection.ranges.length - 1]!
    const at = kind === 'row' ? range.top : range.left
    const count = kind === 'row' ? Math.min(range.bottom, this.rowCount) - range.top + 1 : Math.min(range.right, this.colCount) - range.left + 1
    this.run(() => commands.deleteLines(this.sheet, kind, at, count))
  }

  /** Shifts cells (not whole rows) is not supported; inserting cells inserts whole rows/columns. */
  hideLines(kind: 'row' | 'col', hidden: boolean): void {
    const positions = this.selectedLines(kind)
    this.run(() => commands.setHidden(this.sheet, kind, positions, hidden))
  }

  selectedLines(kind: 'row' | 'col'): number[] {
    const positions = new Set<number>()
    for (const range of this.selection.ranges) {
      const [from, to] = kind === 'row' ? [range.top, Math.min(range.bottom, this.rowCount - 1)] : [range.left, Math.min(range.right, this.colCount - 1)]
      for (let index = from; index <= to; index++) positions.add(index)
    }
    return [...positions]
  }

  /** Sets row heights (pixels) or column widths (pixels) of the selected lines or `positions`. */
  resizeLines(kind: 'row' | 'col', pixels: number, positions = this.selectedLines(kind)): void {
    const size = kind === 'row' ? Math.max(0, pixels) / POINTS_TO_PIXELS : pixelsToColumnWidth(Math.max(0, pixels), this.digitWidth)
    this.run(() => commands.setSize(this.sheet, kind, positions, Math.round(size * 100) / 100))
  }

  /** Fits columns to their widest content, or rows to their tallest. */
  autoFit(kind: 'row' | 'col', positions = this.selectedLines(kind)): void {
    const used = this.sheet.usedRange()
    if (!used) return
    const sizes = new Map<number, number>()
    for (const position of positions) {
      let best = 0
      if (kind === 'col') {
        for (let row = used.top; row <= used.bottom; row++) {
          const render = this.display.render(row, position)
          if (!render.text) continue
          this.ctx.font = `${render.style.bold ? 'bold ' : ''}${render.style.italic ? 'italic ' : ''}${render.style.fontSize * POINTS_TO_PIXELS}px ${cssFontFamily(render.style.fontName)}`
          best = Math.max(best, this.ctx.measureText(render.text).width + 10)
        }
        if (best) sizes.set(position, Math.ceil(best))
      } else {
        for (let col = used.left; col <= used.right; col++) {
          const render = this.display.render(position, col)
          const lines = render.style.wrap ? Math.ceil((render.text.length * this.digitWidth) / Math.max(1, this.colLayout.size(col) - 6)) || 1 : render.text.split('\n').length
          best = Math.max(best, lines * render.style.fontSize * POINTS_TO_PIXELS * 1.25 + 4)
        }
        sizes.set(position, Math.max(Math.ceil(best), this.rowLayout.defaultSize))
      }
    }
    this.run(() =>
      this.workbook.transact(() => {
        for (const [position, pixels] of sizes) {
          const size = kind === 'row' ? pixels / POINTS_TO_PIXELS : pixelsToColumnWidth(pixels, this.digitWidth)
          commands.setSize(this.sheet, kind, [position], Math.round(size * 100) / 100)
        }
      }),
    )
  }

  /** Freezes rows above and columns left of the active cell, or the given counts. */
  freeze(rows?: number, cols?: number): void {
    const target = { rows: rows ?? this.selection.active.row, cols: cols ?? this.selection.active.col }
    this.scroller.scrollLeft = 0
    this.scroller.scrollTop = 0
    this.run(() => commands.setFrozen(this.sheet, target.rows, target.cols))
  }

  setZoom(zoom: number): void {
    const next = Math.min(4, Math.max(0.1, Math.round(zoom * 100) / 100))
    if (next === this.zoom) return
    // Keep the top-left cell in view while zooming.
    const ratio = next / this.zoom
    const left = this.scroller.scrollLeft * ratio
    const top = this.scroller.scrollTop * ratio
    this.zoom = next
    this.updateSpacer()
    this.scroller.scrollLeft = left
    this.scroller.scrollTop = top
    if (!this.readOnly) this.sheet.setViewProp('zoom', Math.round(next * 100) === 100 ? undefined : Math.round(next * 100))
    this.scheduleRender()
    this.notify()
  }

  sort(descending: boolean, column = this.selection.active.col, options: { header?: boolean; caseSensitive?: boolean } = {}): void {
    const range = this.selection.ranges[this.selection.ranges.length - 1]!
    const area = range.top === range.bottom && range.left === range.right ? this.currentRegion(range.top, range.left) : range
    const filter = this.sheet.filter.get('value') as AutoFilter | undefined
    const filterRange = filter && this.sheet.resolveRange(filter.range)
    const header = options.header ?? (filterRange?.top === area.top && filterRange.left <= area.right && filterRange.right >= area.left || area.bottom > area.top && this.looksLikeHeader(area))
    this.sortArea({ ...area, top: area.top + Number(header) }, [{ col: column, descending }], options)
  }

  /** Shared by toolbar sorts and the filter menu, including error reporting and safety guards. */
  sortArea(area: CellRange, keys: commands.SortKey[], options: { caseSensitive?: boolean } = {}): void {
    this.dataOperation(() => commands.sortRange(this.sheet, area, keys, (row, col) => this.values.get(this.sheet, row, col), {
      ...options, values: this.values, display: (r, c) => this.displayText(r, c),
    }))
  }

  dataOperation(change: () => void): void {
    try {
      this.run(change)
    } catch (error) {
      if (!(error instanceof commands.DataOperationError)) throw error
      this.interactions.showMessage(this.labels.dataErrors[error.reason], this.selection.active.row, this.selection.active.col)
    }
  }

  private looksLikeHeader(range: CellRange): boolean {
    let text = 0
    let below = 0
    for (let col = range.left; col <= range.right; col++) {
      if (typeof this.values.get(this.sheet, range.top, col) === 'string') text++
      if (typeof this.values.get(this.sheet, range.top + 1, col) === 'number') below++
    }
    return text > 0 && (below > 0 || this.styleAt(range.top, range.left).bold)
  }

  /** The block of filled cells around a cell (Ctrl+A, sort and filter on a single cell). */
  currentRegion(row: number, col: number): CellRange {
    const filled = (r: number, c: number) => r >= 0 && c >= 0 && this.values.get(this.sheet, r, c) !== null
    const range = { top: row, left: col, bottom: row, right: col }
    const anyFilled = (cells: Iterable<[number, number]>) => {
      for (const [r, c] of cells) if (filled(r, c)) return true
      return false
    }
    const rowCells = (r: number) => [...span(range.left - 1, range.right + 1)].map((c) => [r, c] as [number, number])
    const colCells = (c: number) => [...span(range.top - 1, range.bottom + 1)].map((r) => [r, c] as [number, number])
    // Grow while any cell bordering the block (diagonals included) is filled.
    for (let guard = 0; guard < 10_000; guard++) {
      if (anyFilled(rowCells(range.top - 1))) range.top--
      else if (anyFilled(rowCells(range.bottom + 1))) range.bottom++
      else if (anyFilled(colCells(range.left - 1))) range.left--
      else if (anyFilled(colCells(range.right + 1))) range.right++
      else break
    }
    return range
  }

  /** Turns the autofilter on for the selection (or the data around the active cell), or off. */
  toggleFilter(): void {
    if (this.sheet.filter.has('value')) {
      this.dataOperation(() => commands.setAutoFilter(this.sheet, undefined, (r, c) => this.displayText(r, c)))
      return
    }
    const range = this.selection.ranges[this.selection.ranges.length - 1]!
    const area = range.top === range.bottom && range.left === range.right ? this.currentRegion(range.top, range.left) : commands.clampToUsed(this.sheet, range)
    this.run(() => commands.setAutoFilter(this.sheet, area))
  }

  setNote(note: Note | undefined, row = this.selection.active.row, col = this.selection.active.col): void {
    this.run(() => commands.setNote(this.sheet, row, col, note && { ...note, author: note.author || this.options.user.name }))
  }

  setLink(link: Hyperlink | undefined): void {
    const { row, col } = this.selection.active
    this.run(() =>
      this.workbook.transact(() => {
        commands.setLink(this.sheet, row, col, link)
        if (link?.display && !this.sheet.cell(row, col)) this.sheet.setCell(row, col, { v: link.display })
      }),
    )
  }

  undo(): void {
    if (this.readOnly || !this.commitEdit()) return
    this.undoManager.undo()
  }

  redo(): void {
    if (this.readOnly || !this.commitEdit()) return
    this.undoManager.redo()
  }

  // ── Sheets ───────────────────────────────────────────────────────────────

  addSheet(): string | undefined {
    if (this.readOnly || !this.commitEdit()) return undefined
    const sheets = this.workbook.sheetIds()
    const sheet = this.workbook.addSheet(this.workbook.nextSheetName(), sheets.indexOf(this.sheetIdValue) + 1)
    this.setActiveSheet(sheet.id)
    return sheet.id
  }

  renameSheet(id: string, name: string): void {
    if (this.readOnly) return
    this.workbook.renameSheet(id, name)
    this.notify()
  }

  deleteSheet(id: string): void {
    if (this.readOnly || (id === this.sheetIdValue && !this.commitEdit())) return
    this.workbook.deleteSheet(id)
  }

  moveSheet(id: string, position: number): void {
    if (this.readOnly) return
    this.workbook.moveSheet(id, position)
    this.notify()
  }

  setSheetHidden(id: string, hidden: boolean): void {
    if (this.readOnly || (id === this.sheetIdValue && !this.commitEdit())) return
    this.workbook.setSheetState(id, hidden ? 'hidden' : 'visible')
    if (hidden && id === this.sheetIdValue) {
      const next = this.workbook.sheets().find((sheet) => sheet.state === 'visible')
      if (next) this.setActiveSheet(next.id)
    }
    this.notify()
  }

  setTabColor(id: string, color: SheetColor | undefined): void {
    if (this.readOnly) return
    this.workbook.setTabColor(id, color)
    this.notify()
  }

  /** Copies a sheet (cells, formats, merges, rules, view) after itself. */
  duplicateSheet(id: string): string | undefined {
    if (this.readOnly || !this.commitEdit()) return undefined
    const source = this.workbook.sheet(id)
    if (!source) return undefined
    let copyId = ''
    this.workbook.transact(() => {
      const copy = this.workbook.addSheet(this.workbook.uniqueSheetName(source.name), this.workbook.sheetIds().indexOf(id) + 1)
      copyId = copy.id
      // Same row and column ids, so cell keys and id-form formulas carry over unchanged.
      copy.rows.order.delete(0, copy.rows.order.length)
      copy.rows.order.push(source.rows.resolve().ids.slice())
      copy.cols.order.delete(0, copy.cols.order.length)
      copy.cols.order.push(source.cols.resolve().ids.slice())
      // Deleted ids stay deleted in the copy, so virtual rows past the end line up too.
      for (const [id, index] of source.rows.dead) copy.rows.dead.set(id, index)
      for (const [id, index] of source.cols.dead) copy.cols.dead.set(id, index)
      this.undoManager?.addToScope([copy.positionRows.order, copy.positionRows.dead])
      if (source.positionRows.order.length) copy.positionRows.seed(source.positionRows.resolve().ids)
      for (const [id, dead] of source.positionRows.dead) copy.positionRows.dead.set(id, dead)
      for (const name of ['cells', 'xf', 'fmt', 'rowMeta', 'colMeta', 'view', 'merges', 'cf', 'dv', 'links', 'notes'] as const) {
        const from = source.map.get(name) as Y.Map<unknown>
        const to = copy.map.get(name) as Y.Map<unknown>
        for (const [key, value] of from) {
          if (name === 'cells') {
            const data = source.cellData(key)!
            to.set(key, data.f !== undefined ? { ...data, f: toIdForm(toA1Form(data.f, source), copy) } : data)
          } else to.set(key, value)
        }
      }
      for (const [key, value] of source.raw) if (/^(rowPosition:|positionRowSource:)/.test(key)) copy.raw.set(key, value)
      for (const key of ['format', 'colTail']) if (source.raw.has(key)) copy.raw.set(key, source.raw.get(key))
      if (source.tabColor) copy.map.set('tabColor', source.tabColor)
    })
    this.setActiveSheet(copyId)
    return copyId
  }

  /** The text of the selection for the clipboard and its HTML, and snapshots for pasting here. */
  get clipboard(): SheetInteractions {
    return this.interactions
  }

  /** Inserts an image over the active cell. */
  async insertImage(bytes: Uint8Array, mimeType: string, size: { width: number; height: number }): Promise<void> {
    if (this.readOnly) return
    const ref = await this.options.assets.put(bytes, mimeType)
    if (this.readOnly || this.destroyed) return
    const { row, col } = this.selection.active
    const sheet = this.sheet
    const maxWidth = Math.min(size.width, 640)
    const scale = maxWidth / size.width
    this.workbook.transact(() => {
      sheet.ensure(row, col)
      const z = Math.max(0, maxOf([...sheet.drawings.values()].map((drawing) => (drawing as DrawingObject).z))) + 1
      const drawing: DrawingObject = {
        kind: 'image',
        anchor: 'oneCell',
        from: { row: sheet.rows.idAt(row), col: sheet.cols.idAt(col), rowOff: 0, colOff: 0 },
        ext: { cx: Math.round(size.width * scale * EMU_PER_PIXEL), cy: Math.round(size.height * scale * EMU_PER_PIXEL) },
        xml: '',
        image: { hash: ref.hash, mimeType },
        name: `Picture ${z}`,
        z,
      }
      sheet.drawings.set(Math.random().toString(36).slice(2, 10), drawing)
    })
  }

  // ── Find and replace ─────────────────────────────────────────────────────

  /** Cells whose shown text (or formula, with `formulas`) matches, in row order. */
  find(query: string, options: FindOptions = {}): { sheetId: string; row: number; col: number }[] {
    if (!query) return []
    const matches: { sheetId: string; row: number; col: number }[] = []
    const needle = options.matchCase ? query : query.toLowerCase()
    const sheets = options.allSheets ? this.workbook.sheets().filter((sheet) => (sheet.map.get('kind') ?? 'worksheet') === 'worksheet') : [this.sheet]
    for (const sheet of sheets) {
      const found: { row: number; col: number }[] = []
      for (const [key, raw] of sheet.cells) {
        const data = sheet.cellData(key) ?? raw
        const position = sheet.position(key)
        if (!position) continue
        let text: string
        if (options.formulas && data.f !== undefined) text = `=${toA1Form(data.f, sheet)}`
        else if (sheet.id === this.sheetIdValue) text = this.display.render(position.row, position.col).text
        else text = String(data.v ?? '')
        const haystack = options.matchCase ? text : text.toLowerCase()
        if (options.entireCell ? haystack === needle : haystack.includes(needle)) found.push(position)
      }
      found.sort((a, b) => a.row - b.row || a.col - b.col)
      for (const position of found) matches.push({ sheetId: sheet.id, ...position })
    }
    return matches
  }

  /** Replaces matches in what was typed (values and formulas); returns how many cells changed. */
  replace(query: string, replacement: string, options: FindOptions = {}, only?: { sheetId: string; row: number; col: number }): number {
    if (!query || this.readOnly) return 0
    const targets = only ? [only] : this.find(query, { ...options, formulas: true })
    const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options.matchCase ? 'g' : 'gi')
    let changed = 0
    if (!this.commitEdit()) return 0
    this.workbook.transact(() => {
      for (const target of targets) {
        const sheet = this.workbook.sheet(target.sheetId)
        if (!sheet) continue
        const data = sheet.cell(target.row, target.col)
        if (!data) continue
        const input = data.f !== undefined ? `=${toA1Form(data.f, sheet)}` : String(data.v ?? '')
        const next = options.entireCell ? (input.toLowerCase() === query.toLowerCase() || (options.matchCase && input === query) ? replacement : input) : input.replace(pattern, () => replacement)
        if (next === input) continue
        commands.setCellInput(sheet, target.row, target.col, next, { valuesOnly: this.valuesOnly, date1904: this.workbook.date1904 })
        changed++
      }
    })
    this.notify()
    return changed
  }

  // ── Printing ─────────────────────────────────────────────────────────────

  /** The used part of the sheet as a self-contained HTML table, for printing and PDF export. */
  printHtml(): string {
    this.settleEdit()
    const sheet = this.sheet
    const found = sheet.usedRange()
    // Prints are capped (a stray cell at XFD1048576 must not make a billion-cell table).
    const right = Math.min(found?.right ?? 0, 255)
    const used = found && { ...found, bottom: Math.min(found.bottom, 20_000, Math.floor(MAX_EXPANDED_CELLS / (right + 1)) - 1), right }
    const escape = (text: string) => text.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!)
    if (!used) return `<!doctype html><title>${escape(sheet.name)}</title><p></p>`
    const merges = sheet.mergedRanges().map(({ range }) => ({ ...range, bottom: Math.min(range.bottom, used.bottom), right: Math.min(range.right, used.right) })).filter((range) => range.top <= range.bottom && range.left <= range.right)
    const border = (edge: { style: string; color: string } | undefined) => (edge && printColor(edge.color) ? `${edge.style === 'thick' ? 3 : edge.style.startsWith('medium') ? 2 : 1}px ${edge.style === 'double' ? 'double' : /dash|dot|hair/i.test(edge.style) ? 'dashed' : 'solid'} ${edge.color}` : '')
    let colgroup = '<colgroup>'
    for (let col = 0; col <= used.right; col++) colgroup += `<col style="width:${this.colLayout.size(col)}px">`
    colgroup += '</colgroup>'
    let body = ''
    for (let row = 0; row <= used.bottom; row++) {
      if (this.rowLayout.isHidden(row)) continue
      body += `<tr style="height:${this.rowLayout.size(row)}px">`
      for (let col = 0; col <= used.right; col++) {
        if (merges.some((range) => rangeContains(range, row, col) && (row !== range.top || col !== range.left)) || this.colLayout.isHidden(col)) continue
        const merge = merges.find((entry) => entry.top === row && entry.left === col)
        const render = this.display.render(row, col)
        const style = render.style
        const css = [
          `font-family:${cssFontFamily(style.fontName)}`,
          Number.isFinite(style.fontSize) ? `font-size:${style.fontSize}pt` : '',
          style.bold ? 'font-weight:bold' : '',
          style.italic ? 'font-style:italic' : '',
          style.underline || style.strike ? `text-decoration:${style.underline ? 'underline' : ''} ${style.strike ? 'line-through' : ''}` : '',
          printColor(render.color) ? `color:${printColor(render.color)}` : '',
          printColor(render.fill) ? `background:${printColor(render.fill)}` : '',
          `text-align:${render.hAlign === 'centerContinuous' ? 'center' : ['left', 'right', 'center', 'justify'].includes(render.hAlign) ? render.hAlign : 'left'}`,
          `vertical-align:${style.vAlign === 'center' ? 'middle' : style.vAlign === 'top' ? 'top' : 'bottom'}`,
          style.wrap ? 'white-space:pre-wrap' : 'white-space:pre',
          render.borders.top ? `border-top:${border(render.borders.top)}` : '',
          render.borders.bottom ? `border-bottom:${border(render.borders.bottom)}` : '',
          render.borders.left ? `border-left:${border(render.borders.left)}` : '',
          render.borders.right ? `border-right:${border(render.borders.right)}` : '',
        ].filter(Boolean).join(';')
        const span = merge ? ` rowspan="${merge.bottom - merge.top + 1}" colspan="${merge.right - merge.left + 1}"` : ''
        body += `<td${span} style="${escape(css)}">${escape(render.text)}</td>`
      }
      body += '</tr>'
    }
    const gridlines = sheet.viewProp('showGridLines') === false ? '' : 'td{outline:0.5px solid #d9d9d9}'
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(sheet.name)}</title><style>@page{margin:0.7in 0.7in 0.75in}body{margin:0}table{border-collapse:collapse;table-layout:fixed}td{padding:0 3px;overflow:hidden}${gridlines}</style></head><body><table>${colgroup}${body}</table></body></html>`
  }

  /** A chart part as SVG: the host's renderer, else the built-in one. */
  renderChart(xml: string, size: { width: number; height: number }, resolve: (formula: string) => CellValue[][] | undefined): string | undefined {
    if (this.options.renderChart) return this.options.renderChart(xml, size, this.theme, resolve)
    const model = parseChart(xml)
    return renderChartSvg(model, {
      ...size,
      theme: this.theme.theme,
      resolveRange: (formula) => resolve(formula)?.map((row) => row.map((value) => (isErrorValue(value) ? (errorFromCode(value.e) ?? null) : value))),
      formatNumber: (value, code) => formatValue(value, code, { date1904: this.workbook.date1904 }).text,
      idPrefix: `chart${Math.random().toString(36).slice(2, 8)}`,
    })
  }

  focus(): void {
    this.input.focus({ preventScroll: true })
  }
}

function* span(from: number, to: number): Generator<number> {
  for (let index = from; index <= to; index++) yield index
}

export { cellName, parseCellName }
export type { StyleProps }
