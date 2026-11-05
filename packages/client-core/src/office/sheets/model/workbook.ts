import * as Y from 'yjs'
import type { CellRange } from '../address.js'
import { MAX_COLS, MAX_ROWS } from '../address.js'
import { Axis, randomId, type Tombstone } from './axis.js'
import { WORKBOOK_MAP } from '../layout.js'
import {
  SHEETS_SCHEMA_VERSION,
  STYLE_PROPS,
  type AxisProp,
  type AxisProps,
  type CellData,
  type CellIds,
  type DefinedName,
  type PreservedPart,
  type RangeIds,
  type SheetColor,
  type StyleProp,
  type StyleProps,
  type ViewProps,
  type WorkbookMeta,
} from './schema.js'

export type SheetState = 'visible' | 'hidden' | 'veryHidden'

export function cellKey(row: string, col: string): string {
  return `${row}:${col}`
}

export function splitCellKey(key: string): CellIds {
  const colon = key.indexOf(':')
  return { row: key.slice(0, colon), col: key.slice(colon + 1) }
}

/** Splits `"<owner>|<prop>"` keys of the fmt/rowMeta/colMeta maps. */
function splitPropKey(key: string): [owner: string, prop: string] {
  const bar = key.lastIndexOf('|')
  return [key.slice(0, bar), key.slice(bar + 1)]
}

/** Rows and columns are stored in chunks (see Axis). */
export const ROW_CHUNK = 1024
export const COL_CHUNK = 64

/** Row/column style overrides live in the axis meta maps under `s.<prop>`. */
const AXIS_STYLE_PREFIX = 's.'

export class SheetModel {
  readonly rows: Axis
  readonly cols: Axis
  readonly cells: Y.Map<CellData>
  readonly xf: Y.Map<number>
  readonly fmt: Y.Map<unknown>
  readonly rowMeta: Y.Map<unknown>
  readonly colMeta: Y.Map<unknown>
  readonly view: Y.Map<unknown>
  readonly merges: Y.Map<{ range: RangeIds }>
  readonly cf: Y.Map<unknown>
  readonly dv: Y.Map<unknown>
  readonly tables: Y.Map<unknown>
  readonly drawings: Y.Map<unknown>
  readonly links: Y.Map<unknown>
  readonly notes: Y.Map<unknown>
  readonly filter: Y.Map<unknown>
  readonly raw: Y.Map<unknown>

  constructor(
    readonly workbook: WorkbookModel,
    readonly id: string,
    readonly map: Y.Map<unknown>,
  ) {
    this.rows = new Axis(map.get('rows') as Y.Array<string>, map.get('deadRows') as Y.Map<Tombstone>, ROW_CHUNK)
    this.cols = new Axis(map.get('cols') as Y.Array<string>, map.get('deadCols') as Y.Map<Tombstone>, COL_CHUNK)
    this.cells = map.get('cells') as Y.Map<CellData>
    this.xf = map.get('xf') as Y.Map<number>
    this.fmt = map.get('fmt') as Y.Map<unknown>
    this.rowMeta = map.get('rowMeta') as Y.Map<unknown>
    this.colMeta = map.get('colMeta') as Y.Map<unknown>
    this.view = map.get('view') as Y.Map<unknown>
    this.merges = map.get('merges') as Y.Map<{ range: RangeIds }>
    this.cf = map.get('cf') as Y.Map<unknown>
    this.dv = map.get('dv') as Y.Map<unknown>
    this.tables = map.get('tables') as Y.Map<unknown>
    this.drawings = map.get('drawings') as Y.Map<unknown>
    this.links = map.get('links') as Y.Map<unknown>
    this.notes = map.get('notes') as Y.Map<unknown>
    this.filter = map.get('filter') as Y.Map<unknown>
    this.raw = map.get('raw') as Y.Map<unknown>
  }

  static create(map: Y.Map<unknown>, name: string): void {
    map.set('name', name)
    map.set('state', 'visible')
    // The first chunk of rows and columns exists from the start, so people working on a new sheet
    // at the same time never race to store it (see Axis).
    const rows = new Y.Array<string>()
    rows.push(Array.from({ length: ROW_CHUNK }, (_, index) => String(index)))
    const cols = new Y.Array<string>()
    cols.push(Array.from({ length: COL_CHUNK }, (_, index) => String(index)))
    map.set('rows', rows)
    map.set('cols', cols)
    for (const key of ['deadRows', 'deadCols', 'cells', 'xf', 'fmt', 'rowMeta', 'colMeta', 'view', 'merges', 'cf', 'dv', 'tables', 'drawings', 'links', 'notes', 'filter', 'raw']) {
      map.set(key, new Y.Map())
    }
  }

  get name(): string {
    return this.workbook.resolvedSheetName(this.id) ?? ''
  }

  get state(): SheetState {
    return this.workbook.resolvedSheetState(this.id)
  }

  get tabColor(): SheetColor | undefined {
    return (this.map.get('tabColor') as SheetColor | undefined) ?? undefined
  }

  // ── Cells ────────────────────────────────────────────────────────────────

  keyAt(row: number, col: number): string {
    return cellKey(this.rows.idAt(row), this.cols.idAt(col))
  }

  /** Materializes the axes so `row`/`col` have stored ids. Call inside a transaction. */
  ensure(row: number, col: number): void {
    this.rows.ensure(row + 1)
    this.cols.ensure(col + 1)
  }

  cell(row: number, col: number): CellData | undefined {
    return this.cells.get(this.keyAt(row, col))
  }

  /** Writes or clears a cell's content (style is separate). */
  setCell(row: number, col: number, data: CellData | undefined): void {
    this.workbook.transact(() => {
      this.ensure(row, col)
      const key = this.keyAt(row, col)
      if (data === undefined || isEmptyCell(data)) this.cells.delete(key)
      else this.cells.set(key, data)
    })
  }

  /** Index position of a cell key, or undefined when its row or column was deleted. */
  position(key: string): { row: number; col: number } | undefined {
    const ids = splitCellKey(key)
    const row = this.rows.indexOf(ids.row)
    const col = this.cols.indexOf(ids.col)
    return row < 0 || col < 0 ? undefined : { row, col }
  }

  /** Visits every live cell with content. */
  forEachCell(visit: (row: number, col: number, data: CellData, key: string) => void): void {
    for (const [key, data] of this.cells) {
      const position = this.position(key)
      if (position) visit(position.row, position.col, data, key)
    }
  }

  /** The bounding range of every cell with content or style, or undefined for an empty sheet. */
  usedRange(): CellRange | undefined {
    let top = Infinity
    let left = Infinity
    let bottom = -1
    let right = -1
    const include = (key: string) => {
      const position = this.position(key)
      if (!position) return
      top = Math.min(top, position.row)
      left = Math.min(left, position.col)
      bottom = Math.max(bottom, position.row)
      right = Math.max(right, position.col)
    }
    for (const key of this.cells.keys()) include(key)
    for (const key of this.xf.keys()) include(key)
    for (const key of this.fmt.keys()) include(splitPropKey(key)[0])
    return bottom < 0 ? undefined : { top, left, bottom, right }
  }

  // ── Styles ───────────────────────────────────────────────────────────────

  /** The base style index of a cell as stored (undefined: inherit from the row or column). */
  baseXf(row: number, col: number): number | undefined {
    return this.xf.get(this.keyAt(row, col))
  }

  /** The style overrides set directly on a cell. */
  cellOverrides(key: string): Partial<StyleProps> {
    return this.workbook.overridesOf(this.fmt, key)
  }

  setBaseXf(row: number, col: number, xf: number | undefined): void {
    this.workbook.transact(() => {
      this.ensure(row, col)
      const key = this.keyAt(row, col)
      if (xf === undefined) this.xf.delete(key)
      else this.xf.set(key, xf)
    })
  }

  /** Sets (or with `undefined`, removes) style overrides on every cell of a range. */
  setStyle(range: CellRange, props: Partial<{ [K in StyleProp]: StyleProps[K] | undefined }>): void {
    const entries = Object.entries(props) as [StyleProp, unknown][]
    this.workbook.transact(() => {
      this.ensure(range.bottom, range.right)
      for (let row = range.top; row <= range.bottom; row++) {
        for (let col = range.left; col <= range.right; col++) {
          const key = this.keyAt(row, col)
          for (const [prop, value] of entries) {
            if (value === undefined) this.fmt.delete(`${key}|${prop}`)
            else this.fmt.set(`${key}|${prop}`, value)
          }
        }
      }
    })
  }

  /** Removes every style from a range: base styles and overrides. */
  clearStyle(range: CellRange): void {
    this.workbook.transact(() => {
      for (let row = range.top; row <= range.bottom; row++) {
        for (let col = range.left; col <= range.right; col++) {
          const key = this.keyAt(row, col)
          this.xf.delete(key)
          for (const prop of this.workbook.overridePropsOf(this.fmt, key)) this.fmt.delete(`${key}|${prop}`)
        }
      }
    })
  }

  // ── Rows and columns ─────────────────────────────────────────────────────

  rowProp<K extends AxisProp>(row: number, prop: K): AxisProps[K] | undefined {
    return this.rowMeta.get(`${this.rows.idAt(row)}|${prop}`) as AxisProps[K] | undefined
  }

  colProp<K extends AxisProp>(col: number, prop: K): AxisProps[K] | undefined {
    return this.colMeta.get(`${this.cols.idAt(col)}|${prop}`) as AxisProps[K] | undefined
  }

  setRowProp<K extends AxisProp>(rows: number[], prop: K, value: AxisProps[K] | undefined): void {
    this.setAxisProp(this.rows, this.rowMeta, rows, prop, value)
  }

  setColProp<K extends AxisProp>(cols: number[], prop: K, value: AxisProps[K] | undefined): void {
    this.setAxisProp(this.cols, this.colMeta, cols, prop, value)
  }

  /** Style overrides on whole rows/columns (`s.<prop>` keys of the axis meta maps). */
  axisOverrides(axis: 'row' | 'col', id: string): Partial<StyleProps> {
    return this.workbook.overridesOf(axis === 'row' ? this.rowMeta : this.colMeta, id, AXIS_STYLE_PREFIX)
  }

  setAxisStyle(axis: 'row' | 'col', positions: number[], props: Partial<{ [K in StyleProp]: StyleProps[K] | undefined }>): void {
    const meta = axis === 'row' ? this.rowMeta : this.colMeta
    const ids = axis === 'row' ? this.rows : this.cols
    this.workbook.transact(() => {
      ids.ensure(Math.max(...positions) + 1)
      for (const position of positions) {
        const id = ids.idAt(position)
        for (const [prop, value] of Object.entries(props)) {
          if (value === undefined) meta.delete(`${id}|${AXIS_STYLE_PREFIX}${prop}`)
          else meta.set(`${id}|${AXIS_STYLE_PREFIX}${prop}`, value)
        }
      }
    })
  }

  private setAxisProp<K extends AxisProp>(axis: Axis, meta: Y.Map<unknown>, positions: number[], prop: K, value: AxisProps[K] | undefined): void {
    if (!positions.length) return
    this.workbook.transact(() => {
      axis.ensure(Math.max(...positions) + 1)
      for (const position of positions) {
        const key = `${axis.idAt(position)}|${prop}`
        if (value === undefined) meta.delete(key)
        else meta.set(key, value)
      }
    })
  }

  // ── View ─────────────────────────────────────────────────────────────────

  viewProp<K extends keyof ViewProps>(prop: K): ViewProps[K] | undefined {
    return this.view.get(prop) as ViewProps[K] | undefined
  }

  setViewProp<K extends keyof ViewProps>(prop: K, value: ViewProps[K] | undefined): void {
    this.workbook.transact(() => {
      if (value === undefined) this.view.delete(prop)
      else this.view.set(prop, value)
    })
  }

  // ── Ranges by id ─────────────────────────────────────────────────────────

  /** A range's ids, materializing the axes as needed. Whole rows/columns leave sides open. */
  rangeIds(range: CellRange): RangeIds {
    const ids: RangeIds = {}
    const wholeCols = range.top === 0 && range.bottom >= MAX_ROWS - 1
    const wholeRows = range.left === 0 && range.right >= MAX_COLS - 1
    if (!wholeCols) {
      this.rows.ensure(range.bottom + 1)
      ids.top = this.rows.idAt(range.top)
      ids.bottom = this.rows.idAt(range.bottom)
    }
    if (!wholeRows) {
      this.cols.ensure(range.right + 1)
      ids.left = this.cols.idAt(range.left)
      ids.right = this.cols.idAt(range.right)
    }
    return ids
  }

  /**
   * Resolves a range by ids to indexes. An edge whose row or column was deleted resolves next
   * to where it was (the range shrinks); undefined when nothing of the range is left.
   */
  resolveRange(ids: RangeIds): CellRange | undefined {
    const top = ids.top === undefined ? 0 : edgeIndex(this.rows, ids.top, 'start')
    const bottom = ids.bottom === undefined ? MAX_ROWS - 1 : edgeIndex(this.rows, ids.bottom, 'end')
    const left = ids.left === undefined ? 0 : edgeIndex(this.cols, ids.left, 'start')
    const right = ids.right === undefined ? MAX_COLS - 1 : edgeIndex(this.cols, ids.right, 'end')
    if (top < 0 || left < 0 || bottom < top || right < left) return undefined
    return { top, left, bottom, right }
  }

  /**
   * Every merged range, resolved. Two people merging overlapping ranges at once leaves both
   * merges stored; Excel can't open overlapping merges, so the one with the smaller id wins
   * (the same choice on every replica) and the other is ignored.
   */
  mergedRanges(): { id: string; range: CellRange }[] {
    const merged: { id: string; range: CellRange }[] = []
    const entries = [...this.merges.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    for (const [id, merge] of entries) {
      const range = this.resolveRange(merge.range)
      if (!range || (range.bottom === range.top && range.right === range.left)) continue
      if (merged.some((kept) => kept.range.left <= range.right && range.left <= kept.range.right && kept.range.top <= range.bottom && range.top <= kept.range.bottom)) continue
      merged.push({ id, range })
    }
    return merged
  }
}

function edgeIndex(axis: Axis, id: string, side: 'start' | 'end'): number {
  const index = axis.indexOf(id)
  if (index >= 0) return index
  // The row that took a deleted start's place is the next one; a deleted end's is the previous.
  return axis.deletedPosition(id, side) ?? -1
}

export function isEmptyCell(data: CellData): boolean {
  return (data.v === undefined || data.v === null || data.v === '') && !data.f && !data.runs?.length
}

/** A spreadsheet in a Y.Doc. Wraps the layout in schema.ts with typed accessors. */
export class WorkbookModel {
  readonly root: Y.Map<unknown>
  private readonly sheetCache = new Map<string, SheetModel>()
  readonly names = new DefinedNames(this)

  constructor(
    readonly doc: Y.Doc,
    /** Transaction origin for edits made through this model (undo managers track it). */
    readonly origin: unknown = null,
  ) {
    this.root = doc.getMap(WORKBOOK_MAP)
  }

  /** Lays out an empty workbook. Call on an empty doc. */
  static initialize(doc: Y.Doc, meta: Partial<WorkbookMeta> = {}): WorkbookModel {
    const model = new WorkbookModel(doc)
    doc.transact(() => {
      const metaMap = new Y.Map<unknown>()
      model.root.set('meta', metaMap)
      model.root.set('order', new Y.Array<string>())
      model.root.set('sheets', new Y.Map())
      model.root.set('names', new Y.Map())
      model.root.set('parts', new Y.Map())
      metaMap.set('schemaVersion', SHEETS_SCHEMA_VERSION)
      metaMap.set('format', meta.format ?? 'xlsx')
      metaMap.set('date1904', meta.date1904 ?? false)
      for (const [key, value] of Object.entries(meta)) if (value !== undefined) metaMap.set(key, value)
    })
    return model
  }

  get initialized(): boolean {
    return this.root.has('meta')
  }

  get meta(): Y.Map<unknown> {
    return this.root.get('meta') as Y.Map<unknown>
  }

  metaValue<K extends keyof WorkbookMeta>(key: K): WorkbookMeta[K] | undefined {
    return this.meta.get(key) as WorkbookMeta[K] | undefined
  }

  setMeta<K extends keyof WorkbookMeta>(key: K, value: WorkbookMeta[K] | undefined): void {
    this.transact(() => {
      if (value === undefined) this.meta.delete(key)
      else this.meta.set(key, value)
    })
  }

  get date1904(): boolean {
    return this.metaValue('date1904') === true
  }

  get order(): Y.Array<string> {
    return this.root.get('order') as Y.Array<string>
  }

  get sheetsMap(): Y.Map<Y.Map<unknown>> {
    return this.root.get('sheets') as Y.Map<Y.Map<unknown>>
  }

  get parts(): Y.Map<PreservedPart> {
    return this.root.get('parts') as Y.Map<PreservedPart>
  }

  transact(fn: () => void): void {
    // Nested calls join the outer transaction.
    this.doc.transact(fn, this.origin)
  }

  // ── Sheets ───────────────────────────────────────────────────────────────

  /** The stored tab order includes tombstones so concurrent deletions retain a fallback. */
  private orderedSheetIds(): string[] {
    const seen = new Set<string>()
    const ids: string[] = []
    for (const id of this.order) {
      if (seen.has(id) || !this.sheetsMap.has(id)) continue
      seen.add(id)
      ids.push(id)
    }
    // A sheet whose id fell out of the order (concurrent move and delete) stays reachable at the end.
    for (const id of [...this.sheetsMap.keys()].sort()) if (!seen.has(id)) ids.push(id)
    return ids
  }

  /** Live sheet ids in tab order, with the first stored sheet surviving if all were deleted. */
  sheetIds(): string[] {
    const ordered = this.orderedSheetIds()
    const live = ordered.filter((id) => this.sheetsMap.get(id)!.get('deleted') !== true)
    return live.length ? live : ordered.slice(0, 1)
  }

  /** Resolves collisions without rewriting names or formulas stored by another replica. */
  resolvedSheetName(id: string): string | undefined {
    const ids = this.sheetIds()
    const stored = (sheetId: string) => (this.sheetsMap.get(sheetId)!.get('name') as string | undefined) ?? ''
    // Reserve original names first so a generated suffix never takes another sheet's name.
    const taken = new Set(ids.map((sheetId) => stored(sheetId).toLowerCase()))
    const seen = new Set<string>()
    for (const sheetId of ids) {
      const base = stored(sheetId)
      const lower = base.toLowerCase()
      const name = seen.has(lower) ? availableSheetName(base, taken) : base
      seen.add(lower)
      taken.add(name.toLowerCase())
      if (sheetId === id) return name
    }
    return undefined
  }

  /** Concurrent hiding cannot leave the workbook without a visible tab. */
  resolvedSheetState(id: string): SheetState {
    const stored = (sheetId: string) => (this.sheetsMap.get(sheetId)?.get('state') as SheetState | undefined) ?? 'visible'
    const state = stored(id)
    if (state === 'visible') return state
    const ids = this.sheetIds()
    return ids[0] === id && !ids.some((sheetId) => stored(sheetId) === 'visible') ? 'visible' : state
  }

  sheets(): SheetModel[] {
    return this.sheetIds().map((id) => this.sheet(id)!)
  }

  sheet(id: string): SheetModel | undefined {
    const map = this.sheetsMap.get(id)
    if (!map) {
      this.sheetCache.delete(id)
      return undefined
    }
    if (map.get('deleted') === true && !this.sheetIds().includes(id)) return undefined
    let sheet = this.sheetCache.get(id)
    if (!sheet || sheet.map !== map) {
      sheet = new SheetModel(this, id, map)
      this.sheetCache.set(id, sheet)
    }
    return sheet
  }

  sheetByName(name: string): SheetModel | undefined {
    const lower = name.toLowerCase()
    return this.sheets().find((sheet) => sheet.name.toLowerCase() === lower)
  }

  /** A sheet name not taken yet: `base`, else `base (2)`, … (Excel uses `Sheet1 (2)` for copies). */
  uniqueSheetName(base: string): string {
    const taken = new Set(this.sheets().map((sheet) => sheet.name.toLowerCase()))
    return availableSheetName(base, taken)
  }

  /** The next free `SheetN` name. */
  nextSheetName(): string {
    const taken = new Set(this.sheets().map((sheet) => sheet.name.toLowerCase()))
    for (let n = this.sheetIds().length + 1; ; n++) if (!taken.has(`sheet${n}`)) return `Sheet${n}`
  }

  addSheet(name: string, position = this.sheetIds().length, id = randomId()): SheetModel {
    this.transact(() => {
      const map = new Y.Map<unknown>()
      this.sheetsMap.set(id, map)
      SheetModel.create(map, name)
      this.order.insert(this.storedSheetIndex(position), [id])
    })
    return this.sheet(id)!
  }

  renameSheet(id: string, name: string): void {
    const sheet = this.sheet(id)
    if (!sheet) return
    const error = validateSheetName(name, this, id)
    if (error) throw new Error(error)
    // Formulas refer to sheets by id, so nothing else changes.
    this.transact(() => sheet.map.set('name', name))
  }

  setSheetState(id: string, state: SheetState): void {
    const sheet = this.sheet(id)
    if (!sheet) return
    if (state !== 'visible' && this.sheets().filter((entry) => entry.state === 'visible' && entry.id !== id).length === 0) {
      throw new Error('A workbook must keep at least one visible sheet')
    }
    this.transact(() => sheet.map.set('state', state))
  }

  setTabColor(id: string, color: SheetColor | undefined): void {
    const sheet = this.sheet(id)
    if (!sheet) return
    this.transact(() => {
      if (color) sheet.map.set('tabColor', color)
      else sheet.map.delete('tabColor')
    })
  }

  moveSheet(id: string, position: number): void {
    if (!this.sheet(id)) return
    this.transact(() => {
      this.removeFromOrder(id)
      this.order.insert(this.storedSheetIndex(position), [id])
    })
  }

  deleteSheet(id: string): void {
    const sheet = this.sheet(id)
    if (!sheet) return
    if (this.sheets().filter((sheet) => sheet.id !== id && sheet.state === 'visible').length === 0) {
      throw new Error('A workbook must keep at least one visible sheet')
    }
    this.transact(() => {
      // Retain contents and scoped names in case concurrent deletions make this the fallback.
      sheet.map.set('deleted', true)
      if (this.metaValue('activeSheet') === id) this.setMeta('activeSheet', this.sheetIds()[0])
    })
  }

  /** Index of `position` among live sheet ids, as an index into the stored order. */
  private storedSheetIndex(position: number): number {
    const live = this.sheetIds()
    if (position >= live.length) return this.order.length
    const target = live[position]!
    const array = this.order.toArray()
    const index = array.indexOf(target)
    return index < 0 ? this.order.length : index
  }

  private removeFromOrder(id: string): void {
    const array = this.order.toArray()
    for (let index = array.length - 1; index >= 0; index--) if (array[index] === id) this.order.delete(index, 1)
  }

  // ── Style overrides ──────────────────────────────────────────────────────

  /** The overrides stored in `map` under `"<owner>|<prefix><prop>"` keys. */
  overridesOf(map: Y.Map<unknown>, owner: string, prefix = ''): Partial<StyleProps> {
    const overrides: Record<string, unknown> = {}
    // Overrides are looked up by key, which is much faster than scanning the map.
    for (const prop of STYLE_PROP_LIST) {
      const key = `${owner}|${prefix}${prop}`
      if (map.has(key)) overrides[prop] = map.get(key)
    }
    return overrides as Partial<StyleProps>
  }

  overridePropsOf(map: Y.Map<unknown>, owner: string, prefix = ''): StyleProp[] {
    return STYLE_PROP_LIST.filter((prop) => map.has(`${owner}|${prefix}${prop}`))
  }
}

/** Stable identity for a name, shared by concurrent file applications and canonical readers. */
export function definedNameKey(name: Pick<DefinedName, 'name' | 'scope'>): string {
  return `n:${name.scope ?? ''}:${name.name.toLowerCase()}`
}

/** Readers expose one definition per scoped name while retaining older duplicate storage. */
/**
 * Per names map, identity → the key of its winning definition, rebuilt after the names change.
 * Shared by every model of the document, so models made for one call add no observers.
 */
const CANONICAL_NAMES = new WeakMap<Y.Map<DefinedName>, { keys: Map<string, string> | undefined }>()

class DefinedNames {
  constructor(private readonly workbook: WorkbookModel) {}

  private get map(): Y.Map<DefinedName> {
    return this.workbook.root.get('names') as Y.Map<DefinedName>
  }

  /** Built once per change, so looking names up stays linear in the number of names. */
  private cache(): { keys: Map<string, string> | undefined } {
    const map = this.map
    let cache = CANONICAL_NAMES.get(map)
    if (!cache) {
      const created: { keys: Map<string, string> | undefined } = { keys: undefined }
      map.observe(() => (created.keys = undefined))
      CANONICAL_NAMES.set(map, created)
      cache = created
    }
    return cache
  }

  private canonical(): Map<string, string> {
    const map = this.map
    const cache = this.cache()
    if (cache.keys) return cache.keys
    const canonical = new Map<string, string>()
    // Y.Map iteration follows local insertion order, so only key order can choose the same winner.
    for (const [id, name] of map) {
      const identity = definedNameKey(name)
      const previous = canonical.get(identity)
      if (previous === undefined || id < previous) canonical.set(identity, id)
    }
    cache.keys = canonical
    return canonical
  }

  get(id: string): DefinedName | undefined {
    const name = this.map.get(id)
    if (!name || (name.scope && !this.workbook.sheet(name.scope))) return undefined
    return this.canonical().get(definedNameKey(name)) === id ? name : undefined
  }

  set(id: string, name: DefinedName): void {
    this.map.set(id, name)
    // Observers run when the transaction ends; lookups inside it must see the change now.
    this.cache().keys = undefined
  }

  delete(id: string): void {
    const name = this.map.get(id)
    if (!name) return
    // Removing a name must also remove older duplicates so a hidden definition cannot reappear.
    const identity = definedNameKey(name)
    for (const [key, candidate] of [...this.map.entries()]) if (definedNameKey(candidate) === identity) this.map.delete(key)
    this.cache().keys = undefined
  }

  *entries(): IterableIterator<[string, DefinedName]> {
    const canonical = this.canonical()
    for (const [id, name] of this.map) {
      if (canonical.get(definedNameKey(name)) === id && (!name.scope || this.workbook.sheet(name.scope))) yield [id, name]
    }
  }

  *keys(): IterableIterator<string> {
    for (const [id] of this) yield id
  }

  *values(): IterableIterator<DefinedName> {
    for (const [, name] of this) yield name
  }

  [Symbol.iterator](): IterableIterator<[string, DefinedName]> {
    return this.entries()
  }
}

function availableSheetName(base: string, taken: Set<string>): string {
  if (!taken.has(base.toLowerCase())) return base
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, 31 - ` (${n})`.length)} (${n})`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}

const STYLE_PROP_LIST = STYLE_PROPS

/** Why a sheet name is invalid (Excel's rules), or undefined when it is fine. */
export function validateSheetName(name: string, workbook?: WorkbookModel, exceptId?: string): string | undefined {
  if (!name.trim()) return 'Sheet names cannot be blank'
  if (name.length > 31) return 'Sheet names can have at most 31 characters'
  if (/[\\/?*[\]:]/.test(name)) return 'Sheet names cannot contain \\ / ? * [ ] :'
  if (name.startsWith("'") || name.endsWith("'")) return 'Sheet names cannot start or end with an apostrophe'
  if (name.toLowerCase() === 'history') return 'History is a reserved name'
  if (workbook?.sheets().some((sheet) => sheet.id !== exceptId && sheet.name.toLowerCase() === name.toLowerCase())) {
    return 'That name is already taken'
  }
  return undefined
}
