import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { revisionContent } from './revisions.js'
import { hasCustomNoteMark } from './schema.js'

export interface NoteReference {
  kind: 'footnote' | 'endnote'
  id: string
  /** Custom marks have no automatic number; their literal mark remains in the document. */
  number?: number
  textLabel: string
}

/** All referenced notes, with separate automatic and custom-label counters. */
export class NoteInventory extends Map<string, NoteReference> {
  private readonly automatic = { footnote: 0, endnote: 0 }
  private readonly custom = { footnote: 0, endnote: 0 }

  reference(node: ProseMirrorNode): NoteReference {
    const kind = node.attrs.kind === 'endnote' ? 'endnote' : 'footnote'
    const id = String(node.attrs.id)
    const key = `${kind}:${id}`
    let entry = this.get(key)
    if (!entry) {
      const custom = hasCustomNoteMark(node)
      const number = custom ? undefined : ++this.automatic[kind]
      const label = custom ? `custom-${++this.custom[kind]}` : String(number)
      entry = { kind, id, number, textLabel: `${kind === 'endnote' ? 'e' : ''}${label}` }
      this.set(key, entry)
    }
    return entry
  }
}

const inventories = new WeakMap<ProseMirrorNode, NoteInventory>()

/** Rendering and pagination use the same accepted view as text and review summaries. */
export function noteInventory(body: ProseMirrorNode): NoteInventory {
  let notes = inventories.get(body)
  if (!notes) {
    notes = new NoteInventory()
    revisionContent(body).descendants((node) => {
      if (node.type.name === 'tableCell' && node.attrs.phantom) return false
      if (node.type.name === 'noteRef') notes!.reference(node)
      return true
    })
    inventories.set(body, notes)
  }
  return notes
}

/** An empty display label retains custom notes without inventing an automatic number. */
export function noteNumbers(body: ProseMirrorNode): Map<string, number | string> {
  return new Map([...noteInventory(body)].map(([key, reference]) => [key, reference.number ?? '']))
}
