import { prosemirrorJSONToYXmlFragment, updateYFragment, yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import type {
  NotesSnapshot,
  PartSnapshot,
  PresentationSnapshot,
  SectionSnapshot,
  ShapeSnapshot,
  SlideSnapshot,
  TableCell,
  TableColumn,
  TableRow,
  TableSnapshot,
  Xfrm,
} from './model.js'
import { PRESENTATION_SCHEMA_VERSION } from './model.js'
import { EMPTY_TEXT, normalizeText, slideTextSchema, textNode, textToPlain, type TextJSON } from './text.js'
import { stableStringify } from './xml.js'

/**
 * The collaborative layout of a presentation (see docs/presentations.md).
 *
 * Everything lives under one root map. Ordered collections (slides, shapes, group members, table
 * rows and columns) are arrays of keys next to a map from key to content, so moving an item is a
 * small array edit that cannot drop concurrent edits to the item itself. Shapes keep each modeled
 * property under its own key, transforms in a nested map, and text in Y.XmlFragments, so two
 * people moving and recoloring a shape, or typing in it, merge instead of overwriting each other.
 */

import { PRESENTATION_ROOT } from './layout.js'

export { PRESENTATION_ROOT }

type YShape = Y.Map<unknown>
type YSlide = Y.Map<unknown>

export function presentationRoot(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(PRESENTATION_ROOT)
}

const META_KEYS = ['mainPart', 'slideWidth', 'slideHeight', 'notesWidth', 'notesHeight'] as const
const SLIDE_SCALARS = ['sldId', 'part', 'layout', 'hidden', 'xml', 'background', 'rels', 'section', 'source', 'relsSource'] as const
const SHAPE_SCALARS = ['kind', 'xml', 'rels', 'nvId', 'name', 'descr', 'hidden', 'geom', 'fill', 'line', 'effects', 'blipFill', 'bodyPr'] as const
const XFRM_KEYS = ['x', 'y', 'cx', 'cy', 'rot', 'flipH', 'flipV', 'chX', 'chY', 'chCx', 'chCy'] as const
const CELL_SCALARS = ['xml', 'gridSpan', 'rowSpan', 'hMerge', 'vMerge', 'tcPr'] as const

// ---------------------------------------------------------------------------------------------
// Writing a snapshot into an empty document

export function writeSnapshot(doc: Y.Doc, snapshot: PresentationSnapshot, origin?: unknown): void {
  doc.transact(() => {
    const root = presentationRoot(doc)
    root.set('version', PRESENTATION_SCHEMA_VERSION)
    for (const key of META_KEYS) root.set(key, snapshot[key])
    const parts = new Y.Map<PartSnapshot>()
    root.set('parts', parts)
    for (const [partPath, part] of Object.entries(snapshot.parts)) parts.set(partPath, part)
    const sectionOrder = new Y.Array<string>()
    const sections = new Y.Map<{ name: string; id: string }>()
    root.set('sectionOrder', sectionOrder)
    root.set('sections', sections)
    sectionOrder.push(snapshot.sections.map((section) => section.key))
    for (const section of snapshot.sections) sections.set(section.key, { name: section.name, id: section.id })
    const slideOrder = new Y.Array<string>()
    const slides = new Y.Map<YSlide>()
    root.set('slideOrder', slideOrder)
    root.set('slides', slides)
    for (const slide of snapshot.slides) insertSlide(doc, slide, slideOrder.length)
  }, origin)
}

/** Adds a slide at `index` of the slide order. */
export function insertSlide(doc: Y.Doc, slide: SlideSnapshot, index: number): void {
  const root = presentationRoot(doc)
  const slides = root.get('slides') as Y.Map<YSlide>
  const slideOrder = root.get('slideOrder') as Y.Array<string>
  const map = new Y.Map<unknown>()
  slides.set(slide.key, map)
  fillSlide(map, slide)
  slideOrder.insert(Math.max(0, Math.min(index, slideOrder.length)), [slide.key])
}

function fillSlide(map: YSlide, slide: SlideSnapshot): void {
  for (const key of SLIDE_SCALARS) if (slide[key] !== undefined && slide[key] !== false) map.set(key, slide[key])
  const shapes = new Y.Map<YShape>()
  const shapeOrder = new Y.Array<string>()
  map.set('shapes', shapes)
  map.set('shapeOrder', shapeOrder)
  shapeOrder.push(slide.shapes.map((shape) => shape.key))
  for (const shape of slide.shapes) addShape(shapes, shape)
  // Every slide has a notes map and every text shape a text fragment from the start: created
  // lazily, two people starting notes at once would each make one and Yjs would keep only one.
  setNotes(map, slide.notes ?? NO_NOTES)
}

const NO_NOTES: NotesSnapshot = { xml: '', rels: {}, text: { type: 'doc' } }

/** A text body with no paragraphs is a placeholder for text nobody has written yet. */
function isBlank(fragment: unknown): boolean {
  return !(fragment instanceof Y.XmlFragment) || fragment.length === 0
}

/** Attaches a map under `key` first and fills it after: Yjs types are only readable once integrated. */
function attach(parent: Y.Map<unknown>, key: string, fill: (map: Y.Map<unknown>) => void): Y.Map<unknown> {
  const map = new Y.Map<unknown>()
  parent.set(key, map)
  fill(map)
  return map
}

export function setNotes(slide: Y.Map<unknown>, notes: NotesSnapshot): void {
  attach(slide, 'notes', (map) => {
    if (notes.part !== undefined) map.set('part', notes.part)
    map.set('xml', notes.xml)
    map.set('rels', notes.rels)
    if (notes.source) map.set('source', notes.source)
    if (notes.relsSource) map.set('relsSource', notes.relsSource)
    if (notes.text.content?.length) setText(map, 'text', notes.text)
    else map.set('text', new Y.XmlFragment())
  })
}

/** Stores `json` as a new Y.XmlFragment under `key` of an integrated map. */
export function setText(map: Y.Map<unknown>, key: string, json: TextJSON): Y.XmlFragment {
  const fragment = new Y.XmlFragment()
  map.set(key, fragment)
  prosemirrorJSONToYXmlFragment(slideTextSchema(), json, fragment)
  return fragment
}

/** Adds a shape (and its group members) to a slide's shape map. Callers place its key in an order array. */
export function addShape(shapes: Y.Map<YShape>, shape: ShapeSnapshot): void {
  attach(shapes as Y.Map<unknown>, shape.key, (map) => fillShape(map, shape))
  for (const member of shape.children ?? []) addShape(shapes, member)
}

function fillShape(map: YShape, shape: ShapeSnapshot): void {
  for (const key of SHAPE_SCALARS) if (shape[key] !== undefined) map.set(key, shape[key])
  if (shape.xfrm) map.set('xfrm', xfrmMap(shape.xfrm))
  if (shape.text) setText(map, 'text', shape.text)
  else if (shape.kind === 'sp') map.set('text', new Y.XmlFragment())
  if (shape.table) setTable(map, shape.table)
  if (shape.children) {
    const children = new Y.Array<string>()
    map.set('children', children)
    children.push(shape.children.map((member) => member.key))
  }
}

function xfrmMap(xfrm: Xfrm): Y.Map<number | boolean> {
  const map = new Y.Map<number | boolean>()
  for (const key of XFRM_KEYS) if (xfrm[key] !== undefined) map.set(key, xfrm[key]!)
  return map
}

function setTable(shape: Y.Map<unknown>, table: TableSnapshot): void {
  attach(shape, 'table', (map) => {
    if (table.tblPr !== undefined) map.set('tblPr', table.tblPr)
    const columnOrder = new Y.Array<string>()
    const columns = new Y.Map<{ w: number; xml: string }>()
    const rowOrder = new Y.Array<string>()
    const rows = new Y.Map<Y.Map<unknown>>()
    map.set('columnOrder', columnOrder)
    map.set('columns', columns)
    map.set('rowOrder', rowOrder)
    map.set('rows', rows)
    columnOrder.push(table.columns.map((column) => column.key))
    for (const column of table.columns) columns.set(column.key, { w: column.w, xml: column.xml })
    rowOrder.push(table.rows.map((row) => row.key))
    for (const row of table.rows) setRow(rows, row)
  })
}

/** Adds a table row under its key. Callers place the key in `rowOrder`. */
export function setRow(rows: Y.Map<Y.Map<unknown>>, row: TableRow): void {
  attach(rows as Y.Map<unknown>, row.key, (map) => {
    map.set('h', row.h)
    map.set('xml', row.xml)
    const cells = new Y.Map<Y.Map<unknown>>()
    map.set('cells', cells)
    for (const [columnKey, cell] of Object.entries(row.cells)) setCell(cells, columnKey, cell)
  })
}

export function setCell(cells: Y.Map<Y.Map<unknown>>, columnKey: string, cell: TableCell): void {
  attach(cells as Y.Map<unknown>, columnKey, (map) => {
    for (const key of CELL_SCALARS) if (cell[key] !== undefined) map.set(key, cell[key])
    setText(map, 'text', cell.text)
  })
}

// ---------------------------------------------------------------------------------------------
// Reading a snapshot back out

/** Unique keys in order: concurrent moves can leave one key in an array twice. */
export function orderedKeys(array: Y.Array<string> | undefined, map: Y.Map<any> | undefined): string[] {
  if (!array || !map) return []
  const seen = new Set<string>()
  const keys: string[] = []
  for (const key of array.toArray()) {
    if (seen.has(key) || !map.has(key)) continue
    seen.add(key)
    keys.push(key)
  }
  return keys
}

function textToPlainSafe(fragment: unknown): string {
  return textToPlain(readText(fragment))
}

export function readText(fragment: unknown): TextJSON {
  if (!(fragment instanceof Y.XmlFragment) || fragment.length === 0) return EMPTY_TEXT
  try {
    return normalizeText(yXmlFragmentToProsemirrorJSON(fragment) as TextJSON)
  } catch {
    // A replica that wrote something outside the schema (an older or buggy client): keep the text.
    return normalizeText({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: fragment.toString().replace(/<[^>]*>/g, '') || ' ' }] }] })
  }
}

export function readSnapshot(doc: Y.Doc): PresentationSnapshot {
  const root = presentationRoot(doc)
  const parts = root.get('parts') as Y.Map<PartSnapshot> | undefined
  const slides = root.get('slides') as Y.Map<YSlide> | undefined
  const sections = root.get('sections') as Y.Map<{ name: string; id: string }> | undefined
  return {
    mainPart: (root.get('mainPart') as string | undefined) ?? 'ppt/presentation.xml',
    slideWidth: (root.get('slideWidth') as number | undefined) ?? 12_192_000,
    slideHeight: (root.get('slideHeight') as number | undefined) ?? 6_858_000,
    notesWidth: (root.get('notesWidth') as number | undefined) ?? 6_858_000,
    notesHeight: (root.get('notesHeight') as number | undefined) ?? 9_144_000,
    parts: Object.fromEntries(parts ? [...parts.entries()] : []),
    slides: orderedKeys(root.get('slideOrder') as Y.Array<string>, slides).map((key) => readSlideMap(key, slides!.get(key)!)),
    sections: orderedKeys(root.get('sectionOrder') as Y.Array<string>, sections).map((key): SectionSnapshot => ({ key, ...sections!.get(key)! })),
  }
}

export function readSlideMap(key: string, map: YSlide): SlideSnapshot {
  const slide: Record<string, unknown> = { key }
  for (const field of SLIDE_SCALARS) if (map.get(field) !== undefined) slide[field] = map.get(field)
  slide.hidden = map.get('hidden') === true
  slide.layout = (map.get('layout') as string | undefined) ?? ''
  slide.xml = (map.get('xml') as string | undefined) ?? ''
  slide.rels = (map.get('rels') as Record<string, unknown> | undefined) ?? {}
  const shapes = map.get('shapes') as Y.Map<YShape> | undefined
  const visited = new Set<string>()
  slide.shapes = orderedKeys(map.get('shapeOrder') as Y.Array<string>, shapes)
    .map((shapeKey) => readShapeMap(shapeKey, shapes!, visited, 0))
    .filter((shape): shape is ShapeSnapshot => shape !== undefined)
  const notes = map.get('notes') as Y.Map<unknown> | undefined
  const noNotes = notes && notes.get('part') === undefined && !notes.get('xml') && (isBlank(notes.get('text')) || textToPlainSafe(notes.get('text')) === '')
  if (notes && !noNotes) {
    slide.notes = {
      ...(notes.get('part') !== undefined ? { part: notes.get('part') } : {}),
      xml: notes.get('xml'),
      rels: notes.get('rels') ?? {},
      text: readText(notes.get('text')),
      ...(notes.get('source') ? { source: notes.get('source') } : {}),
      ...(notes.get('relsSource') ? { relsSource: notes.get('relsSource') } : {}),
    }
  }
  return slide as unknown as SlideSnapshot
}

function readShapeMap(key: string, shapes: Y.Map<YShape>, visited: Set<string>, depth: number): ShapeSnapshot | undefined {
  // A shape two people grouped at once can be listed twice; the first listing wins.
  if (visited.has(key) || depth > 64) return undefined
  visited.add(key)
  const map = shapes.get(key)
  if (!map) return undefined
  const shape: Record<string, unknown> = { key }
  for (const field of SHAPE_SCALARS) if (map.get(field) !== undefined) shape[field] = map.get(field)
  shape.rels ??= {}
  const xfrm = map.get('xfrm')
  if (xfrm instanceof Y.Map) shape.xfrm = readXfrmMap(xfrm)
  if (!isBlank(map.get('text'))) shape.text = readText(map.get('text'))
  const table = map.get('table')
  if (table instanceof Y.Map) shape.table = readTableMap(table)
  const children = map.get('children')
  if (children instanceof Y.Array) {
    shape.children = orderedKeys(children as Y.Array<string>, shapes)
      .map((member) => readShapeMap(member, shapes, visited, depth + 1))
      .filter((member): member is ShapeSnapshot => member !== undefined)
  }
  return shape as unknown as ShapeSnapshot
}

export function readXfrmMap(map: Y.Map<unknown>): Xfrm {
  const xfrm: Record<string, unknown> = { x: 0, y: 0, cx: 0, cy: 0 }
  for (const key of XFRM_KEYS) if (map.get(key) !== undefined) xfrm[key] = map.get(key)
  return xfrm as unknown as Xfrm
}

export function readTableMap(map: Y.Map<unknown>): TableSnapshot {
  const columns = map.get('columns') as Y.Map<{ w: number; xml: string }>
  const rows = map.get('rows') as Y.Map<Y.Map<unknown>>
  const columnKeys = orderedKeys(map.get('columnOrder') as Y.Array<string>, columns)
  return {
    ...(map.get('tblPr') !== undefined ? { tblPr: map.get('tblPr') as string } : {}),
    columns: columnKeys.map((key): TableColumn => ({ key, ...columns.get(key)! })),
    rows: orderedKeys(map.get('rowOrder') as Y.Array<string>, rows).map((key): TableRow => {
      const row = rows.get(key)!
      const cells = row.get('cells') as Y.Map<Y.Map<unknown>>
      const result: Record<string, TableCell> = {}
      for (const columnKey of columnKeys) {
        const cell = cells?.get(columnKey)
        if (!cell) continue
        const entry: Record<string, unknown> = { text: readText(cell.get('text')) }
        for (const field of CELL_SCALARS) if (cell.get(field) !== undefined) entry[field] = cell.get(field)
        result[columnKey] = entry as unknown as TableCell
      }
      return { key, h: (row.get('h') as number) ?? 0, xml: (row.get('xml') as string) ?? '<a:tr/>', cells: result }
    }),
  }
}

// ---------------------------------------------------------------------------------------------
// Reconciling: rewriting the document to match a snapshot with as few changes as possible

/** Brings `doc` to `target` with minimal edits, in one transaction. Returns whether anything changed. */
export function reconcileSnapshot(doc: Y.Doc, target: PresentationSnapshot, origin?: unknown): boolean {
  let changed = false
  doc.transact((transaction) => {
    const root = presentationRoot(doc)
    if (!root.has('slides')) {
      writeSnapshot(doc, target)
      changed = true
      return
    }
    for (const key of META_KEYS) setIfChanged(root, key, target[key])
    const parts = root.get('parts') as Y.Map<PartSnapshot>
    for (const [partPath, part] of Object.entries(target.parts)) setIfChanged(parts, partPath, part)
    for (const partPath of [...parts.keys()]) if (!(partPath in target.parts)) parts.delete(partPath)

    const sections = root.get('sections') as Y.Map<{ name: string; id: string }>
    for (const section of target.sections) setIfChanged(sections, section.key, { name: section.name, id: section.id })
    syncKeys(root.get('sectionOrder') as Y.Array<string>, target.sections.map((section) => section.key))
    for (const key of [...sections.keys()]) if (!target.sections.some((section) => section.key === key)) sections.delete(key)

    const slides = root.get('slides') as Y.Map<YSlide>
    for (const slide of target.slides) {
      const existing = slides.get(slide.key)
      if (existing) reconcileSlide(existing, slide)
      else {
        const map = new Y.Map<unknown>()
        slides.set(slide.key, map)
        fillSlide(map, slide)
      }
    }
    syncKeys(root.get('slideOrder') as Y.Array<string>, target.slides.map((slide) => slide.key))
    const wanted = new Set(target.slides.map((slide) => slide.key))
    for (const key of [...slides.keys()]) if (!wanted.has(key)) slides.delete(key)
    changed = transaction.changed.size > 0 || transaction.deleteSet.clients.size > 0
  }, origin)
  return changed
}

function setIfChanged(map: Y.Map<any>, key: string, value: unknown): void {
  if (value === undefined) {
    if (map.has(key)) map.delete(key)
    return
  }
  const current = map.get(key)
  if (current instanceof Y.AbstractType || stableStringify(current) !== stableStringify(value)) map.set(key, value)
}

function reconcileSlide(map: YSlide, slide: SlideSnapshot): void {
  for (const key of SLIDE_SCALARS) setIfChanged(map, key, key === 'hidden' ? slide.hidden || undefined : slide[key])
  const shapes = map.get('shapes') as Y.Map<YShape>
  const all = new Map<string, ShapeSnapshot>()
  const collect = (shape: ShapeSnapshot) => {
    all.set(shape.key, shape)
    shape.children?.forEach(collect)
  }
  slide.shapes.forEach(collect)
  for (const shape of all.values()) {
    const existing = shapes.get(shape.key)
    if (existing && existing.get('kind') === shape.kind) reconcileShape(existing, shape)
    else {
      const replacement = new Y.Map<unknown>()
      shapes.set(shape.key, replacement)
      fillShape(replacement, shape)
    }
  }
  syncKeys(map.get('shapeOrder') as Y.Array<string>, slide.shapes.map((shape) => shape.key))
  for (const key of [...shapes.keys()]) if (!all.has(key)) shapes.delete(key)
  const notes = map.get('notes') as Y.Map<unknown> | undefined
  if (!slide.notes) {
    // Keep the map (see fillSlide); clear what it says.
    if (!notes) setNotes(map, NO_NOTES)
    else {
      for (const key of ['part', 'source', 'relsSource']) if (notes.has(key)) notes.delete(key)
      setIfChanged(notes, 'xml', '')
      const text = notes.get('text')
      if (text instanceof Y.XmlFragment && text.length) text.delete(0, text.length)
    }
  } else if (!notes) {
    setNotes(map, slide.notes)
  } else {
    setIfChanged(notes, 'part', slide.notes.part)
    setIfChanged(notes, 'xml', slide.notes.xml)
    setIfChanged(notes, 'rels', slide.notes.rels)
    setIfChanged(notes, 'source', slide.notes.source)
    setIfChanged(notes, 'relsSource', slide.notes.relsSource)
    reconcileText(notes, 'text', slide.notes.text)
  }
}

function reconcileShape(map: YShape, shape: ShapeSnapshot): void {
  for (const key of SHAPE_SCALARS) setIfChanged(map, key, shape[key])
  if (!shape.xfrm) {
    if (map.has('xfrm')) map.delete('xfrm')
  } else {
    const xfrm = map.get('xfrm')
    if (xfrm instanceof Y.Map) {
      for (const key of XFRM_KEYS) setIfChanged(xfrm, key, shape.xfrm[key])
    } else map.set('xfrm', xfrmMap(shape.xfrm))
  }
  if (shape.text) reconcileText(map, 'text', shape.text)
  else {
    const text = map.get('text')
    if (text instanceof Y.XmlFragment) {
      if (text.length) text.delete(0, text.length)
    } else if (shape.kind === 'sp') map.set('text', new Y.XmlFragment())
  }
  if (shape.table) {
    const table = map.get('table')
    if (table instanceof Y.Map) reconcileTable(table, shape.table)
    else setTable(map, shape.table)
  } else if (map.has('table')) map.delete('table')
  if (shape.children) {
    let children = map.get('children')
    if (!(children instanceof Y.Array)) {
      children = new Y.Array<string>()
      map.set('children', children)
    }
    syncKeys(children as Y.Array<string>, shape.children.map((member) => member.key))
  } else if (map.has('children')) map.delete('children')
}

function reconcileText(map: Y.Map<unknown>, key: string, json: TextJSON): void {
  const fragment = map.get(key)
  if (!(fragment instanceof Y.XmlFragment)) {
    setText(map, key, json)
    return
  }
  if (stableStringify(readText(fragment)) === stableStringify(normalizeText(json))) return
  updateYFragment(fragment.doc!, fragment, textNode(json), { mapping: new Map(), isOMark: new Map() })
}

function reconcileTable(map: Y.Map<unknown>, table: TableSnapshot): void {
  setIfChanged(map, 'tblPr', table.tblPr)
  const columns = map.get('columns') as Y.Map<{ w: number; xml: string }>
  for (const column of table.columns) setIfChanged(columns, column.key, { w: column.w, xml: column.xml })
  syncKeys(map.get('columnOrder') as Y.Array<string>, table.columns.map((column) => column.key))
  for (const key of [...columns.keys()]) if (!table.columns.some((column) => column.key === key)) columns.delete(key)
  const rows = map.get('rows') as Y.Map<Y.Map<unknown>>
  for (const row of table.rows) {
    const existing = rows.get(row.key)
    if (!existing) {
      setRow(rows, row)
      continue
    }
    setIfChanged(existing, 'h', row.h)
    setIfChanged(existing, 'xml', row.xml)
    const cells = existing.get('cells') as Y.Map<Y.Map<unknown>>
    for (const [columnKey, cell] of Object.entries(row.cells)) {
      const current = cells.get(columnKey)
      if (!current) {
        setCell(cells, columnKey, cell)
        continue
      }
      for (const key of CELL_SCALARS) setIfChanged(current, key, cell[key])
      reconcileText(current, 'text', cell.text)
    }
    for (const key of [...cells.keys()]) if (!(key in row.cells)) cells.delete(key)
  }
  syncKeys(map.get('rowOrder') as Y.Array<string>, table.rows.map((row) => row.key))
  for (const key of [...rows.keys()]) if (!table.rows.some((row) => row.key === key)) rows.delete(key)
}

/**
 * Edits `array` into `target` keeping the longest common subsequence in place, so concurrent
 * inserts elsewhere in the array survive and unmoved items are not churned.
 */
export function syncKeys(array: Y.Array<string>, target: string[]): void {
  const current = array.toArray()
  if (current.length === target.length && current.every((key, index) => key === target[index])) return
  const keep = longestCommonSubsequence(current, target)
  for (let index = current.length - 1; index >= 0; index--) if (!keep.current.has(index)) array.delete(index, 1)
  // `array` now holds exactly the kept keys, in target order.
  let position = 0
  target.forEach((key, index) => {
    if (keep.target.has(index)) {
      position++
      return
    }
    array.insert(position, [key])
    position++
  })
}

function longestCommonSubsequence(a: string[], b: string[]): { current: Set<number>; target: Set<number> } {
  // Decks have at most a few thousand slides or shapes; quadratic is fine but cap it anyway.
  if (a.length * b.length > 4_000_000) {
    const shared = new Set(b)
    const indexInB = new Map(b.map((key, index) => [key, index]))
    const current = new Set<number>()
    const target = new Set<number>()
    let last = -1
    a.forEach((key, index) => {
      const at = indexInB.get(key)
      if (shared.has(key) && at !== undefined && at > last) {
        current.add(index)
        target.add(at)
        last = at
      }
    })
    return { current, target }
  }
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    }
  }
  const current = new Set<number>()
  const target = new Set<number>()
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      current.add(i++)
      target.add(j++)
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++
    else j++
  }
  return { current, target }
}
