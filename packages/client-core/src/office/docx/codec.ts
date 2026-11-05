import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import * as Y from 'yjs'
import { transactChanges } from '../assets.js'
import { LiveFormatError, type LiveFormatCodec, type LiveFormatContext } from '../live-format.js'
import { blankDocx } from './blank.js'
import { exportDocx, fingerprintParts, idMaps } from './export.js'
import { importDocx } from './import.js'
import { readDocxMap, readDocxModel, writeDocxModel, type CommentMeta, type DocxModel, type StoryMeta } from './model.js'
import { DOCX_EXTENSIONS, DOCX_SCHEMA_VERSION, docxMimeType } from './format.js'
import { BODY_FRAGMENT, STORY_PREFIX, parseJson, type PartRef } from './model.js'
import { docxToText } from './text.js'

export { DOCX_SCHEMA_VERSION }

const EXTENSIONS = DOCX_EXTENSIONS

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.')
  const extension = index < 0 ? '' : name.slice(index + 1).toLowerCase()
  return (EXTENSIONS as readonly string[]).includes(extension) ? extension : 'docx'
}

/** Imports bytes into a model with fingerprints of its regenerated parts. */
async function importWithFingerprints(bytes: Uint8Array, context: LiveFormatContext): Promise<DocxModel> {
  const model = await importDocx(bytes, context.assets)
  for (const [path, hash] of await fingerprintParts(model, context.assets)) model.maps.docx.set(`fingerprint:${path}`, hash)
  model.maps.docx.set('schemaVersion', String(DOCX_SCHEMA_VERSION))
  return model
}

function withCurrentRegeneratedParts(doc: Y.Doc, model: DocxModel): DocxModel {
  const currentParts = readDocxMap(doc, 'parts')
  const currentMeta = readDocxMap(doc, 'docx')
  const parts = new Map(model.maps.parts)
  const docx = new Map([...model.maps.docx].filter(([key]) => !key.startsWith('fingerprint:')))
  for (const [key, value] of currentMeta) if (key.startsWith('fingerprint:')) docx.set(key, value)
  const regenerated = new Set([...model.maps.docx.keys(), ...currentMeta.keys()].filter((key) => key.startsWith('fingerprint:')).map((key) => key.slice('fingerprint:'.length)))
  for (const path of regenerated) {
    const current = currentParts.get(path)
    if (current !== undefined) parts.set(path, current)
    else parts.delete(path)
  }
  return { ...model, maps: { ...model.maps, parts, docx } }
}

function assertEmpty(doc: Y.Doc): void {
  if (doc.getXmlFragment('body').length || doc.getMap('parts').size) throw new LiveFormatError('corrupt', 'The document is not empty')
}

/**
 * Word documents (.docx, and .dotx/.docm/.dotm, whose macros are kept as bytes but never run).
 * See `model.ts` for the Y.Doc layout and `docs/office-documents.md` for what is modeled.
 */
export const docxCodec: LiveFormatCodec = {
  id: 'document',
  schemaVersion: DOCX_SCHEMA_VERSION,
  extensions: EXTENSIONS,
  mimeType: docxMimeType,
  async createEmpty(doc, context) {
    assertEmpty(doc)
    const model = await importWithFingerprints(blankDocx(), context)
    doc.transact(() => { writeDocxModel(doc, model) })
  },
  async importFile(doc, bytes, context) {
    assertEmpty(doc)
    const model = await importWithFingerprints(bytes, context)
    doc.transact(() => { writeDocxModel(doc, model) })
  },
  async exportFile(doc, context) {
    return exportDocx(readDocxModel(doc), context.assets, extensionOf(context.name))
  },
  async applyFile(doc, bytes, context, origin) {
    const model = keepCurrentIds(await importWithFingerprints(bytes, context), readDocxModel(doc))
    const changed = transactChanges(doc, () => {
      // The bytes of parts the model regenerates only matter when content changed: a file that
      // reads the same must not count as a change because the earlier export was regenerated.
      if (writeDocxModel(doc, withCurrentRegeneratedParts(doc, model))) writeDocxModel(doc, model)
    }, origin)
    return { changed }
  },
  toText(doc) {
    return docxToText(readDocxModel(doc))
  },
  referencedAssets(doc) {
    return [...referencedAssets(doc)]
  },
}

/** Every asset a document still uses: its package's parts and the pictures in its stories. */
export function referencedAssets(doc: Y.Doc): Set<string> {
  const hashes = new Set<string>()
  doc.getMap<string>('parts').forEach((json) => {
    const ref = parseJson<PartRef>(json)
    if (ref?.hash) hashes.add(ref.hash)
  })
  const visit = (node: Y.XmlElement | Y.XmlFragment) => {
    for (const child of node.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue
      if (child.nodeName === 'drawing') {
        const src = child.getAttribute('src')
        if (typeof src === 'string' && src) hashes.add(src)
      }
      visit(child)
    }
  }
  visit(doc.getXmlFragment(BODY_FRAGMENT))
  doc.getMap<string>('stories').forEach((_meta, id) => visit(doc.getXmlFragment(STORY_PREFIX + id)))
  return hashes
}

/**
 * Comments and notes made in Pulpo have string ids that export numbers. A file pushed back uses
 * numbers; mapping them back to the document's own ids keeps the same stories (and edits in
 * progress on them, and replies to them) instead of deleting them and creating numbered copies.
 * Each is matched by content first (author, date, and text), which holds whatever numbering the
 * file was made from, then by the number the current document would export.
 */
export function keepCurrentIds(model: DocxModel, current: DocxModel): DocxModel {
  const numbered = idMaps(current)
  const storyText = (doc: DocxModel, id: string) => doc.stories.get(id)?.doc.textContent ?? ''
  const commentKey = (doc: DocxModel, id: string) => {
    const meta = parseJson<CommentMeta>(doc.maps.comments.get(id)) ?? {}
    return JSON.stringify([meta.author ?? '', meta.initials ?? '', meta.date ?? '', storyText(doc, `comment:${id}`)])
  }
  const match = (imported: string[], existing: string[], key: (doc: DocxModel, id: string) => string, numbers: Map<string, string>, comments = false) => {
    const result = new Map<string, string>()
    const existingSet = new Set(existing)
    const importedSet = new Set(imported)
    const claimed = new Set<string>()
    const free = new Map<string, string[]>()
    for (const id of existing) {
      if (/^-?\d+$/.test(id) || importedSet.has(id)) continue
      const k = key(current, id)
      free.set(k, [...free.get(k) ?? [], id])
    }
    for (const id of imported) {
      if (existingSet.has(id)) continue
      const target = free.get(key(model, id))?.shift()
      if (target) {
        result.set(id, target)
        claimed.add(target)
      }
    }
    if (comments) {
      for (const id of imported) {
        if (result.has(id) || existingSet.has(id)) continue
        const meta = parseJson<CommentMeta>(model.maps.comments.get(id))
        if (!meta?.date) continue
        const target = existing.find((candidate) => {
          if (/^-?\d+$/.test(candidate) || claimed.has(candidate) || importedSet.has(candidate)) return false
          const other = parseJson<CommentMeta>(current.maps.comments.get(candidate))
          return (meta.author ?? '') === (other?.author ?? '') && (meta.initials ?? '') === (other?.initials ?? '') && meta.date === other?.date
        })
        if (target) {
          result.set(id, target)
          claimed.add(target)
        }
      }
    }
    const back = new Map<string, string>()
    for (const [id, number] of numbers) if (id !== number) back.set(number, id)
    for (const id of imported) {
      if (result.has(id) || existingSet.has(id)) continue
      const target = back.get(id)
      if (target && !claimed.has(target) && !importedSet.has(target) && (!comments || parseJson<CommentMeta>(model.maps.comments.get(id))?.author === parseJson<CommentMeta>(current.maps.comments.get(target))?.author)) {
        result.set(id, target)
        claimed.add(target)
      }
    }
    return result
  }
  const noteIds = (doc: DocxModel, kind: string) => [...doc.stories.keys()].filter((id) => id.startsWith(`${kind}:`)).map((id) => id.slice(kind.length + 1))
  const noteKey = (kind: string) => (doc: DocxModel, id: string) => storyText(doc, `${kind}:${id}`)
  const comments = match([...model.maps.comments.keys()], [...current.maps.comments.keys()], commentKey, numbered.comments, true)
  const notes = {
    footnote: match(noteIds(model, 'footnote'), noteIds(current, 'footnote'), noteKey('footnote'), numbered.footnote),
    endnote: match(noteIds(model, 'endnote'), noteIds(current, 'endnote'), noteKey('endnote'), numbered.endnote),
  }
  if (!comments.size && !notes.footnote.size && !notes.endnote.size) return model
  const commentId = (id: string) => comments.get(id) ?? id
  const noteId = (kind: string, id: string) => (kind === 'footnote' || kind === 'endnote' ? notes[kind].get(id) : undefined) ?? id
  const storyId = (id: string) => {
    const kind = id.slice(0, id.indexOf(':'))
    const rest = id.slice(id.indexOf(':') + 1)
    if (kind === 'comment') return `comment:${commentId(rest)}`
    if (kind === 'footnote' || kind === 'endnote') return `${kind}:${noteId(kind, rest)}`
    return id
  }
  // Ids also live in stored XML: comment markers between blocks and cells exist only there.
  const MARKER = /^w:comment(RangeStart|RangeEnd|Reference)$/
  const rewrite = (value: unknown): unknown => {
    if (typeof value !== 'string' || !/"w:(comment|footnoteReference|endnoteReference)/.test(value)) return value
    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch {
      return value
    }
    let touched = false
    const visit = (node: unknown) => {
      if (!Array.isArray(node)) return
      const [name, attrs] = node as [unknown, unknown]
      if (typeof name === 'string' && attrs && typeof attrs === 'object' && !Array.isArray(attrs)) {
        const record = attrs as Record<string, unknown>
        const id = record['w:id']
        if (typeof id === 'string') {
          const next = MARKER.test(name) ? commentId(id) : name === 'w:footnoteReference' ? noteId('footnote', id) : name === 'w:endnoteReference' ? noteId('endnote', id) : id
          if (next !== id) {
            record['w:id'] = next
            touched = true
          }
        }
      }
      for (const child of node) visit(child)
    }
    visit(parsed)
    return touched ? JSON.stringify(parsed) : value
  }
  const renameAttrs = <T extends Record<string, unknown>>(attrs: T): T => {
    let result = attrs
    for (const [key, value] of Object.entries(attrs)) {
      const next = rewrite(value)
      if (next !== value) {
        if (result === attrs) result = { ...attrs }
        ;(result as Record<string, unknown>)[key] = next
      }
    }
    return result
  }
  const rename = (node: ProseMirrorNode): ProseMirrorNode => {
    const marks = node.marks.map((mark) => {
      const attrs = renameAttrs(mark.attrs)
      return attrs === mark.attrs ? mark : mark.type.create(attrs)
    })
    if (node.isText) return node.mark(marks)
    let attrs = renameAttrs(node.attrs)
    if (node.type.name === 'commentMark' && typeof attrs.id === 'string') attrs = { ...attrs, id: commentId(attrs.id) }
    else if (node.type.name === 'noteRef' && typeof attrs.id === 'string') attrs = { ...attrs, id: noteId(String(attrs.kind), attrs.id) }
    if (node.isLeaf) return node.type.create(attrs, null, marks)
    const children: ProseMirrorNode[] = []
    node.forEach((child) => { children.push(rename(child)) })
    return node.type.create(attrs, children, marks)
  }
  const stories = new Map<string, { meta: StoryMeta; doc: ProseMirrorNode }>()
  for (const [id, story] of model.stories) stories.set(storyId(id), { meta: story.meta, doc: rename(story.doc) })
  const commentMaps = new Map<string, string>()
  for (const [id, json] of model.maps.comments) {
    const meta = parseJson<CommentMeta>(json)
    commentMaps.set(commentId(id), meta?.parentId ? JSON.stringify({ ...meta, parentId: commentId(meta.parentId) }) : json)
  }
  return { body: rename(model.body), stories, maps: { ...model.maps, comments: commentMaps } }
}
