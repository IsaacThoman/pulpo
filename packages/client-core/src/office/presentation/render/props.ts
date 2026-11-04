import { attr, childElements, NS, type XmlElement } from '../xml.js'

/**
 * Merged DrawingML property sets. Paragraph and run properties cascade through several list
 * styles (presentation defaults, master text styles, placeholder list styles, the shape's own);
 * a bag keeps the most specific value of each attribute and each child group.
 */
export interface PropertyBag {
  attrs: Record<string, string>
  children: Record<string, XmlElement>
}

export const emptyBag = (): PropertyBag => ({ attrs: {}, children: {} })

/** Children that exclude each other share one slot. */
const GROUPS: Record<string, string> = {
  noFill: 'fill',
  solidFill: 'fill',
  gradFill: 'fill',
  blipFill: 'fill',
  pattFill: 'fill',
  grpFill: 'fill',
  buNone: 'bullet',
  buAutoNum: 'bullet',
  buChar: 'bullet',
  buBlip: 'bullet',
  buClrTx: 'buClr',
  buClr: 'buClr',
  buSzTx: 'buSz',
  buSzPct: 'buSz',
  buSzPts: 'buSz',
  buFontTx: 'buFont',
  buFont: 'buFont',
  uLnTx: 'uLn',
  uLn: 'uLn',
  uFillTx: 'uFill',
  uFill: 'uFill',
  effectLst: 'effect',
  effectDag: 'effect',
}

export function slotOf(localName: string): string {
  return GROUPS[localName] ?? localName
}

/** Layers `element`'s attributes and children over `bag` (in place). */
export function mergeInto(bag: PropertyBag, element: XmlElement | undefined, skipChildren: readonly string[] = []): PropertyBag {
  if (!element) return bag
  for (let index = 0; index < element.attributes.length; index++) {
    const attribute = element.attributes.item(index)!
    if (attribute.name.startsWith('xmlns')) continue
    bag.attrs[attribute.localName ?? attribute.name] = attribute.value
  }
  for (const entry of childElements(element)) {
    const name = entry.localName ?? ''
    if (skipChildren.includes(name) || entry.namespaceURI !== NS.a) continue
    bag.children[slotOf(name)] = entry
  }
  return bag
}

export function cloneBag(bag: PropertyBag): PropertyBag {
  return { attrs: { ...bag.attrs }, children: { ...bag.children } }
}

/** The `a:lvlNpPr` of a list style (or of `p:titleStyle`/`p:bodyStyle`), with `a:defPPr` under it. */
export function levelProperties(listStyle: XmlElement | undefined, level: number): XmlElement[] {
  if (!listStyle) return []
  const found: XmlElement[] = []
  const defaults = childElements(listStyle).find((element) => element.localName === 'defPPr')
  if (defaults) found.push(defaults)
  const exact = childElements(listStyle).find((element) => element.localName === `lvl${level + 1}pPr`)
  if (exact) found.push(exact)
  return found
}

/** Paragraph and default-run properties for one level, through a chain of list styles. */
export function resolveLevel(chain: readonly (XmlElement | undefined)[], level: number): { paragraph: PropertyBag; run: PropertyBag } {
  const paragraph = emptyBag()
  const run = emptyBag()
  for (const listStyle of chain) {
    for (const properties of levelProperties(listStyle, level)) {
      mergeInto(paragraph, properties, ['defRPr', 'extLst'])
      mergeInto(run, childElements(properties).find((element) => element.localName === 'defRPr'))
    }
  }
  return { paragraph, run }
}

export function bagNumber(bag: PropertyBag, name: string): number | undefined {
  const value = bag.attrs[name]
  if (value === undefined) return undefined
  const number = Number.parseInt(value, 10)
  return Number.isFinite(number) ? number : undefined
}

export function childValue(element: XmlElement | undefined, name: string): number | undefined {
  const child = childElements(element).find((entry) => entry.localName === name)
  const value = attr(child, 'val')
  if (value === undefined) return undefined
  const number = Number.parseInt(value, 10)
  return Number.isFinite(number) ? number : undefined
}

/** Layers `top` over `bag` (in place). */
export function mergeBag(bag: PropertyBag, top: PropertyBag | undefined): PropertyBag {
  if (!top) return bag
  Object.assign(bag.attrs, top.attrs)
  Object.assign(bag.children, top.children)
  return bag
}
