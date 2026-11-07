import type { RichRun, SheetColor, UnderlineStyle } from '../model/schema.js'
import { lightChild, parseFragment, type LightNode } from './light-xml.js'
import { colorAttrs } from '../styles/stylesheet.js'
import { decodeSheetText, encodeSheetText, needsPreserve, xmlAttrs } from './xml.js'

/** Shared strings and rich text (`<si>`, `<is>`, and comment text all share this shape). */

export interface SheetString {
  text: string
  runs?: RichRun[]
  /** `<rPh>`/`<phoneticPr>` children, kept as XML. */
  phonetic?: string
}

function lightColor(node: LightNode | undefined): SheetColor | undefined {
  if (!node) return undefined
  const { rgb, theme, indexed, tint, auto } = node.attrs
  const color: SheetColor = {}
  if (rgb) color.rgb = rgb.toUpperCase()
  else if (theme !== undefined) color.theme = Number(theme)
  else if (indexed !== undefined) color.indexed = Number(indexed)
  else if (auto === '1' || auto === 'true') color.auto = true
  else return undefined
  if (tint) color.tint = Number(tint)
  return color
}

function flag(node: LightNode | undefined): boolean {
  if (!node) return false
  const value = node.attrs.val
  return value === undefined || value === '1' || value === 'true'
}

function runFont(rPr: LightNode): RichRun['font'] {
  const font: NonNullable<RichRun['font']> = {}
  for (const child of rPr.children) {
    switch (child.name) {
      case 'rFont':
      case 'name':
        if (child.attrs.val) font.fontName = child.attrs.val
        break
      case 'sz':
        if (Number(child.attrs.val) > 0) font.fontSize = Number(child.attrs.val)
        break
      case 'b':
        font.bold = flag(child)
        break
      case 'i':
        font.italic = flag(child)
        break
      case 'strike':
        font.strike = flag(child)
        break
      case 'u':
        font.underline = child.attrs.val === 'none' ? null : ((child.attrs.val ?? 'single') as UnderlineStyle)
        break
      case 'color': {
        const color = lightColor(child)
        if (color) font.fontColor = color
        break
      }
      case 'vertAlign':
        if (child.attrs.val === 'superscript' || child.attrs.val === 'subscript') font.vertAlign = child.attrs.val
        break
    }
  }
  return font
}

/** Reads a string item (`<si>`, `<is>`, `<text>`) parsed by the light parser. */
export function readStringItem(node: LightNode, source: string): SheetString {
  const plain = lightChild(node, 't')
  const runs: RichRun[] = []
  let phonetic = ''
  for (const child of node.children) {
    if (child.name === 'r') {
      const rPr = lightChild(child, 'rPr')
      const text = decodeSheetText(lightChild(child, 't')?.text ?? '')
      // Keep the run properties as read unless they use a namespace prefix we won't declare.
      const raw = rPr && source.slice(rPr.start, rPr.end)
      runs.push({ text, ...(rPr ? { font: runFont(rPr) } : {}), ...(raw?.startsWith('<rPr') ? { rPr: raw } : {}) })
    } else if ((child.name === 'rPh' || child.name === 'phoneticPr') && source.startsWith(`<${child.name}`, child.start)) {
      phonetic += source.slice(child.start, child.end)
    }
  }
  const text = runs.length ? runs.map((run) => run.text).join('') : decodeSheetText(plain?.text ?? '')
  return { text, ...(runs.length ? { runs } : {}), ...(phonetic ? { phonetic } : {}) }
}

/** Parses `xl/sharedStrings.xml`. */
export function readSharedStrings(xml: string): SheetString[] {
  const [sst] = parseFragment(xml).filter((node) => node.name === 'sst')
  if (!sst) return []
  return sst.children.filter((node) => node.name === 'si').map((node) => readStringItem(node, xml))
}

function fontXml(font: NonNullable<RichRun['font']>, nameElement: 'rFont' | 'name'): string {
  // CT_RPrElt children are a choice group; Excel writes them in this order.
  let xml = ''
  if (font.fontName) xml += `<${nameElement} val="${encodeSheetText(font.fontName)}"/>`
  if (font.bold) xml += '<b/>'
  if (font.italic) xml += '<i/>'
  if (font.strike) xml += '<strike/>'
  if (font.fontColor) xml += `<color${xmlAttrs(colorAttrs(font.fontColor))}/>`
  if (font.fontSize) xml += `<sz val="${font.fontSize}"/>`
  if (font.underline) xml += font.underline === 'single' ? '<u/>' : `<u val="${font.underline}"/>`
  if (font.vertAlign) xml += `<vertAlign val="${font.vertAlign}"/>`
  return xml
}

function textElement(text: string): string {
  return `<t${needsPreserve(text) ? ' xml:space="preserve"' : ''}>${encodeSheetText(text)}</t>`
}

/** The inner XML of a string item: `<t>` for plain text, `<r>` runs for rich text. */
export function writeStringItem(value: SheetString): string {
  let xml = ''
  if (value.runs?.length) {
    for (const run of value.runs) {
      const rPr = run.rPr ?? (run.font && Object.keys(run.font).length ? `<rPr>${fontXml(run.font, 'rFont')}</rPr>` : '')
      xml += `<r>${rPr}${textElement(run.text)}</r>`
    }
  } else xml += textElement(value.text)
  return xml + (value.phonetic ?? '')
}

/** Builds `xl/sharedStrings.xml` while cells are written. */
export class SharedStringTable {
  private readonly index = new Map<string, number>()
  private readonly items: string[] = []
  /** Every reference, counted (the `count` attribute). */
  private references = 0

  /** Adds a string; `keepIndex` appends it even when equal to an earlier one (seeding). */
  add(value: SheetString, keepIndex = false): number {
    this.references++
    const xml = writeStringItem(value)
    let id = keepIndex ? undefined : this.index.get(xml)
    if (id === undefined) {
      id = this.items.length
      this.items.push(xml)
      if (!this.index.has(xml)) this.index.set(xml, id)
    }
    return id
  }

  get size(): number {
    return this.items.length
  }

  toXml(): string {
    let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${this.references}" uniqueCount="${this.items.length}">`
    for (const item of this.items) xml += `<si>${item}</si>`
    return xml + '</sst>'
  }
}
