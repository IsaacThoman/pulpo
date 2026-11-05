/**
 * The Y.Doc layout of a spreadsheet (see docs/sheets.md for the reasoning).
 *
 * ```
 * doc.getMap('workbook')
 *   meta      Y.Map   format, date1904, activeSheet, calc settings, preserved workbook XML, styles, theme
 *   order     Y.Array sheet ids in tab order
 *   sheets    Y.Map   sheet id → Y.Map (below)
 *   names     Y.Map   name id → DefinedName
 *   parts     Y.Map   package path → PreservedPart (bytes in the asset store)
 *
 * sheet Y.Map
 *   name, state, tabColor              plain values
 *   rows, cols                         Y.Array axis order (see axis.ts)
 *   deadRows, deadCols                 Y.Map tombstones
 *   cells     Y.Map  "row:col"         → CellData (content: value, formula, rich text)
 *   xf        Y.Map  "row:col"         → base style index into the stylesheet
 *   fmt       Y.Map  "row:col|prop"    → one style override (StyleProps key), null = explicitly off
 *   rowMeta   Y.Map  "row|prop"        → one row property (AxisProps key)
 *   colMeta   Y.Map  "col|prop"        → one column property
 *   view      Y.Map  ViewProps keys
 *   merges, cf, dv, tables, drawings   Y.Map id → object with id-anchored ranges
 *   links, notes                       Y.Map "row:col" → Hyperlink / Note
 *   filter    Y.Map  the autofilter (key 'value')
 *   raw       Y.Map  preserved XML of the sheet, its relationships, and its parts
 * ```
 *
 * Cell contents, each style property, and each row/column property are separate map entries, so
 * two people editing the value and the format of a cell, or applying bold and a fill to the same
 * range, both keep their change.
 */

export { SHEETS_SCHEMA_VERSION } from '../layout.js'

/** What a tab is. Only worksheets are modeled; other sheet kinds are kept as parts. */
export type SheetKind = 'worksheet' | 'chartsheet' | 'dialogsheet' | 'macrosheet'

export type SheetFormat = 'xlsx' | 'xlsm' | 'xltx' | 'xltm' | 'csv' | 'tsv'

/** A color as SpreadsheetML writes it. Exactly one of rgb/theme/indexed/auto is set. */
export interface SheetColor {
  /** `RRGGBB` or `AARRGGBB` hex. */
  rgb?: string
  theme?: number
  indexed?: number
  auto?: boolean
  tint?: number
}

/** A run of rich text in a cell. `font` holds the run's properties; `rPr` the original XML when unmodeled parts exist. */
export interface RichRun {
  text: string
  font?: Partial<Pick<StyleProps, 'fontName' | 'fontSize' | 'bold' | 'italic' | 'underline' | 'strike' | 'fontColor'>> & { vertAlign?: 'superscript' | 'subscript' }
  /** The run's `<rPr>` XML as read, written back unchanged unless `font` was edited. */
  rPr?: string
}

export type CellScalar = number | string | boolean | null

/**
 * What a cell holds. Formulas are stored in id form (see formula-ids.ts): references name rows,
 * columns, and sheets by id, so structural edits never rewrite them.
 */
export interface CellData {
  /** The value, or the cached result of a formula. Errors are their code with `t: 'e'`. */
  v?: CellScalar
  /** `e`: v is an error code. `s`: v is a string that looks like something else (keep as text). */
  t?: 'e' | 's'
  /** Formula in id form, without `=`. */
  f?: string
  /** Legacy (Ctrl+Shift+Enter) array formula covering this many rows and columns from this cell. */
  array?: { rows: number; cols: number }
  /** A dynamic-array formula (spills). */
  dynamic?: true
  /**
   * The values an array formula last produced, as read from the file (rows of values; errors as
   * `{ e: code }`). Shown for formulas the engine can't calculate, and written back for them.
   */
  spillCache?: (CellScalar | { e: string })[][]
  /** Rich text runs (v is then their concatenated text). */
  runs?: RichRun[]
  /**
   * Attributes and children of `<c>`/`<f>` we don't model, kept as read: e.g. `cm`, `vm`, `ph`,
   * data-table formula attributes (`f.t="dataTable"`, `r1`, `dt2D`, …), or a cell's `extLst`.
   */
  keep?: {
    c?: Record<string, string>
    f?: Record<string, string>
    fText?: string
    extra?: string
    /** A number's text when it doesn't fit a double (`1.8e308`, kept as ±Number.MAX_VALUE). */
    v?: string
    /**
     * A formula's text as written (`'Last'!B1`) when it differs from how it would be written now
     * (`Last!B1`, `fc`). It's written back while the formula still reads `fc`.
     */
    fa?: string
    fc?: string
  }
  /** The exact text a CSV/TSV field had, written back while the cell is unchanged ("007", "1.50"). */
  raw?: string
  /** Phonetic text (`rPh`/`phoneticPr`) of an inline or shared string, kept as XML. */
  phonetic?: string
}

export type HorizontalAlign = 'general' | 'left' | 'center' | 'right' | 'fill' | 'justify' | 'centerContinuous' | 'distributed'
export type VerticalAlign = 'top' | 'center' | 'bottom' | 'justify' | 'distributed'
export type UnderlineStyle = 'single' | 'double' | 'singleAccounting' | 'doubleAccounting'
export type BorderStyle =
  | 'thin'
  | 'medium'
  | 'thick'
  | 'dashed'
  | 'dotted'
  | 'double'
  | 'hair'
  | 'mediumDashed'
  | 'dashDot'
  | 'mediumDashDot'
  | 'dashDotDot'
  | 'mediumDashDotDot'
  | 'slantDashDot'

export interface BorderEdge {
  style: BorderStyle
  color?: SheetColor
}

/**
 * The style properties people edit. A cell's style is its base style (an index into the
 * workbook's stylesheet, as read from the file) with these overrides on top.
 */
export interface StyleProps {
  fontName: string
  fontSize: number
  bold: boolean
  italic: boolean
  underline: UnderlineStyle | null
  strike: boolean
  fontColor: SheetColor | null
  /** Solid fill color; null removes the fill. */
  fill: SheetColor | null
  borderTop: BorderEdge | null
  borderBottom: BorderEdge | null
  borderLeft: BorderEdge | null
  borderRight: BorderEdge | null
  hAlign: HorizontalAlign
  vAlign: VerticalAlign
  wrap: boolean
  /** Degrees: 0–90 counterclockwise, 91–180 clockwise (Excel's encoding), 255 for stacked text. */
  rotation: number
  indent: number
  shrink: boolean
  numFmt: string
  locked: boolean
  hidden: boolean
}

export type StyleProp = keyof StyleProps
export const STYLE_PROPS: readonly StyleProp[] = [
  'fontName',
  'fontSize',
  'bold',
  'italic',
  'underline',
  'strike',
  'fontColor',
  'fill',
  'borderTop',
  'borderBottom',
  'borderLeft',
  'borderRight',
  'hAlign',
  'vAlign',
  'wrap',
  'rotation',
  'indent',
  'shrink',
  'numFmt',
  'locked',
  'hidden',
]

/** Per-row or per-column properties. */
export interface AxisProps {
  /** Row height in points, or column width in Excel character units. */
  size: number
  /** The size was set by hand (customHeight / customWidth). */
  custom: boolean
  hidden: boolean
  /** Outline (group) level, 0–7. */
  level: number
  collapsed: boolean
  /** Style index applied to the whole row or column. */
  xf: number
  /** Attributes of `<row>`/`<col>` we don't model, kept as read. */
  keep: Record<string, string>
}
export type AxisProp = keyof AxisProps

export interface ViewProps {
  /** Rows and columns frozen at the top and left. */
  frozenRows: number
  frozenCols: number
  /** Percent, 10–400. */
  zoom: number
  showGridLines: boolean
  showHeadings: boolean
  showZeros: boolean
  rightToLeft: boolean
  /** Top-left visible cell (ids) and the selection, as last saved. */
  topLeft: CellIds | null
  selection: string | null
}

/** A cell position by ids. */
export interface CellIds {
  row: string
  col: string
}

/**
 * A rectangle by ids. A missing side is unbounded (whole columns have no rows, whole rows no
 * columns). Rows or columns inserted strictly inside grow the range; deleting an edge row
 * moves the edge to its neighbor (see WorkbookModel.deleteRows).
 */
export interface RangeIds {
  top?: string
  left?: string
  bottom?: string
  right?: string
}

export interface Merge {
  range: RangeIds
}

export interface Hyperlink {
  /** External URL or file (`http://…`, `mailto:`). Never fetched automatically. */
  target?: string
  /** In-workbook location (`Sheet2!A1`, a defined name). */
  location?: string
  tooltip?: string
  display?: string
  /** Covered range when the link spans more than one cell. */
  range?: RangeIds
}

export interface Note {
  author: string
  text: string
  /** Rich runs of the note text, when it has formatting. */
  runs?: RichRun[]
  /** The note's VML shape as read (size, position, visibility), reused on export. */
  shape?: string
  /** `<comment>` attributes we don't model (`shapeId`, `guid`, …). */
  keep?: Record<string, string>
  visible?: boolean
}

export type ConditionalRuleType =
  | 'cellIs'
  | 'expression'
  | 'colorScale'
  | 'dataBar'
  | 'iconSet'
  | 'top10'
  | 'aboveAverage'
  | 'duplicateValues'
  | 'uniqueValues'
  | 'containsText'
  | 'notContainsText'
  | 'beginsWith'
  | 'endsWith'
  | 'containsBlanks'
  | 'notContainsBlanks'
  | 'containsErrors'
  | 'notContainsErrors'
  | 'timePeriod'

/** A conditional-format value object (`cfvo`) for color scales, data bars, and icon sets. */
export interface CfValue {
  type: 'num' | 'percent' | 'max' | 'min' | 'formula' | 'percentile' | 'autoMin' | 'autoMax'
  /** Number or formula (id form for formulas). */
  value?: string
  gte?: boolean
}

export interface ConditionalRule {
  type: ConditionalRuleType
  priority: number
  stopIfTrue?: boolean
  /** cellIs operator: between, notBetween, equal, notEqual, greaterThan, lessThan, greaterThanOrEqual, lessThanOrEqual. */
  operator?: string
  /** Formulas in id form (relative to the range's top-left cell). */
  formulas?: string[]
  /** Differential format index into the stylesheet's dxfs. */
  dxfId?: number
  text?: string
  timePeriod?: string
  rank?: number
  percent?: boolean
  bottom?: boolean
  aboveAverage?: boolean
  equalAverage?: boolean
  stdDev?: number
  colorScale?: { values: CfValue[]; colors: SheetColor[] }
  dataBar?: { values: CfValue[]; color: SheetColor; showValue?: boolean; minLength?: number; maxLength?: number }
  iconSet?: { set: string; values: CfValue[]; reverse?: boolean; showValue?: boolean }
  /** The rule's XML as read; written back unchanged unless the rule was edited. */
  xml?: string
}

export interface ConditionalFormat {
  ranges: RangeIds[]
  rules: ConditionalRule[]
  /** `pivot` and other `<conditionalFormatting>` attributes. */
  keep?: Record<string, string>
  /** Set when edited, so export rebuilds the rules from the model instead of `xml`. */
  edited?: boolean
}

export interface DataValidation {
  ranges: RangeIds[]
  type: 'none' | 'whole' | 'decimal' | 'list' | 'date' | 'time' | 'textLength' | 'custom'
  operator?: string
  /** Formulas in id form. For lists, either a quoted comma list (`"a,b,c"`) or a reference. */
  formula1?: string
  formula2?: string
  allowBlank?: boolean
  showDropDown?: boolean
  showInputMessage?: boolean
  showErrorMessage?: boolean
  errorStyle?: 'stop' | 'warning' | 'information'
  errorTitle?: string
  error?: string
  promptTitle?: string
  prompt?: string
  /** `<dataValidation>` attributes we don't model. */
  keep?: Record<string, string>
}

export interface TableColumn {
  name: string
  /** `<tableColumn>` XML as read (totals function, calculated column formula, …). */
  xml?: string
}

export interface SheetTable {
  name: string
  displayName: string
  range: RangeIds
  headerRow: boolean
  totalsRow: boolean
  columns: TableColumn[]
  /** The table part path as read. */
  part?: string
  /** The table part XML as read; columns, ref, and autofilter ref are patched on export. */
  xml?: string
}

export interface FilterColumn {
  /** Column offset within the filter range. */
  col: number
  /** Values shown (others hidden), as displayed text. Empty string stands for blanks. */
  values?: string[]
  /** The `<filterColumn>` XML as read, for custom/top10/dynamic/color filters we don't edit. */
  xml?: string
}

export interface AutoFilter {
  range: RangeIds
  columns: FilterColumn[]
  sort?: { col: string; descending: boolean }[]
  /** The `<autoFilter>`/`<sortState>` XML as read. */
  xml?: string
  sortXml?: string
}

/** A position of a drawing anchor corner: the cell by ids plus an offset in EMUs. */
export interface AnchorPoint {
  row: string
  col: string
  rowOff: number
  colOff: number
}

export type DrawingKind = 'image' | 'chart' | 'shape' | 'group' | 'other'

export interface DrawingObject {
  kind: DrawingKind
  /** twoCell: both corners follow cells; oneCell: `to` is an extent; absolute: fixed position. */
  anchor: 'twoCell' | 'oneCell' | 'absolute'
  from?: AnchorPoint
  to?: AnchorPoint
  /** Size in EMUs for oneCell/absolute anchors; position for absolute ones. */
  ext?: { cx: number; cy: number }
  pos?: { x: number; y: number }
  /** `editAs` and other anchor attributes. */
  keep?: Record<string, string>
  /** The object XML inside the anchor (`xdr:pic`, `xdr:graphicFrame`, …) as read. */
  xml: string
  /** Relationship id → package path of what it links (images, charts), for rendering. */
  links?: Record<string, string>
  name?: string
  /** Image bytes for rendering. */
  image?: { hash: string; mimeType: string }
  /** Chart part path, rendered from the preserved part. */
  chart?: string
  /** Display order (z-order). */
  z: number
  /** Kept exactly as read (anchors wrapped in mc:AlternateContent); doesn't follow cells. */
  verbatim?: boolean
}

export interface DefinedName {
  name: string
  /** Formula in id form, without `=`. */
  formula: string
  /** Sheet id for sheet-scoped names. */
  scope?: string
  hidden?: boolean
  comment?: string
  /** Other attributes (`function`, `xlm`, `vbProcedure`, …), kept as read. */
  keep?: Record<string, string>
}

/** A package part kept as bytes in the asset store. */
export interface PreservedPart {
  hash: string
  contentType?: string
  sizeBytes: number
}

/** CSV/TSV dialect, so a saved file looks like the one opened. */
export interface CsvDialect {
  delimiter: string
  quote: string
  lineEnding: '\r\n' | '\n' | '\r'
  encoding: 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252'
  bom: boolean
  /** The file ended with a line ending. */
  trailingNewline: boolean
  /** Fields that were quoted though they did not need it ("always" when every field was). */
  quoting: 'minimal' | 'always'
}

export interface WorkbookMeta {
  format: SheetFormat
  date1904: boolean
  activeSheet: string
  /** calcPr attributes we model. */
  iterate: boolean
  iterateCount: number
  iterateDelta: number
  csv?: CsvDialect
  /** Preserved XML parts the export patches: workbook.xml, styles.xml, theme, and others. */
  workbookXml?: string
  workbookRels?: string
  stylesXml?: string
  themeXml?: string
  contentTypesXml?: string
  rootRels?: string
  /** Paths of the parts above in the package as read. */
  workbookPath?: string
  stylesPath?: string
  themePath?: string
  sharedStringsPath?: string
  /** Parts no relationship referred to in the file as read, kept anyway. */
  looseParts?: string[]
  /** The original shared strings, kept when preserved macro sheets index into them. */
  sharedStringsSeed?: string
}
