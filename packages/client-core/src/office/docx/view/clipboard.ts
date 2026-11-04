import { DOMParser as PMDOMParser, DOMSerializer, type DOMOutputSpec, type Mark, type Node as ProseMirrorNode, type ParseRule, type Schema, type TagParseRule } from '@tiptap/pm/model'
import { packJml, type JmlElement } from '../jsonml.js'
import { HIGHLIGHT_COLORS } from '../css.js'

/**
 * Copy and paste. Between docx editors everything round-trips exactly: the clipboard HTML
 * carries each node's and mark's attributes. From Word, Google Docs, and web pages, the HTML is
 * first made inert (no scripts, styles, frames, event handlers, or remote URLs) and then read
 * into paragraphs, headings, lists, tables, links, and the run formatting the schema models.
 */

const DATA_NODE = 'data-docx-node'
const DATA_MARK = 'data-docx-mark'
const DATA_ATTRS = 'data-docx-attrs'

function withData(spec: DOMOutputSpec, data: Record<string, string>): DOMOutputSpec {
  if (!Array.isArray(spec)) return spec
  const [tag, maybeAttrs, ...rest] = spec as unknown as [string, unknown, ...unknown[]]
  if (maybeAttrs && typeof maybeAttrs === 'object' && !Array.isArray(maybeAttrs) && !(typeof Node !== 'undefined' && maybeAttrs instanceof Node)) {
    return [tag, { ...(maybeAttrs as Record<string, string>), ...data }, ...rest] as unknown as DOMOutputSpec
  }
  return [tag, data, ...(maybeAttrs === undefined ? [] : [maybeAttrs]), ...rest] as unknown as DOMOutputSpec
}

/** Serializes slices with their full attributes, for pasting into another docx editor. */
export function clipboardSerializer(schema: Schema): DOMSerializer {
  const base = DOMSerializer.fromSchema(schema)
  const nodes: Record<string, (node: ProseMirrorNode) => DOMOutputSpec> = {}
  for (const [name, serialize] of Object.entries(base.nodes)) {
    nodes[name] = (node) => withData(serialize(node), { [DATA_NODE]: name, [DATA_ATTRS]: JSON.stringify(node.attrs) })
  }
  const marks: Record<string, (mark: Mark, inline: boolean) => DOMOutputSpec> = {}
  for (const [name, serialize] of Object.entries(base.marks)) {
    marks[name] = (mark, inline) => withData(serialize(mark, inline), { [DATA_MARK]: name, [DATA_ATTRS]: JSON.stringify(mark.attrs) })
  }
  return new DOMSerializer(nodes, marks)
}

function dataAttrs(dom: HTMLElement): Record<string, unknown> | false {
  try {
    return JSON.parse(dom.getAttribute(DATA_ATTRS) ?? '{}') as Record<string, unknown>
  } catch {
    return false
  }
}

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

/** Parse rules for pasted HTML; internal copies match the data attributes first. */
export function clipboardParser(schema: Schema): PMDOMParser {
  const rules: ParseRule[] = []
  for (const name of Object.keys(schema.nodes)) {
    if (name === 'text' || name === 'doc') continue
    rules.push({ tag: `[${DATA_NODE}="${name}"]`, node: name, priority: 100, getAttrs: (dom) => dataAttrs(dom as HTMLElement) } as TagParseRule)
  }
  for (const name of Object.keys(schema.marks)) {
    rules.push({ tag: `[${DATA_MARK}="${name}"]`, mark: name, priority: 100, getAttrs: (dom) => dataAttrs(dom as HTMLElement) } as TagParseRule)
  }
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
    { tag: 'td', node: 'tableCell', getAttrs: (dom) => ({ colspan: Number((dom as HTMLElement).getAttribute('colspan')) || 1, rowspan: Number((dom as HTMLElement).getAttribute('rowspan')) || 1 }) },
    { tag: 'th', node: 'tableCell', getAttrs: (dom) => ({ colspan: Number((dom as HTMLElement).getAttribute('colspan')) || 1, rowspan: Number((dom as HTMLElement).getAttribute('rowspan')) || 1 }) },
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
