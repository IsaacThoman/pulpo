import type { LiveAssetRef } from '../live-format.js'
import type { TextJSON } from './text.js'

/**
 * The presentation as plain data. The codec reads a package into this shape, writes it into a
 * Y.Doc (see `ydoc.ts`), reads it back out of a Y.Doc, and writes it as a package. Diffs and
 * `applyFile` compare two of these.
 *
 * What is modeled is editable; everything else stays in XML templates (each shape's own element,
 * each slide's frame) or in raw parts, and is written back as it was.
 */

export { PRESENTATION_SCHEMA_VERSION } from './layout.js'

/** A package part we keep but do not model: masters, layouts, themes, charts, media, … */
export interface PartSnapshot {
  contentType?: string
  /** XML and other small parts, as their exact bytes. */
  bytes?: Uint8Array
  /** Media and other binary parts live in the asset store. */
  asset?: LiveAssetRef
  /** Not reachable through relationships when imported; kept anyway, never garbage collected. */
  orphan?: boolean
}

export interface RelTarget {
  type: string
  /** A part path, or the URL of an external target. */
  target: string
  external?: boolean
}

/** Shape transform in EMU and 60000ths of a degree. Groups also map a child coordinate space. */
export interface Xfrm {
  x: number
  y: number
  cx: number
  cy: number
  rot?: number
  flipH?: boolean
  flipV?: boolean
  chX?: number
  chY?: number
  chCx?: number
  chCy?: number
}

export type ShapeKind = 'sp' | 'pic' | 'cxnSp' | 'grpSp' | 'graphicFrame' | 'opaque'

export interface ShapeSnapshot {
  /** Stable key inside the slide; `s<cNvPr id>` for imported shapes, random for new ones. */
  key: string
  kind: ShapeKind
  /** The element as XML, used as a template for what is not modeled below. */
  xml: string
  /** Relationship ids used inside `xml` (and its text), resolved. */
  rels: Record<string, RelTarget>
  /** `cNvPr/@id`, unique per slide. New shapes have none until written. */
  nvId?: number
  name?: string
  descr?: string
  hidden?: boolean
  xfrm?: Xfrm
  /** `a:prstGeom` or `a:custGeom`, as XML. */
  geom?: string
  /** The `spPr` fill element as XML (`a:solidFill`, `a:noFill`, …). */
  fill?: string
  /** `a:ln` as XML. */
  line?: string
  /** `a:effectLst` as XML. */
  effects?: string
  /** `p:blipFill` of a picture, as XML. */
  blipFill?: string
  /** `a:bodyPr`, as XML. */
  bodyPr?: string
  text?: TextJSON
  table?: TableSnapshot
  /** Group members, in z-order. */
  children?: ShapeSnapshot[]
}

export interface TableColumn {
  key: string
  w: number
  /** `a:gridCol` as XML (keeps its extLst column ids). */
  xml: string
}

export interface TableCell {
  /** `a:tc` as XML, minus paragraphs. */
  xml: string
  text: TextJSON
  gridSpan?: number
  rowSpan?: number
  hMerge?: boolean
  vMerge?: boolean
  /** `a:tcPr` as XML. */
  tcPr?: string
}

export interface TableRow {
  key: string
  h: number
  /** `a:tr` as XML, minus cells. */
  xml: string
  /** Cells by column key. */
  cells: Record<string, TableCell>
}

export interface TableSnapshot {
  /** `a:tblPr` as XML (style id and banding flags). */
  tblPr?: string
  columns: TableColumn[]
  rows: TableRow[]
}

export interface NotesSnapshot {
  /** The notes slide part; new notes get one when written. */
  part?: string
  /** The notes slide XML; the body placeholder's paragraphs are replaced by `text` when it changes. */
  xml: string
  rels: Record<string, RelTarget>
  text: TextJSON
  source?: Uint8Array
  relsSource?: Uint8Array
}

export interface SlideSnapshot {
  /** Stable key; `slide-<sldId>` for imported slides, random for new ones. */
  key: string
  /** `p:sldId/@id`; new slides get one when written. */
  sldId?: number
  /** The slide part; new slides get one when written. */
  part?: string
  /** The layout part this slide uses. */
  layout: string
  hidden: boolean
  /** The slide XML without its shapes, used as a template for everything else. */
  xml: string
  /** `p:bg` as XML. */
  background?: string
  /** Relationships other than layout, notes, and those only shapes use (comments, tags, …). */
  rels: Record<string, RelTarget>
  shapes: ShapeSnapshot[]
  notes?: NotesSnapshot
  /** Section this slide belongs to. */
  section?: string
  /** The slide part and its relationships as read, written back when nothing above changed. */
  source?: Uint8Array
  relsSource?: Uint8Array
}

export interface SectionSnapshot {
  key: string
  name: string
  /** `p14:section/@id`, a GUID. */
  id: string
}

export type PresentationFormat = 'pptx' | 'potx' | 'ppsx' | 'pptm' | 'potm' | 'ppsm'

export interface PresentationSnapshot {
  /** The main part, usually `ppt/presentation.xml`. */
  mainPart: string
  slideWidth: number
  slideHeight: number
  notesWidth: number
  notesHeight: number
  /** Raw parts by path; slides and notes slides are modeled instead. */
  parts: Record<string, PartSnapshot>
  slides: SlideSnapshot[]
  sections: SectionSnapshot[]
}
