import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { revisionContent } from './revisions.js'
import { hasCustomNoteMark } from './schema.js'
import { jmlAttr, jmlChild, jmlNumber, unpackJml, type JmlElement } from './jsonml.js'
import { formatNumber } from './numbering.js'

export interface NoteReference {
  kind: 'footnote' | 'endnote'
  id: string
  section: number
  /** Custom marks have no automatic number; their literal mark remains in the document. */
  number?: number
  textLabel: string
}

/** All referenced notes, with separate automatic and custom-label counters. */
export class NoteInventory extends Map<string, NoteReference> {
  private readonly automatic = { footnote: 0, endnote: 0 }
  private readonly custom = { footnote: 0, endnote: 0 }

  reference(node: ProseMirrorNode, section = 0): NoteReference {
    const kind = node.attrs.kind === 'endnote' ? 'endnote' : 'footnote'
    const id = String(node.attrs.id)
    const key = `${kind}:${id}`
    let entry = this.get(key)
    if (!entry) {
      const custom = hasCustomNoteMark(node)
      const number = custom ? undefined : ++this.automatic[kind]
      const label = custom ? `custom-${++this.custom[kind]}` : String(number)
      entry = { kind, id, section, number, textLabel: `${kind === 'endnote' ? 'e' : ''}${label}` }
      this.set(key, entry)
    }
    return entry
  }
}

const inventories = new WeakMap<ProseMirrorNode, NoteInventory>()

/** Each section ends at its paragraph's sectPr; the document property ends the last one. */
export function sectionProperties(doc: ProseMirrorNode, finalSectPr?: JmlElement): { properties: (JmlElement | undefined)[]; sectionOfBlock: number[] } {
  const properties: (JmlElement | undefined)[] = []
  const sectionOfBlock: number[] = []
  const read = (value: unknown) => typeof value === 'string' ? unpackJml<JmlElement>(value) : undefined
  doc.forEach((node) => {
    sectionOfBlock.push(properties.length)
    let end = node.type.name === 'paragraph' ? read(node.attrs.sectPr) : undefined
    if (node.type.name !== 'paragraph') node.descendants((child) => {
      if (child.type.name === 'paragraph' && child.attrs.sectPr && !end) end = read(child.attrs.sectPr)
      return !end
    })
    if (end) properties.push(end)
  })
  properties.push(finalSectPr)
  return { properties, sectionOfBlock }
}

/** Rendering and pagination use the same accepted view as text and review summaries. */
export function noteInventory(body: ProseMirrorNode): NoteInventory {
  let notes = inventories.get(body)
  if (!notes) {
    notes = new NoteInventory()
    const accepted = revisionContent(body)
    const { sectionOfBlock } = sectionProperties(accepted)
    accepted.forEach((block, _offset, index) => {
      block.descendants((node) => {
        if (node.type.name === 'tableCell' && node.attrs.phantom) return false
        if (node.type.name === 'noteRef') notes!.reference(node, sectionOfBlock[index])
        return true
      })
    })
    inventories.set(body, notes)
  }
  return notes
}

/** An empty display label retains custom notes without inventing an automatic number. */
export function noteNumbers(body: ProseMirrorNode): Map<string, number | string> {
  return new Map([...noteInventory(body)].map(([key, reference]) => [key, reference.number ?? '']))
}

export type NoteDefaults = Partial<Record<'footnote' | 'endnote', JmlElement>>

export function noteProperties(kind: 'footnote' | 'endnote', defaults: NoteDefaults, section?: JmlElement) {
  const own = jmlChild(section, `w:${kind}Pr`)
  const property = (name: string) => jmlChild(own, name) ?? jmlChild(defaults[kind], name)
  const restart = jmlAttr(property('w:numRestart'), 'w:val')
  return {
    format: jmlAttr(property('w:numFmt'), 'w:val') ?? (kind === 'endnote' ? 'lowerRoman' : 'decimal'),
    start: Math.max(0, Math.trunc(jmlNumber(property('w:numStart'), 'w:val') ?? 1)),
    restart: restart === 'eachPage' || restart === 'eachSect' ? restart : 'continuous',
  }
}

/** One display policy for body references and every rendering of a note's own marker. */
export function resolveNoteLabels(body: ProseMirrorNode, defaults: NoteDefaults, finalSectPr?: JmlElement, pages?: ReadonlyMap<string, number>): Map<string, string> {
  const labels = new Map<string, string>()
  const notes = noteInventory(body)
  if (!notes.size) return labels
  const sections = sectionProperties(revisionContent(body), finalSectPr).properties
  const previous: Partial<Record<'footnote' | 'endnote', { number: number; section: number; page: number | undefined }>> = {}
  for (const [key, ref] of notes) {
    if (ref.number === undefined) { labels.set(key, ''); continue }
    const properties = noteProperties(ref.kind, defaults, sections[ref.section])
    const prior = previous[ref.kind]
    const page = pages?.get(key)
    const reset = !prior || (properties.restart === 'eachSect' && prior.section !== ref.section) || (properties.restart === 'eachPage' && page !== undefined && page !== prior.page)
    const number = reset ? properties.start : prior.number + 1
    labels.set(key, formatNumber(number, properties.format))
    previous[ref.kind] = { number, section: ref.section, page }
  }
  return labels
}
