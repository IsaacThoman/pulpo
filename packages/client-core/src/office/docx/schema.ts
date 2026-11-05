import { Mark as MarkClass, Schema, type DOMOutputSpec, type Mark, type MarkSpec, type Node as ProseMirrorNode, type NodeSpec } from '@tiptap/pm/model'
import { cssIdent, cssText, emuToPt, mergeCss, paragraphPropertyCss, runPropertyCss, twipsToPt, type CssProps } from './css.js'
import { jmlAttr, jmlChild, jmlElements, jmlNumber, localName, unpackJml, walkJml, type JmlElement } from './jsonml.js'

/**
 * The ProseMirror schema of Word documents. It is separate from the Markdown documents' schema:
 * a paragraph here carries Word's paragraph properties, runs carry Word's run properties, and
 * whatever the editor does not model rides along as JsonML (see `jsonml.ts`).
 *
 * Every property is its own attribute or mark, so two people changing different properties of
 * the same text (one makes it bold, the other red) both win when Yjs merges. Values are JsonML
 * strings of the original elements: they keep every attribute Word wrote, compare by value, and
 * export back verbatim.
 */

/** Paragraph attributes holding one `w:pPr` child each, by element name. */
export const PARAGRAPH_PROPERTY_ATTRS = {
  keepNext: 'w:keepNext',
  keepLines: 'w:keepLines',
  pageBreakBefore: 'w:pageBreakBefore',
  widowControl: 'w:widowControl',
  numPr: 'w:numPr',
  pBdr: 'w:pBdr',
  shd: 'w:shd',
  tabs: 'w:tabs',
  spacing: 'w:spacing',
  ind: 'w:ind',
  contextualSpacing: 'w:contextualSpacing',
  jc: 'w:jc',
  outlineLvl: 'w:outlineLvl',
  bidi: 'w:bidi',
} as const
export type ParagraphPropertyAttr = keyof typeof PARAGRAPH_PROPERTY_ATTRS

/** Run property marks holding one `w:rPr` child each, by element name, in nesting order. */
export const RUN_PROPERTY_MARKS = {
  rStyle: 'w:rStyle',
  rFonts: 'w:rFonts',
  b: 'w:b',
  i: 'w:i',
  caps: 'w:caps',
  smallCaps: 'w:smallCaps',
  strike: 'w:strike',
  dstrike: 'w:dstrike',
  vanish: 'w:vanish',
  color: 'w:color',
  spacing: 'w:spacing',
  scale: 'w:w',
  position: 'w:position',
  sz: 'w:sz',
  highlight: 'w:highlight',
  u: 'w:u',
  shd: 'w:shd',
  vertAlign: 'w:vertAlign',
} as const
export type RunPropertyMark = keyof typeof RUN_PROPERTY_MARKS

export const RUN_MARK_BY_ELEMENT: Record<string, RunPropertyMark> = Object.fromEntries(
  Object.entries(RUN_PROPERTY_MARKS).map(([mark, element]) => [element, mark as RunPropertyMark]),
)

/**
 * Wrapper marks: inline elements that enclose runs. `v` is the wrapper's JsonML with
 * CONTENT_SLOT where its runs go. Outer wrappers come first, as the schema orders marks.
 */
export const WRAPPER_MARKS = {
  link: 'w:hyperlink',
  sdt: 'w:sdt',
  fldSimple: 'w:fldSimple',
  wrap: '',
  moveFrom: 'w:moveFrom',
  moveTo: 'w:moveTo',
  ins: 'w:ins',
  del: 'w:del',
} as const
export type WrapperMark = keyof typeof WRAPPER_MARKS

/** Block-level markers (bookmarks, comment ranges) between blocks ride on a neighbour. */
const markerAttrs = { lead: { default: null }, trail: { default: null } }

function jml(value: unknown): JmlElement | undefined {
  return typeof value === 'string' ? unpackJml<JmlElement>(value) : undefined
}

/** Direct paragraph formatting as inline CSS. */
export function paragraphCss(node: ProseMirrorNode): CssProps {
  const props: CssProps = {}
  for (const key of Object.keys(PARAGRAPH_PROPERTY_ATTRS) as ParagraphPropertyAttr[]) {
    const element = jml(node.attrs[key])
    if (element) mergeCss(props, paragraphPropertyCss(element))
  }
  return props
}

export function paragraphClass(pStyle: string | null | undefined): string {
  return `docx-p docx-ps-${pStyle ? cssIdent(pStyle) : '-default'}`
}

function paragraphToDOM(node: ProseMirrorNode): DOMOutputSpec {
  const style = cssText(paragraphCss(node))
  const attrs: Record<string, string> = { class: paragraphClass(node.attrs.pStyle as string | null) }
  if (style) attrs.style = style
  const outline = jml(node.attrs.outlineLvl)
  if (outline) attrs['data-outline'] = jmlAttr(outline, 'w:val') ?? ''
  if (jml(node.attrs.sectPr)) attrs['data-section-end'] = 'true'
  return ['p', attrs, 0]
}

function widthCss(element: JmlElement | undefined): string | undefined {
  if (!element) return undefined
  const type = jmlAttr(element, 'w:type') ?? 'dxa'
  const value = jmlNumber(element, 'w:w')
  if (value === undefined || type === 'auto' || type === 'nil') return undefined
  if (type === 'pct') {
    const raw = jmlAttr(element, 'w:w') ?? ''
    return raw.endsWith('%') ? raw : `${value / 50}%`
  }
  return `${twipsToPt(value)}pt`
}

export function gridWidths(tblGrid: JmlElement | undefined): number[] {
  return tblGrid ? jmlElements(tblGrid).filter((col) => col[0] === 'w:gridCol').map((col) => jmlNumber(col, 'w:w') ?? 0) : []
}

function tableToDOM(node: ProseMirrorNode): DOMOutputSpec {
  const tblPr = jml(node.attrs.tblPr)
  const widths = gridWidths(jml(node.attrs.tblGrid))
  const props: CssProps = {}
  const width = widthCss(jmlChild(tblPr, 'w:tblW'))
  const total = widths.reduce((sum, value) => sum + value, 0)
  if (width) props.width = width
  else if (total) props.width = `${twipsToPt(total)}pt`
  const indent = jmlNumber(jmlChild(tblPr, 'w:tblInd'), 'w:w')
  const align = jmlAttr(jmlChild(tblPr, 'w:jc'), 'w:val')
  if (align === 'center') {
    props['margin-left'] = 'auto'
    props['margin-right'] = 'auto'
  } else if (align === 'right' || align === 'end') {
    props['margin-left'] = 'auto'
  } else if (indent) {
    props['margin-left'] = `${twipsToPt(indent)}pt`
  }
  if (jmlAttr(jmlChild(tblPr, 'w:tblLayout'), 'w:type') === 'fixed') props['table-layout'] = 'fixed'
  const styleId = jmlAttr(jmlChild(tblPr, 'w:tblStyle'), 'w:val')
  const cols: DOMOutputSpec[] = widths.map((value) => ['col', { style: `width:${twipsToPt(value)}pt` }])
  return ['table', { class: `docx-table${styleId ? ` docx-ts-${cssIdent(styleId)}` : ''}`, style: cssText(props) }, ['colgroup', {}, ...cols] as DOMOutputSpec, ['tbody', 0]]
}

function cellToDOM(node: ProseMirrorNode): DOMOutputSpec {
  const tcPr = jml(node.attrs.tcPr)
  const props: CssProps = {}
  const width = widthCss(jmlChild(tcPr, 'w:tcW'))
  if (width && !width.endsWith('%')) props.width = width
  const vAlign = jmlAttr(jmlChild(tcPr, 'w:vAlign'), 'w:val')
  props['vertical-align'] = vAlign === 'center' ? 'middle' : vAlign === 'bottom' ? 'bottom' : 'top'
  const attrs: Record<string, string> = { style: cssText(props) }
  if ((node.attrs.colspan as number) > 1) attrs.colspan = String(node.attrs.colspan)
  if ((node.attrs.rowspan as number) > 1) attrs.rowspan = String(node.attrs.rowspan)
  if (node.attrs.phantom) attrs['data-phantom'] = String(node.attrs.phantom)
  return ['td', { class: 'docx-cell', ...attrs }, 0]
}

/** EMU extent of a drawing (or the VML shape inside other opaque objects), in points. */
export function drawingSize(element: JmlElement | undefined): { width: number; height: number } | undefined {
  if (!element) return undefined
  let size: { width: number; height: number } | undefined
  walkJml(element, (child) => {
    if (size) return false
    if (child[0] === 'wp:extent') {
      size = { width: emuToPt(jmlNumber(child, 'cx') ?? 0), height: emuToPt(jmlNumber(child, 'cy') ?? 0) }
      return false
    }
    if (child[0] === 'v:shape' || child[0] === 'v:rect' || child[0] === 'v:imagedata') {
      const style = jmlAttr(child, 'style') ?? ''
      const read = (key: string) => {
        const match = new RegExp(`(?:^|;)\\s*${key}\\s*:\\s*([\\d.]+)(pt|in|px|cm|mm)?`).exec(style)
        if (!match) return undefined
        const value = Number(match[1])
        const unit = match[2] ?? 'px'
        return unit === 'pt' ? value : unit === 'in' ? value * 72 : unit === 'cm' ? value * 72 / 2.54 : unit === 'mm' ? value * 72 / 25.4 : value * 0.75
      }
      const width = read('width')
      const height = read('height')
      if (width !== undefined && height !== undefined) size = { width, height }
    }
    return undefined
  })
  return size
}

function hiddenAtom(className: string): NodeSpec['toDOM'] {
  return () => ['span', { class: `docx-hidden ${className}`, contenteditable: 'false' }]
}

/**
 * Inline atoms keep their marks (run properties, hyperlink, revision…) in a `marks` attribute:
 * Yjs only stores marks on text, so marks on other inline nodes would vanish when synced. See
 * `inlineMarks` and the view's normalizer.
 */
const inlineAtom = (attrs: NodeSpec['attrs'], toDOM: NodeSpec['toDOM'], extra: Partial<NodeSpec> = {}): NodeSpec => ({
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  attrs: { v: { default: null }, marks: { default: null }, ...attrs },
  toDOM,
  ...extra,
})

/** Symbols in symbol fonts, as the Unicode characters most fonts can draw. */
export const SYMBOL_CHARS: Record<string, string> = {
  F0B7: '•', F0A7: '▪', F0A8: '◆', F0D8: '➢', F076: '❖', F0FC: '✓', F06F: '□', F0E0: '→', F0E8: '➔',
  F0D5: '⌫', F06E: '■', F071: '❑', F0A9: '©', F0E3: '↓', F0F0: '⇨', F04A: '☺', F0B3: '≥', F0A3: '≤',
  F0B4: '×', F0B8: '÷', F0B1: '±', F0B0: '°', F0A5: '∞', F0BB: '≈', F0B9: '≠', F070: 'π', F061: 'α',
  F062: 'β', F067: 'γ', F064: 'δ', F06D: 'μ', F073: 'σ', F077: 'ω', F0D6: '√', F0E5: '∑', F0F2: '∫',
}

export function symbolText(font: string | undefined, code: string | undefined): string {
  if (!code) return ''
  const key = code.toUpperCase().padStart(4, '0')
  const mapped = SYMBOL_CHARS[key.startsWith('F') ? key : `F0${key.slice(2)}`]
  if (mapped && /symbol|wingdings|webdings/i.test(font ?? 'Symbol')) return mapped
  const value = Number.parseInt(key, 16)
  // Symbol fonts map their glyphs into U+F0xx; outside those fonts the low byte is the character.
  return Number.isFinite(value) ? String.fromCodePoint(value >= 0xf000 && value <= 0xf0ff ? value - 0xf000 : value) : ''
}

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },
  paragraph: {
    group: 'block',
    content: 'inline*',
    attrs: {
      pStyle: { default: null },
      ...Object.fromEntries(Object.keys(PARAGRAPH_PROPERTY_ATTRS).map((key) => [key, { default: null }])),
      /** Other `w:pPr` children, as a JsonML array. */
      pPrRest: { default: null },
      /** The paragraph mark's `w:rPr` (its formatting and revision marks). */
      markRPr: { default: null },
      /** The section this paragraph ends, if any. */
      sectPr: { default: null },
      pPrChange: { default: null },
      /** Attributes of `w:p` itself (`w14:paraId`, rsids). */
      xmlAttrs: { default: null },
      ...markerAttrs,
    },
    toDOM: paragraphToDOM,
    parseDOM: [{ tag: 'p' }],
  },
  table: {
    group: 'block',
    content: 'tableRow+',
    tableRole: 'table',
    isolating: true,
    /** `rowTrail`: markers after the last row, inside the table. */
    attrs: { tblPr: { default: null }, tblGrid: { default: null }, xmlAttrs: { default: null }, rowTrail: { default: null }, ...markerAttrs },
    toDOM: tableToDOM,
    parseDOM: [{ tag: 'table' }],
  },
  tableRow: {
    content: 'tableCell*',
    tableRole: 'row',
    attrs: { trPr: { default: null }, tblPrEx: { default: null }, xmlAttrs: { default: null }, wrap: { default: null }, lead: { default: null }, cellTrail: { default: null } },
    toDOM: () => ['tr', { class: 'docx-row' }, 0],
    parseDOM: [{ tag: 'tr' }],
  },
  tableCell: {
    content: 'block+',
    tableRole: 'cell',
    isolating: true,
    attrs: {
      colspan: { default: 1 },
      rowspan: { default: 1 },
      colwidth: { default: null },
      tcPr: { default: null },
      /** `w:tc` elements of the vertically merged cells below this one, as a JsonML array. */
      vMergeCells: { default: null },
      /** Stands for `w:gridBefore`/`w:gridAfter` columns a row leaves out. */
      phantom: { default: null },
      xmlAttrs: { default: null },
      wrap: { default: null },
      /** Markers and empty controls before this cell, inside the row. */
      lead: { default: null },
    },
    toDOM: cellToDOM,
    parseDOM: [{
      tag: 'td',
      getAttrs: (dom) => ({
        colspan: Number((dom as HTMLElement).getAttribute('colspan') ?? 1) || 1,
        rowspan: Number((dom as HTMLElement).getAttribute('rowspan') ?? 1) || 1,
      }),
    }, {
      tag: 'th',
      getAttrs: (dom) => ({
        colspan: Number((dom as HTMLElement).getAttribute('colspan') ?? 1) || 1,
        rowspan: Number((dom as HTMLElement).getAttribute('rowspan') ?? 1) || 1,
      }),
    }],
  },
  /** A block content control or custom XML element; `v` holds it with CONTENT_SLOT for its blocks. */
  blockWrapper: {
    group: 'block',
    content: 'block+',
    attrs: { v: { default: null }, ...markerAttrs },
    toDOM: (node) => ['div', { class: `docx-wrapper docx-wrapper-${localName(jml(node.attrs.v)?.[0] ?? 'x')}` }, 0],
  },
  /** A block the editor keeps but does not edit (an embedded chunk, unknown XML). */
  blockXml: {
    group: 'block',
    atom: true,
    selectable: true,
    attrs: { v: { default: null }, ...markerAttrs },
    toDOM: (node) => ['div', { class: 'docx-opaque-block', contenteditable: 'false', 'data-name': jml(node.attrs.v)?.[0] ?? '' }],
  },
  text: { group: 'inline' },
  tab: inlineAtom({}, () => ['span', { class: 'docx-tab' }, '\t']),
  break: inlineAtom({ type: { default: 'textWrapping' } }, (node) => {
    const type = node.attrs.type as string
    if (type === 'page') return ['span', { class: 'docx-break docx-page-break', contenteditable: 'false' }]
    if (type === 'column') return ['span', { class: 'docx-break docx-column-break', contenteditable: 'false' }]
    return ['br']
  }, { selectable: false }),
  drawing: inlineAtom({ src: { default: null } }, (node) => {
    const size = drawingSize(jml(node.attrs.v))
    return ['span', {
      class: 'docx-drawing',
      contenteditable: 'false',
      style: size ? `width:${size.width}pt;height:${size.height}pt` : '',
    }]
  }, { draggable: true }),
  noteRef: inlineAtom({ kind: { default: 'footnote' }, id: { default: null } }, (node) => ['sup', { class: 'docx-noteref', contenteditable: 'false', 'data-note': `${node.attrs.kind}:${node.attrs.id}` }]),
  commentMark: inlineAtom({ edge: { default: 'start' }, id: { default: null } }, hiddenAtom('docx-comment-mark'), { selectable: false }),
  bookmark: inlineAtom({ edge: { default: 'start' }, id: { default: null }, name: { default: null } }, hiddenAtom('docx-bookmark'), { selectable: false }),
  fieldChar: inlineAtom({ charType: { default: 'begin' } }, hiddenAtom('docx-field-char'), { selectable: false }),
  fieldCode: inlineAtom({}, hiddenAtom('docx-field-code'), { selectable: false }),
  sym: inlineAtom({}, (node) => {
    const element = jml(node.attrs.v)
    return ['span', { class: 'docx-sym', contenteditable: 'false' }, symbolText(jmlAttr(element, 'w:font'), jmlAttr(element, 'w:char'))]
  }),
  math: inlineAtom({}, () => ['span', { class: 'docx-math', contenteditable: 'false' }]),
  /** Anything else inside a paragraph, kept as is. `inRun` says whether it sits in a `w:r`. */
  inlineXml: inlineAtom({ inRun: { default: false } }, (node) => ['span', {
    class: 'docx-opaque-inline',
    contenteditable: 'false',
    'data-name': jml(node.attrs.v)?.[0] ?? '',
  }]),
}

function runMarkSpec(): MarkSpec {
  return {
    attrs: { v: { default: null } },
    toDOM: (mark: Mark) => {
      const element = jml(mark.attrs.v)
      const css = element ? runPropertyCss(element) : undefined
      return ['span', css ? { style: cssText(css) } : {}, 0]
    },
  }
}

const marks: Record<string, MarkSpec> = {
  link: {
    attrs: { v: { default: null }, href: { default: null } },
    inclusive: false,
    toDOM: (mark) => {
      const anchor = jmlAttr(jml(mark.attrs.v), 'w:anchor')
      const href = (mark.attrs.href as string | null) ?? (anchor ? `#${anchor}` : null)
      return ['a', { class: 'docx-link', ...(href && /^(https?:|mailto:|#)/i.test(href) ? { href } : {}), rel: 'noopener noreferrer nofollow' }, 0]
    },
    parseDOM: [{ tag: 'a[href]', getAttrs: (dom) => ({ href: (dom as HTMLElement).getAttribute('href') }) }],
  },
  sdt: { attrs: { v: { default: null }, level: { default: 0 } }, excludes: '', inclusive: false, toDOM: () => ['span', { class: 'docx-sdt' }, 0] },
  fldSimple: { attrs: { v: { default: null } }, inclusive: false, toDOM: () => ['span', { class: 'docx-field' }, 0] },
  wrap: { attrs: { v: { default: null }, level: { default: 0 } }, excludes: '', inclusive: false, toDOM: () => ['span', {}, 0] },
  moveFrom: { attrs: { v: { default: null } }, inclusive: false, toDOM: () => ['del', { class: 'docx-move-from' }, 0] },
  moveTo: { attrs: { v: { default: null } }, inclusive: false, toDOM: () => ['ins', { class: 'docx-move-to' }, 0] },
  ins: { attrs: { v: { default: null } }, inclusive: false, toDOM: () => ['ins', { class: 'docx-ins' }, 0] },
  del: { attrs: { v: { default: null } }, inclusive: false, toDOM: () => ['del', { class: 'docx-del' }, 0] },
  ...Object.fromEntries(Object.keys(RUN_PROPERTY_MARKS).map((name) => [name, runMarkSpec()])),
  rStyle: {
    attrs: { v: { default: null } },
    toDOM: (mark) => {
      const id = jmlAttr(jml(mark.attrs.v), 'w:val')
      return ['span', id ? { class: `docx-cs-${cssIdent(id)}` } : {}, 0]
    },
  },
  /** Other `w:rPr` children, as a JsonML array. */
  rPrRest: {
    attrs: { v: { default: null } },
    toDOM: (mark) => {
      const elements = typeof mark.attrs.v === 'string' ? unpackJml<JmlElement[]>(mark.attrs.v) ?? [] : []
      const props: CssProps = {}
      for (const element of elements) mergeCss(props, runPropertyCss(element))
      const lang = elements.find((element) => element[0] === 'w:lang')
      const langValue = jmlAttr(lang, 'w:val')
      return ['span', { ...(Object.keys(props).length ? { style: cssText(props) } : {}), ...(langValue ? { lang: langValue } : {}) }, 0]
    },
  },
  /** A tracked formatting change: `v` is the `w:rPrChange` with the formatting before it. */
  rPrChange: { attrs: { v: { default: null } }, toDOM: () => ['span', { class: 'docx-format-change' }, 0] },
}

// `rStyle` must stay outermost among run properties: keep the wrappers, then rStyle, then the rest.
const orderedMarks: Record<string, MarkSpec> = {}
for (const name of Object.keys(WRAPPER_MARKS)) orderedMarks[name] = marks[name]!
orderedMarks.rStyle = marks.rStyle!
for (const name of Object.keys(RUN_PROPERTY_MARKS)) if (name !== 'rStyle') orderedMarks[name] = marks[name]!
orderedMarks.rPrRest = marks.rPrRest!
orderedMarks.rPrChange = marks.rPrChange!

let schema: Schema | undefined

const markCache = new Map<string, readonly Mark[]>()

/** Custom note marks are supplied as following text, outside automatic numbering. */
export function hasCustomNoteMark(node: ProseMirrorNode): boolean {
  const value = jmlAttr(unpackJml<JmlElement>(node.attrs.v), 'w:customMarkFollows')
  return value !== undefined && !['0', 'false', 'off'].includes(value)
}

/** The marks of an inline node: a text node's own, or an atom's from its `marks` attribute. */
export function inlineMarks(node: ProseMirrorNode): readonly Mark[] {
  if (node.isText || node.marks.length) return node.marks
  const packed = node.attrs.marks as string | null | undefined
  if (!packed) return node.marks
  let marks: readonly Mark[] | undefined = markCache.get(packed)
  if (!marks) {
    try {
      const json = JSON.parse(packed) as { type: string; attrs?: Record<string, unknown> }[]
      marks = MarkClass.setFrom(json.filter((mark) => node.type.schema.marks[mark.type]).map((mark) => node.type.schema.markFromJSON(mark)))
    } catch {
      marks = []
    }
    if (markCache.size > 5_000) markCache.clear()
    markCache.set(packed, marks)
  }
  return marks ?? []
}

/** The `marks` attribute value for an atom carrying `marks`. */
export function packMarks(marks: readonly Mark[]): string | null {
  return marks.length ? JSON.stringify(marks.map((mark) => mark.toJSON())) : null
}

export function docxSchema(): Schema {
  schema ??= new Schema({ nodes, marks: orderedMarks })
  return schema
}

export const DOCX_INLINE_ATOMS = ['tab', 'break', 'drawing', 'noteRef', 'commentMark', 'bookmark', 'fieldChar', 'fieldCode', 'sym', 'math', 'inlineXml'] as const

/** Width in points of a `w:pgSz`/`w:pgMar` pair's text area. */
export function textAreaWidth(sectPr: JmlElement | undefined): number {
  const pgSz = jmlChild(sectPr, 'w:pgSz')
  const pgMar = jmlChild(sectPr, 'w:pgMar')
  const width = jmlNumber(pgSz, 'w:w') ?? 12240
  const left = jmlNumber(pgMar, 'w:left') ?? 1440
  const right = jmlNumber(pgMar, 'w:right') ?? 1440
  return twipsToPt(width - left - right)
}
