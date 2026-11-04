import { LiveFormatError } from '../../live-format.js'

/**
 * A small, fast XML parser for the bulk of a worksheet (`<sheetData>`), which can hold millions
 * of elements: a DOM for it would take far more time and memory than these plain objects.
 * Element names lose their namespace prefix (some writers emit `<x:c>`); everything else about
 * the worksheet goes through the DOM parser.
 */

export interface LightNode {
  name: string
  attrs: Record<string, string>
  children: LightNode[]
  /** Concatenated text content directly inside this element (entities decoded). */
  text: string
  /** Offsets of the element in the source, for keeping unmodeled children as XML. */
  start: number
  end: number
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function decodeEntities(raw: string): string {
  // XML parsers report every line ending as a line feed (XML 1.0 §2.11); entities are decoded after.
  const text = raw.includes('\r') ? raw.replace(/\r\n?/g, '\n') : raw
  if (!text.includes('&')) return text
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    // Entities a DTD would define are never expanded (no billion laughs); like the DOM parser,
    // treat them as malformed.
    const known = ENTITIES[entity]
    if (known === undefined) throw new LiveFormatError('corrupt', `Malformed XML: entity not found: ${match}`)
    return known
  })
}

const ATTRIBUTE = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g

function localName(name: string): string {
  const colon = name.indexOf(':')
  return colon < 0 ? name : name.slice(colon + 1)
}

/** The maximum element depth inside a fragment; real sheet data nests 5 deep. */
const MAX_DEPTH = 64

/**
 * Parses the children of a fragment (the inner XML of an element). Throws LiveFormatError for
 * malformed input.
 */
export function parseFragment(xml: string, from = 0, to = xml.length): LightNode[] {
  const root: LightNode = { name: '#root', attrs: {}, children: [], text: '', start: from, end: to }
  const stack: LightNode[] = [root]
  let index = from
  while (index < to) {
    const open = xml.indexOf('<', index)
    const top = stack[stack.length - 1]!
    if (open < 0 || open >= to) {
      top.text += decodeEntities(xml.slice(index, to))
      break
    }
    if (open > index) top.text += decodeEntities(xml.slice(index, open))
    const next = xml[open + 1]
    if (next === '!') {
      if (xml.startsWith('<!--', open)) {
        const close = xml.indexOf('-->', open + 4)
        if (close < 0) throw new LiveFormatError('corrupt', 'Unterminated XML comment')
        index = close + 3
        continue
      }
      if (xml.startsWith('<![CDATA[', open)) {
        const close = xml.indexOf(']]>', open + 9)
        if (close < 0) throw new LiveFormatError('corrupt', 'Unterminated CDATA section')
        top.text += xml.slice(open + 9, close)
        index = close + 3
        continue
      }
      throw new LiveFormatError('corrupt', 'Unexpected declaration in sheet data')
    }
    if (next === '?') {
      const close = xml.indexOf('?>', open + 2)
      if (close < 0) throw new LiveFormatError('corrupt', 'Unterminated processing instruction')
      index = close + 2
      continue
    }
    const close = findTagEnd(xml, open + 1)
    if (close < 0 || close >= to) throw new LiveFormatError('corrupt', 'Unterminated XML tag')
    if (next === '/') {
      const name = localName(xml.slice(open + 2, close).trim())
      const node = stack.pop()
      if (!node || node === root || node.name !== name) throw new LiveFormatError('corrupt', `Mismatched closing tag </${name}>`)
      node.end = close + 1
      index = close + 1
      continue
    }
    const selfClosing = xml[close - 1] === '/'
    const body = xml.slice(open + 1, selfClosing ? close - 1 : close)
    const space = body.search(/\s/)
    const name = localName(space < 0 ? body : body.slice(0, space))
    const attrs: Record<string, string> = {}
    if (space >= 0) {
      ATTRIBUTE.lastIndex = space
      let match: RegExpExecArray | null
      while ((match = ATTRIBUTE.exec(body))) attrs[match[1]!] = decodeEntities(match[3] ?? match[4] ?? '')
    }
    const node: LightNode = { name, attrs, children: [], text: '', start: open, end: close + 1 }
    top.children.push(node)
    if (!selfClosing) {
      if (stack.length > MAX_DEPTH) throw new LiveFormatError('corrupt', 'Sheet data is nested too deeply')
      stack.push(node)
    }
    index = close + 1
  }
  if (stack.length !== 1) throw new LiveFormatError('corrupt', `Unclosed element <${stack[stack.length - 1]!.name}>`)
  return root.children
}

/** The `>` ending a tag that starts at `from`, skipping `>` inside quoted attribute values. */
function findTagEnd(xml: string, from: number): number {
  let quote = ''
  for (let index = from; index < xml.length; index++) {
    const char = xml[index]!
    if (quote) {
      if (char === quote) quote = ''
    } else if (char === '"' || char === "'") quote = char
    else if (char === '>') return index
  }
  return -1
}

export function lightChild(node: LightNode, name: string): LightNode | undefined {
  return node.children.find((entry) => entry.name === name)
}

/**
 * Finds an element in a document's text by local name: its start, the end of its start tag, the
 * start of its end tag, and its end. Used to cut `<sheetData>` out before DOM parsing.
 */
export function locateElement(xml: string, name: string): { start: number; innerStart: number; innerEnd: number; end: number; prefix: string } | undefined {
  const open = new RegExp(`<((?:[\\w.-]+:)?)${name}(?=[\\s/>])`).exec(xml)
  if (!open) return undefined
  const start = open.index
  const tagEnd = findTagEnd(xml, start + 1)
  if (tagEnd < 0) return undefined
  const prefix = open[1] ?? ''
  if (xml[tagEnd - 1] === '/') return { start, innerStart: tagEnd + 1, innerEnd: tagEnd + 1, end: tagEnd + 1, prefix }
  const closing = `</${open[1]}${name}>`
  const closeAt = xml.indexOf(closing, tagEnd)
  if (closeAt < 0) return undefined
  return { start, innerStart: tagEnd + 1, innerEnd: closeAt, end: closeAt + closing.length, prefix }
}
