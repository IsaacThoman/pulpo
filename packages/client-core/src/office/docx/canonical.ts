import { pushAll } from '../../collections.js'
import { parseXml } from '../ooxml/package.js'
import { elementToJml, jmlElements, type JmlElement, type JmlNode } from './jsonml.js'
import { PPR_ORDER, RPR_ORDER, TCPR_ORDER, TRPR_ORDER, sortByOrder } from './names.js'

/**
 * WordprocessingML in a canonical form, for tests that check an export changed nothing it
 * should not have. It irons out what the exporter is allowed to differ in: runs split or merged
 * at the same formatting, revision-session ids on runs, hints Word rewrites anyway
 * (`w:proofErr`, `w:lastRenderedPageBreak`), namespace declarations, and property order.
 */

const DROPPED = new Set(['w:proofErr', 'w:lastRenderedPageBreak'])
const ORDERS: Record<string, readonly string[]> = { 'w:rPr': RPR_ORDER, 'w:pPr': PPR_ORDER, 'w:tcPr': TCPR_ORDER, 'w:trPr': TRPR_ORDER }

function attrsWithout(attrs: Record<string, string>, drop: (key: string) => boolean): Record<string, string> {
  return Object.fromEntries(Object.entries(attrs).filter(([key]) => !drop(key)).sort(([a], [b]) => a.localeCompare(b)))
}

function canonicalElement(element: JmlElement, depth: number): JmlElement {
  const [name, attrs] = element
  // Paragraph ids: the exporter drops duplicates and gives comments' last paragraphs one.
  const dropAttr = (key: string) => key.startsWith('xmlns') || key === 'mc:Ignorable' || (name === 'w:r' && key.startsWith('w:rsid')) || key === 'w14:paraId' || key === 'w14:textId' || depth === 0
  let children: JmlNode[] = []
  for (const child of element.slice(2) as JmlNode[]) {
    if (typeof child === 'string') children.push(child)
    else if (!DROPPED.has(child[0])) {
      const canonical = canonicalElement(child, depth + 1)
      // Empty property containers say nothing.
      if ((canonical[0] === 'w:rPr' || canonical[0] === 'w:pPr') && canonical.length === 2) continue
      // The grid is checked by reading the model back; files without one get one.
      if (canonical[0] === 'w:tblGrid') continue
      children.push(canonical)
    }
  }
  // The final section's properties always end the body.
  if (name === 'w:body') {
    const sections = children.filter((child) => Array.isArray(child) && child[0] === 'w:sectPr')
    children = [...children.filter((child) => !sections.includes(child)), ...sections]
    // A body without paragraphs gets an empty one.
    if (children.length === sections.length + 1 && Array.isArray(children[0]) && children[0][0] === 'w:p' && children[0].length === 2) children.shift()
  }
  // Header, footer, and note stories always hold at least one paragraph.
  if ((name === 'w:hdr' || name === 'w:ftr') && children.length === 1 && Array.isArray(children[0]) && children[0][0] === 'w:p' && children[0].length === 2) children = []
  const order = ORDERS[name]
  if (order) children = sortByOrder(children.filter((child): child is JmlElement => Array.isArray(child)), order, ['w:rPrChange', 'w:pPrChange'])
  if (name === 'w:t' || name === 'w:delText' || name === 'w:instrText') {
    return [name, {}, ...children.filter((child) => child !== '')]
  }
  // A tab character in text and a `w:tab` are the same to Word.
  if (name === 'w:r') {
    const split: JmlNode[] = []
    for (const child of children) {
      if (Array.isArray(child) && child[0] === 'w:t' && typeof child[2] === 'string' && child[2].includes('\t')) {
        child[2].split('\t').forEach((part, index) => {
          if (index > 0) split.push(['w:tab', {}])
          if (part) split.push(['w:t', {}, part])
        })
      } else split.push(child)
    }
    children = split
  }
  children = mergeRuns(children)
  return [name, attrsWithout(attrs, dropAttr), ...children]
}

/** Merges adjacent runs whose properties are equal, and adjacent text inside a run. */
function mergeRuns(children: JmlNode[]): JmlNode[] {
  const result: JmlNode[] = []
  for (const child of children) {
    if (Array.isArray(child) && child[0] === 'w:r') {
      const content = jmlElements(child).filter((part) => part[0] !== 'w:rPr')
      if (!content.length) continue
      const previous = result[result.length - 1]
      if (Array.isArray(previous) && previous[0] === 'w:r' && JSON.stringify(previous[1]) === JSON.stringify(child[1]) && JSON.stringify(propertiesOf(previous)) === JSON.stringify(propertiesOf(child))) {
        pushAll(previous, content)
        continue
      }
      result.push([child[0], child[1], ...jmlElements(child)])
      continue
    }
    result.push(child)
  }
  for (const node of result) {
    if (!Array.isArray(node) || node[0] !== 'w:r') continue
    const merged: JmlNode[] = []
    for (const part of node.slice(2) as JmlNode[]) {
      const previous = merged[merged.length - 1]
      if (Array.isArray(part) && Array.isArray(previous) && part[0] === previous[0] && (part[0] === 'w:t' || part[0] === 'w:delText' || part[0] === 'w:instrText')) {
        previous[2] = String(previous[2] ?? '') + String(part[2] ?? '')
        continue
      }
      merged.push(Array.isArray(part) ? [...part] as JmlElement : part)
    }
    node.length = 2
    pushAll(node, merged)
  }
  return result
}

function propertiesOf(run: JmlElement): JmlElement | undefined {
  return jmlElements(run).find((child) => child[0] === 'w:rPr')
}

export function canonicalXml(xml: string): JmlElement {
  const document = parseXml(xml)
  return canonicalElement(elementToJml(document.documentElement!), 0)
}

/** Paths of differences between two canonical trees, at most `limit` of them. */
export function canonicalDiff(a: JmlNode, b: JmlNode, path = '', limit = 5, out: string[] = []): string[] {
  if (out.length >= limit) return out
  if (typeof a === 'string' || typeof b === 'string') {
    if (a !== b) out.push(`${path}: ${JSON.stringify(a).slice(0, 200)} ≠ ${JSON.stringify(b).slice(0, 200)}`)
    return out
  }
  const here = `${path}/${a[0]}`
  if (a[0] !== b[0]) {
    out.push(`${path}: <${a[0]}> ≠ <${b[0]}>`)
    return out
  }
  if (JSON.stringify(a[1]) !== JSON.stringify(b[1])) out.push(`${here} attrs ${JSON.stringify(a[1])} ≠ ${JSON.stringify(b[1])}`)
  const length = Math.max(a.length, b.length)
  for (let index = 2; index < length && out.length < limit; index++) {
    const left = a[index] as JmlNode | undefined
    const right = b[index] as JmlNode | undefined
    if (left === undefined || right === undefined) {
      out.push(`${here}[${index - 2}]: ${left === undefined ? 'missing' : JSON.stringify(left).slice(0, 300)} ≠ ${right === undefined ? 'missing' : JSON.stringify(right).slice(0, 300)}`)
      break
    }
    canonicalDiff(left, right, `${here}[${index - 2}]`, limit, out)
  }
  return out
}
