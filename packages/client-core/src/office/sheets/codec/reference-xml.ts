import { parseXml } from '../../ooxml/package.js'
import { toA1Form, toIdForm } from '../model/formula-ids.js'
import type { SheetModel } from '../model/workbook.js'
import { children, serializeNode, type XmlElement } from './xml.js'

/** Only reference-bearing SpreadsheetML, chart and extension fields are rewritten. Text, URLs,
 * relationship targets, external workbooks and arbitrary extension payloads remain opaque. */
export function mapXmlReferences(xml: string, map: (text: string) => string, resolve = false): string {
  if (!xml || !/\b(?:ref|sqref|activeCell|topLeftCell|location|formula|calculatedColumnFormula|totalsRowFormula)|<(?:\w+:)?f[ >]/.test(xml)) return xml
  const document = parseXml(xml)
  let changed = false
  const visit = (node: XmlElement) => {
    const name = node.localName ?? ''
    const ns = node.namespaceURI ?? ''
    const supported = /spreadsheetml|drawingml\/.*chart|office\/excel/.test(ns)
    if (supported) {
      for (const key of ['ref', 'sqref', 'activeCell', 'topLeftCell', 'location']) {
        if (!node.hasAttribute(key)) continue
        const before = node.getAttribute(key)!
        let after = map(before)
        if (resolve && ['sqref', 'activeCell', 'topLeftCell'].includes(key)) {
          after = after.split(/\s+/).filter((part) => !part.includes('#REF!')).join(' ')
          if (!after && (key === 'activeCell' || key === 'topLeftCell')) after = 'A1'
        }
        if (before !== after) { node.setAttribute(key, after); changed = true }
        if (resolve && after.includes('#REF!') && ['threadedComment', 'sortCondition', 'sortState'].includes(name)) {
          node.parentNode?.removeChild(node)
          return
        }
      }
      const formula = ['formula', 'calculatedColumnFormula', 'totalsRowFormula', 'f', 'sqref'].includes(name)
      if (formula && !children(node).length) {
        const before = node.textContent ?? ''
        let after = map(before)
        if (resolve && name === 'sqref') after = after.split(/\s+/).filter((part) => !part.includes('#REF!')).join(' ')
        if (before !== after) {
          node.textContent = after
          changed = true
          if (resolve && name === 'f' && /drawingml/.test(ns)) {
            const parent = node.parentNode as XmlElement | null
            if (parent) for (const cache of children(parent).filter((entry) => ['numCache', 'strCache'].includes(entry.localName ?? ''))) parent.removeChild(cache)
          }
        }
      }
    }
    for (const entry of [...children(node)]) visit(entry)
    if (resolve && name === 'sparkline' && children(node, 'sqref').every((entry) => !entry.textContent)) {
      node.parentNode?.removeChild(node)
      changed = true
    }
  }
  if (document.documentElement) visit(document.documentElement)
  return changed ? serializeNode(document) : xml
}

export function anchorXml(xml: string, sheet: SheetModel): string {
  return mapXmlReferences(xml, (text) => toIdForm(text, sheet))
}

export function resolveXml(xml: string, sheet: SheetModel): string {
  return mapXmlReferences(xml, (text) => toA1Form(text, sheet), true)
}

export function translateXml(xml: string, from: SheetModel, to: SheetModel): string {
  return mapXmlReferences(xml, (text) => toIdForm(toA1Form(text, from), to))
}

/** Preserve the exact source bytes until a tracked reference actually changes. */
export function keepReferencePart(sheet: SheetModel, path: string, source: string): void {
  const parts = (sheet.raw.get('referenceParts') as Record<string, { source: string; anchored: string }> | undefined) ?? {}
  sheet.raw.set('referenceParts', { ...parts, [path]: { source, anchored: anchorXml(source, sheet) } })
}

export function referenceParts(sheet: SheetModel): Record<string, { source: string; anchored: string }> {
  return (sheet.raw.get('referenceParts') as Record<string, { source: string; anchored: string }> | undefined) ?? {}
}
