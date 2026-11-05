import { DOMParser as PMDOMParser, DOMSerializer, Fragment, Slice, type Node as ProseMirrorNode, type ParseRule, type Schema } from '@tiptap/pm/model'
import { jmlAttr, jmlChild, jmlChildren, packJml, unpackJml, type JmlElement, type JmlNode } from '../jsonml.js'
import { HIGHLIGHT_COLORS } from '../css.js'
import { DOCX_MAX_TABLE_DEPTH } from '../format.js'
import { effectiveNumPr } from '../numbering.js'
import type { StyleSheet } from '../styles.js'
import { freshId, type MapEdit } from './commands.js'

/**
 * Copy and paste. Between docx editors everything round-trips exactly: the clipboard carries a
 * copy id and the content comes from memory (`rememberCopy`). From Word, Google Docs, and web pages, the HTML is
 * first made inert (no scripts, styles, frames, event handlers, or remote URLs) and then read
 * into paragraphs, headings, lists, tables, links, and the run formatting the schema models.
 */

const COPY_ATTR = 'data-docx-copy'
const COPY_KEY = 'pulpo-docx-copy'
const COPY_ID = /data-docx-copy="([0-9a-f]{32})"/

/** How long another tab may paste a copy back from local storage. */
const COPY_LIFETIME_MS = 60 * 60 * 1000

/** Recent copies by id: the slice as JSON and where it came from (document and story). */
interface StoredCopy { json: string; origin: string; numberedJson?: string; numbering?: Record<string, string> }
const copies = new Map<string, StoredCopy>()
let currentCopy: string | null = null

export interface RecalledCopy {
  slice: Slice
  /** Style numbering made explicit only when crossing document boundaries. */
  numberedSlice?: Slice
  /** `rememberCopy`'s origin: the document and story it was copied from. */
  origin: string
  /** Raw definitions preserve list levels and overrides in another document. */
  numbering?: Record<string, string>
}

/**
 * Remembers a slice being copied or dragged, for pasting it back exactly. The clipboard only
 * carries the copy's random id; the content comes from this origin's memory (and local storage,
 * for other tabs), so nothing another site or app puts on the clipboard is trusted as a Pulpo copy,
 * and a leaked id can only paste back what the user copied.
 */
export function rememberCopy(slice: Slice, origin: string, numbering?: { get(key: string): unknown }, styles?: StyleSheet): Slice {
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')
  const json = JSON.stringify(slice.toJSON())
  const definitions: Record<string, string> = {}
  const explicit = (fragment: Fragment): Fragment => {
    const children: ProseMirrorNode[] = []
    fragment.forEach((node) => {
      let attrs = node.attrs
      if (styles && node.type.name === 'paragraph' && !attrs.numPr) {
        const list = effectiveNumPr(undefined, attrs.pStyle as string | null, styles)
        if (list) attrs = { ...attrs, numPr: packJml(['w:numPr', {}, ['w:ilvl', { 'w:val': String(list.ilvl) }], ['w:numId', { 'w:val': list.numId }]]) }
      }
      children.push(node.isText ? node : node.type.create(attrs, node.isLeaf ? null : explicit(node.content), node.marks))
    })
    return Fragment.fromArray(children)
  }
  const numberedSlice = new Slice(explicit(slice.content), slice.openStart, slice.openEnd)
  const numberedJson = JSON.stringify(numberedSlice.toJSON())
  numberedSlice.content.descendants((node) => {
    if (node.type.name !== 'paragraph') return true
    const numPr = unpackJml<JmlElement>(node.attrs.numPr as string | null)
    const numId = jmlAttr(jmlChild(numPr, 'w:numId'), 'w:val')
    const num = numId ? numbering?.get(`num:${numId}`) : undefined
    if (typeof num !== 'string') return false
    definitions[`num:${numId}`] = num
    const abstractId = jmlAttr(jmlChild(unpackJml<JmlElement>(num), 'w:abstractNumId'), 'w:val')
    const abstract = abstractId ? numbering?.get(`abstract:${abstractId}`) : undefined
    if (typeof abstract === 'string') definitions[`abstract:${abstractId}`] = abstract
    return false
  })
  copies.set(id, { json, origin, numberedJson, numbering: definitions })
  if (copies.size > 8) copies.delete(copies.keys().next().value!)
  try {
    localStorage.setItem(COPY_KEY, JSON.stringify({ id, json, origin, numberedJson, numbering: definitions, at: Date.now() }))
  } catch {
    // Too large or no storage: other tabs paste the HTML instead.
  }
  currentCopy = id
  return slice
}

/** The remembered slice clipboard HTML refers to, if it is one of this origin's copies. */
export function recallCopy(html: string | undefined, schema: Schema): RecalledCopy | null {
  const id = html ? COPY_ID.exec(html)?.[1] : undefined
  if (!id) return null
  let copy = copies.get(id)
  if (!copy) {
    try {
      const stored = JSON.parse(localStorage.getItem(COPY_KEY) ?? 'null') as { id?: string; json?: string; origin?: string; numberedJson?: string; numbering?: Record<string, string>; at?: number } | null
      if (stored && (typeof stored.at !== 'number' || Date.now() - stored.at > COPY_LIFETIME_MS)) localStorage.removeItem(COPY_KEY)
      else if (stored?.id === id && typeof stored.json === 'string' && typeof stored.origin === 'string') copy = { json: stored.json, origin: stored.origin, numberedJson: stored.numberedJson, numbering: stored.numbering }
    } catch {
      return null
    }
  }
  if (!copy) return null
  try {
    return { slice: Slice.fromJSON(schema, JSON.parse(copy.json)), numberedSlice: copy.numberedJson ? Slice.fromJSON(schema, JSON.parse(copy.numberedJson)) : undefined, origin: copy.origin, numbering: copy.numbering }
  } catch {
    return null
  }
}

/** Lists belong to their document: import only used definitions and give them fresh ids. */
export function importCopiedNumbering(slice: Slice, definitions: RecalledCopy['numbering'], keys: Iterable<string>): { slice: Slice; maps: MapEdit[] } {
  const maps: MapEdit[] = []
  const used = [...keys]
  const nums = new Map<string, string | null>()
  const abstracts = new Map<string, string>()
  const fresh = (prefix: string) => freshId([...used, ...maps.map(([, key]) => key)], prefix)
  const importNum = (id: string): string | null => {
    if (nums.has(id)) return nums.get(id)!
    nums.set(id, null)
    const raw = definitions?.[`num:${id}`]
    const num = typeof raw === 'string' ? unpackJml<JmlElement>(raw) : undefined
    const abstractId = jmlAttr(jmlChild(num, 'w:abstractNumId'), 'w:val')
    const abstractRaw = abstractId ? definitions?.[`abstract:${abstractId}`] : undefined
    const abstract = typeof abstractRaw === 'string' ? unpackJml<JmlElement>(abstractRaw) : undefined
    if (num?.[0] !== 'w:num' || abstract?.[0] !== 'w:abstractNum') return null
    let newAbstract = abstracts.get(abstractId!)
    if (!newAbstract) {
      newAbstract = fresh('abstract')
      maps.push(['numbering', `abstract:${newAbstract}`, packJml([abstract[0], { ...abstract[1], 'w:abstractNumId': newAbstract }, ...jmlChildren(abstract)])])
      abstracts.set(abstractId!, newAbstract)
    }
    const newNum = fresh('num')
    maps.push(['numbering', `num:${newNum}`, packJml([num[0], { ...num[1], 'w:numId': newNum }, ...jmlChildren(num).map((child) =>
      Array.isArray(child) && child[0] === 'w:abstractNumId' ? [child[0], { ...child[1], 'w:val': newAbstract }] as JmlElement : child)])])
    nums.set(id, newNum)
    return newNum
  }
  const remap = (fragment: Fragment): Fragment => {
    const children: ProseMirrorNode[] = []
    fragment.forEach((node) => {
      let attrs = node.attrs
      if (node.type.name === 'paragraph' && attrs.numPr) {
        const numPr = unpackJml<JmlElement>(attrs.numPr as string)
        const id = jmlAttr(jmlChild(numPr, 'w:numId'), 'w:val')
        const newId = id ? importNum(id) : null
        // Older copies have no definitions. Never leave an unresolved foreign numId behind.
        attrs = { ...attrs, numPr: newId && numPr ? packJml([numPr[0], numPr[1], ...jmlChildren(numPr).map((child) =>
          Array.isArray(child) && child[0] === 'w:numId' ? [child[0], { ...child[1], 'w:val': newId }] as JmlElement : child)]) : null }
      }
      children.push(node.isText ? node : node.type.create(attrs, node.isLeaf ? null : remap(node.content), node.marks))
    })
    return Fragment.fromArray(children)
  }
  return { slice: new Slice(remap(slice.content), slice.openStart, slice.openEnd), maps }
}

/** Relationship attributes the exporter rewrites for whichever part content lands in. */
const PORTABLE_RELATIONSHIPS: Record<string, string> = { 'a:blip': 'r:embed', 'v:imagedata': 'r:id' }

/** Whether a stored attribute value (JsonML, or JSON of XML attributes) refers to a relationship of its part. */
function bindsRelationship(value: unknown): boolean {
  if (typeof value !== 'string' || !/"r:[A-Za-z]+"/.test(value)) return false
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return true
  }
  const visit = (node: unknown): boolean => {
    if (!Array.isArray(node)) return false
    const [name, attrs] = node as [unknown, unknown]
    if (typeof name === 'string' && attrs && typeof attrs === 'object' && !Array.isArray(attrs)) {
      for (const key of Object.keys(attrs)) if (key.startsWith('r:') && PORTABLE_RELATIONSHIPS[name] !== key) return true
    }
    return node.some((child) => Array.isArray(child) && visit(child))
  }
  if (Array.isArray(parsed)) return visit(parsed) || parsed.some((child) => visit(child))
  if (parsed && typeof parsed === 'object') return Object.keys(parsed).some((key) => key.startsWith('r:'))
  return false
}

/**
 * Content copied from another document or story, minus what refers to relationships of the part
 * it came from (charts, embedded objects, SmartArt, section references): those would point at
 * nothing, or at the wrong part, here. Pictures and links are rewritten on export, so they stay.
 */
export function withoutForeignParts(slice: Slice): Slice {
  const clean = (fragment: Fragment): Fragment => {
    const children: ProseMirrorNode[] = []
    fragment.forEach((child) => {
      const marks = child.marks.filter((mark) => mark.type.name === 'link' || !Object.values(mark.attrs).some(bindsRelationship))
      const bound = Object.entries(child.attrs).filter(([, value]) => bindsRelationship(value))
      if (bound.length && (child.isInline || child.type.name === 'blockXml')) return
      const attrs: Record<string, unknown> = { ...child.attrs }
      for (const [key] of bound) attrs[key] = (child.type.spec.attrs?.[key] as { default?: unknown } | undefined)?.default ?? null
      if (child.isText) children.push(child.mark(marks))
      else {
        // Containers left empty (a cell whose only block went) get the content they need.
        const node = child.type.createAndFill(attrs, child.isLeaf ? null : clean(child.content), marks)
        if (node) children.push(node)
      }
    })
    return Fragment.fromArray(children)
  }
  return new Slice(clean(slice.content), slice.openStart, slice.openEnd)
}

const STORY_REFERENCES = new Set(['w:commentRangeStart', 'w:commentRangeEnd', 'w:commentReference', 'w:footnoteReference', 'w:endnoteReference'])

/** Opaque XML can carry the same story references as the inline nodes. */
function withoutPackedStoryReferences(value: unknown, fallback: unknown): unknown {
  if (typeof value !== 'string') return value
  const parsed = unpackJml<JmlNode | JmlNode[]>(value)
  if (!Array.isArray(parsed)) return value
  let changed = false
  const clean = (node: JmlNode): JmlNode[] => {
    if (!Array.isArray(node)) return [node]
    if (STORY_REFERENCES.has(node[0])) {
      changed = true
      return []
    }
    return [[node[0], node[1], ...jmlChildren(node).flatMap(clean)]]
  }
  const elements = typeof parsed[0] === 'string' ? clean(parsed as JmlElement) : (parsed as JmlNode[]).flatMap(clean)
  if (!changed) return value
  return elements.length ? packJml(typeof parsed[0] === 'string' ? elements[0]! : elements) : fallback
}

/** Notes and comments belong to their document; a copied id could name an unrelated story here. */
export function withoutStoryReferences(slice: Slice): Slice {
  const clean = (fragment: Fragment): Fragment => {
    const children: ProseMirrorNode[] = []
    fragment.forEach((child) => {
      if (child.type.name === 'noteRef' || child.type.name === 'commentMark') return
      const attrs = Object.fromEntries(Object.entries(child.attrs).map(([key, value]) => [
        key, withoutPackedStoryReferences(value, (child.type.spec.attrs?.[key] as { default?: unknown } | undefined)?.default ?? null),
      ]))
      children.push(child.isText ? child : child.type.create(attrs, child.isLeaf ? null : clean(child.content), child.marks))
    })
    return Fragment.fromArray(children)
  }
  return new Slice(clean(slice.content), slice.openStart, slice.openEnd)
}

/** Serializes copies as ordinary HTML for other apps, marked with the copy's id for Pulpo. */
export function clipboardSerializer(schema: Schema): DOMSerializer {
  const base = DOMSerializer.fromSchema(schema)
  return new (class extends DOMSerializer {
    override serializeFragment(...args: Parameters<DOMSerializer['serializeFragment']>) {
      const result = super.serializeFragment(...args)
      if (currentCopy) for (const child of Array.from(result.childNodes)) if (child.nodeType === 1) (child as HTMLElement).setAttribute(COPY_ATTR, currentCopy)
      return result
    }
  })(base.nodes, base.marks)
}

/** Most columns and rows a pasted table may span; Word allows 63 columns. */
const PASTE_MAX_SPAN = { columns: 63, rows: 1_000 }
/** Most grid positions in one pasted table, as for imported files. */
const PASTE_MAX_TABLE_CELLS = 250_000
/** Deepest table nesting, as for imported files. */
const PASTE_MAX_TABLE_DEPTH = DOCX_MAX_TABLE_DEPTH

/**
 * Pasted tables too large to keep as tables (which editors fill out cell by cell), or nested
 * deeper than `maxDepth` more levels, become their cells' paragraphs.
 */
export function limitPastedTables(slice: Slice, maxDepth = PASTE_MAX_TABLE_DEPTH): Slice {
  let flattened = false
  const shrink = (fragment: Fragment, depth: number): Fragment => {
    const children: ProseMirrorNode[] = []
    fragment.forEach((child) => {
      if (child.type.name === 'table') {
        let width = 0
        child.forEach((row) => {
          let span = 0
          row.forEach((cell) => { span += Math.max(1, Number(cell.attrs.colspan) || 1) })
          width = Math.max(width, span)
        })
        if (width > PASTE_MAX_SPAN.columns || width * child.childCount > PASTE_MAX_TABLE_CELLS || depth >= maxDepth) {
          flattened = true
          child.forEach((row) => row.forEach((cell) => shrink(cell.content, depth).forEach((block) => { children.push(block) })))
          return
        }
        children.push(child.copy(shrink(child.content, depth + 1)))
        return
      }
      children.push(child.isLeaf ? child : child.copy(shrink(child.content, depth)))
    })
    return Fragment.fromArray(children)
  }
  const content = shrink(slice.content, 0)
  if (!flattened) return slice
  // A copy that started or ended inside a flattened table is open no deeper than its content now is.
  const open = Slice.maxOpen(content)
  return new Slice(content, Math.min(slice.openStart, open.openStart), Math.min(slice.openEnd, open.openEnd))
}

const span = (value: string | null, max: number) => Math.min(max, Math.max(1, Number(value) || 1))

const element = (name: string, attrs: Record<string, string> = {}): string => packJml([name, attrs])

function pointsFromCss(value: string): number | undefined {
  const match = /^([\d.]+)(pt|px|em|rem)?$/.exec(value.trim())
  if (!match) return undefined
  const number = Number(match[1])
  switch (match[2]) {
    case 'px': return number * 0.75
    case 'em':
    case 'rem': return number * 11
    default: return number
  }
}

function hexFromCss(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed.slice(1)
  if (/^#[0-9a-f]{3}$/.test(trimmed)) return trimmed.slice(1).split('').map((char) => char + char).join('')
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(trimmed)
  if (rgb) {
    if (rgb[4] !== undefined && Number(rgb[4]) === 0) return undefined
    return [rgb[1], rgb[2], rgb[3]].map((channel) => Number(channel).toString(16).padStart(2, '0')).join('')
  }
  return undefined
}

/** The Word highlight name closest to a CSS background color. */
function nearestHighlight(hex: string): string {
  const parse = (value: string) => [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16))
  const target = parse(hex)
  let best = 'yellow'
  let bestDistance = Infinity
  for (const [name, color] of Object.entries(HIGHLIGHT_COLORS)) {
    const channels = parse(color.slice(1))
    const distance = channels.reduce((sum, channel, index) => sum + (channel - target[index]!) ** 2, 0)
    if (distance < bestDistance) {
      bestDistance = distance
      best = name
    }
  }
  return best
}

const ALIGNMENTS: Record<string, string> = { left: 'left', start: 'left', center: 'center', right: 'right', end: 'right', justify: 'both' }

function paragraphAttrs(dom: HTMLElement, pStyle: string | null): Record<string, unknown> {
  const attrs: Record<string, unknown> = { pStyle }
  const align = ALIGNMENTS[dom.style?.textAlign ?? '']
  if (align && align !== 'left') attrs.jc = element('w:jc', { 'w:val': align })
  const list = dom.getAttribute('data-docx-list')
  if (list) attrs.xmlAttrs = JSON.stringify({ 'pulpo:list': list, 'pulpo:level': dom.getAttribute('data-docx-level') ?? '0' })
  return attrs
}

/** Parse rules for pasted HTML (Pulpo's own copies come back through `recallCopy` instead). */
export function clipboardParser(schema: Schema): PMDOMParser {
  const rules: ParseRule[] = []
  for (let level = 1; level <= 6; level++) {
    rules.push({ tag: `h${level}`, node: 'paragraph', getAttrs: (dom) => paragraphAttrs(dom as HTMLElement, `Heading${level}`) })
  }
  rules.push(
    { tag: 'p', node: 'paragraph', getAttrs: (dom) => paragraphAttrs(dom as HTMLElement, null) },
    { tag: 'li', node: 'paragraph', getAttrs: (dom) => paragraphAttrs(dom as HTMLElement, null) },
    { tag: 'blockquote', node: 'paragraph', getAttrs: (dom) => paragraphAttrs(dom as HTMLElement, 'Quote') },
    { tag: 'pre', node: 'paragraph', preserveWhitespace: 'full', getAttrs: (dom) => paragraphAttrs(dom as HTMLElement, null) },
    { tag: 'table', node: 'table' },
    { tag: 'tr', node: 'tableRow' },
    { tag: 'td', node: 'tableCell', getAttrs: (dom) => ({ colspan: span((dom as HTMLElement).getAttribute('colspan'), PASTE_MAX_SPAN.columns), rowspan: span((dom as HTMLElement).getAttribute('rowspan'), PASTE_MAX_SPAN.rows) }) },
    { tag: 'th', node: 'tableCell', getAttrs: (dom) => ({ colspan: span((dom as HTMLElement).getAttribute('colspan'), PASTE_MAX_SPAN.columns), rowspan: span((dom as HTMLElement).getAttribute('rowspan'), PASTE_MAX_SPAN.rows) }) },
    { tag: 'br', node: 'break', getAttrs: () => ({ type: 'textWrapping', v: element('w:br') }) },
    { tag: 'a[href]', mark: 'link', getAttrs: (dom) => {
      const href = (dom as HTMLElement).getAttribute('href') ?? ''
      return /^(https?:|mailto:)/i.test(href) ? { href, v: packJml(['w:hyperlink', { 'w:history': '1' }, '\u0000']) } : false
    } },
    { tag: 'strong', mark: 'b', getAttrs: () => ({ v: element('w:b') }) },
    { tag: 'b', mark: 'b', getAttrs: (dom) => /^(normal|[1-5]00)$/.test((dom as HTMLElement).style.fontWeight) ? false : { v: element('w:b') } },
    { tag: 'em', mark: 'i', getAttrs: () => ({ v: element('w:i') }) },
    { tag: 'i', mark: 'i', getAttrs: () => ({ v: element('w:i') }) },
    { tag: 'u', mark: 'u', getAttrs: () => ({ v: element('w:u', { 'w:val': 'single' }) }) },
    { tag: 's', mark: 'strike', getAttrs: () => ({ v: element('w:strike') }) },
    { tag: 'strike', mark: 'strike', getAttrs: () => ({ v: element('w:strike') }) },
    { tag: 'del', mark: 'strike', getAttrs: () => ({ v: element('w:strike') }) },
    { tag: 'sup', mark: 'vertAlign', getAttrs: () => ({ v: element('w:vertAlign', { 'w:val': 'superscript' }) }) },
    { tag: 'sub', mark: 'vertAlign', getAttrs: () => ({ v: element('w:vertAlign', { 'w:val': 'subscript' }) }) },
    { style: 'font-weight', mark: 'b', getAttrs: (value) => (/^(bold|bolder|[6-9]00)$/.test(value) ? { v: element('w:b') } : false) },
    { style: 'font-style', mark: 'i', getAttrs: (value) => (value === 'italic' || value === 'oblique' ? { v: element('w:i') } : false) },
    { style: 'text-decoration', mark: 'u', getAttrs: (value) => (value.includes('underline') ? { v: element('w:u', { 'w:val': 'single' }) } : false) },
    { style: 'text-decoration-line', mark: 'u', getAttrs: (value) => (value.includes('underline') ? { v: element('w:u', { 'w:val': 'single' }) } : false) },
    { style: 'text-decoration', mark: 'strike', getAttrs: (value) => (value.includes('line-through') ? { v: element('w:strike') } : false) },
    { style: 'vertical-align', mark: 'vertAlign', getAttrs: (value) => (value === 'super' ? { v: element('w:vertAlign', { 'w:val': 'superscript' }) } : value === 'sub' ? { v: element('w:vertAlign', { 'w:val': 'subscript' }) } : false) },
    { style: 'color', mark: 'color', getAttrs: (value) => {
      const hex = hexFromCss(value)
      return hex && hex !== '000000' ? { v: element('w:color', { 'w:val': hex.toUpperCase() }) } : false
    } },
    { style: 'background-color', mark: 'highlight', getAttrs: (value) => {
      const hex = hexFromCss(value)
      return hex && hex !== 'ffffff' ? { v: element('w:highlight', { 'w:val': nearestHighlight(hex) }) } : false
    } },
    { style: 'font-size', mark: 'sz', getAttrs: (value) => {
      const points = pointsFromCss(value)
      return points && points >= 1 && points <= 1638 ? { v: element('w:sz', { 'w:val': String(Math.round(points * 2)) }) } : false
    } },
    { style: 'font-family', mark: 'rFonts', getAttrs: (value) => {
      const family = value.split(',')[0]?.trim().replace(/^["']|["']$/g, '')
      if (!family || /^(serif|sans-serif|monospace|system-ui|inherit|initial)$/i.test(family)) return false
      return { v: element('w:rFonts', { 'w:ascii': family, 'w:hAnsi': family, 'w:cs': family }) }
    } },
  )
  return new PMDOMParser(schema, rules)
}

const DANGEROUS = 'script,style,iframe,frame,frameset,object,embed,applet,link,meta,base,form,input,button,textarea,select,noscript,template,svg,math,video,audio,source,canvas'

/**
 * Makes clipboard HTML inert and folds Word's list markup (`mso-list`) into attributes the
 * parser understands. Uses an inert document, so nothing loads or runs while cleaning.
 */
export function sanitizePastedHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return ''
  // Word wraps HTML in conditional comments; their contents are noise.
  const cleaned = html.replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '').replace(/<!--[\s\S]*?-->/g, '')
  const parsed = new DOMParser().parseFromString(cleaned, 'text/html')
  for (const node of parsed.querySelectorAll(DANGEROUS)) node.remove()
  for (const node of parsed.querySelectorAll('o\\:p')) node.replaceWith(...node.childNodes)
  for (const node of parsed.querySelectorAll('img')) node.remove()
  for (const node of parsed.querySelectorAll('*')) {
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase()
      if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction') node.removeAttribute(attribute.name)
      else if ((name === 'href' || name === 'src' || name === 'xlink:href' || name === 'action') && !/^(https?:|mailto:|#)/i.test(attribute.value.trim())) node.removeAttribute(attribute.name)
    }
    // Word lists: `mso-list: l0 level2 lfo1` on paragraphs, with the label in an `mso-list:Ignore` span.
    const style = node.getAttribute('style') ?? ''
    if (/mso-list:\s*Ignore/i.test(style)) {
      const label = node.textContent ?? ''
      node.parentElement?.setAttribute('data-docx-list', /^\s*[\da-zA-Z]+[.)]/.test(label) ? 'decimal' : 'bullet')
      node.remove()
      continue
    }
    const list = /mso-list:\s*l\d+\s+level(\d+)/i.exec(style)
    if (list) {
      node.setAttribute('data-docx-level', String(Number(list[1]) - 1))
      if (!node.hasAttribute('data-docx-list')) node.setAttribute('data-docx-list', 'bullet')
    }
  }
  // HTML lists: items know their kind and depth.
  for (const item of parsed.querySelectorAll('li')) {
    let depth = -1
    let kind = 'bullet'
    for (let parent = item.parentElement; parent; parent = parent.parentElement) {
      if (parent.tagName === 'UL' || parent.tagName === 'OL') {
        if (depth < 0) kind = parent.tagName === 'OL' ? 'decimal' : 'bullet'
        depth++
      }
    }
    item.setAttribute('data-docx-list', kind)
    item.setAttribute('data-docx-level', String(Math.max(0, Math.min(8, depth))))
  }
  return parsed.body.innerHTML
}

export type { JmlElement }
