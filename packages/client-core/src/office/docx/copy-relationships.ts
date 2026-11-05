import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import type * as Y from 'yjs'
import { LiveFormatError, type LiveAssetStore } from '../live-format.js'
import { OoxmlPackage, relationshipsPathFor, resolveTarget } from '../ooxml/package.js'
import { sha256Hex, sniffImage } from './export.js'
import { elementToJml } from './jsonml.js'
import { parseJson, readDocxMap, type PartRef } from './model.js'
import { REL } from './names.js'
import { COPY_RELATIONSHIPS, MAX_COPY_BYTES, MAX_COPY_PARTS, copyManifest, isJmlElement, isPictureReference, manifestsIn, relationshipReferences, type CopyManifest, type CopyPart, type CopyRelationship } from './relationships.js'

/** Ordinary text copies keep their immediate, synchronous paste path. */
export function needsRelatedParts(slice: Slice): boolean {
  let needed = false
  slice.content.descendants((node) => {
    if (needed) return false
    needed = (node.type.name === 'drawing' && !!node.attrs.src) || [...Object.values(node.attrs), ...node.marks.flatMap((mark) => Object.values(mark.attrs))].some((value) => relationshipReferences(value).length > 0)
    return !needed
  })
  return needed
}

export interface CopiedParts {
  slice: Slice
  /** Binary bytes travel through the clipboard cache, never the shared document. */
  assets: Record<string, { data: string; contentType: string }>
}
// Repeated references can share a large graph. Bound their serialized shared-state footprint too.
const MAX_COPY_METADATA_BYTES = 16 * 1024 * 1024
const tooLarge = () => new LiveFormatError('too_large', 'Too much to copy at once')
const base64 = (bytes: Uint8Array) => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** Capture the relationship scope at copy time, including every branch of preserved XML. */
export async function copyRelatedParts(slice: Slice, doc: Y.Doc, assets: LiveAssetStore, storyId = 'body'): Promise<CopiedParts> {
  const parts = readDocxMap(doc, 'parts')
  const meta = readDocxMap(doc, 'docx')
  const main = meta.get('mainPart') ?? 'word/document.xml'
  const story = parseJson<{ part?: string; kind?: string }>(doc.getMap<string>('stories').get(storyId))
  const mainRels = readDocxMap(doc, 'rels')
  const kind = story?.kind ?? storyId.split(':')[0]
  const storyRel = [...mainRels.values()].map((value) => parseJson<CopyRelationship>(value)).find((rel) => rel?.type === (kind === 'footnote' ? REL.footnotes : kind === 'endnote' ? REL.endnotes : kind === 'comment' ? REL.comments : ''))
  const part = storyId === 'body' ? main : story?.part ?? (storyRel ? resolveTarget(main, storyRel.target) : `word/${kind}s.xml`)
  const output: CopiedParts['assets'] = {}
  const bytesCache = new Map<string, Promise<Uint8Array>>()
  const relsCache = new Map<string, Promise<Record<string, CopyRelationship>>>()
  let total = 0
  const readAsset = async (hash: string, contentType = 'application/octet-stream') => {
    let pending = bytesCache.get(hash)
    if (!pending) {
      pending = assets.get(hash).then(async (bytes) => {
        total += bytes.length
        if (total > MAX_COPY_BYTES) throw tooLarge()
        if (await sha256Hex(bytes) !== hash) throw new LiveFormatError('corrupt', 'A copied asset has changed')
        output[hash] = { data: base64(bytes), contentType }
        return bytes
      })
      bytesCache.set(hash, pending)
    }
    const bytes = await pending
    if (contentType !== 'application/octet-stream') output[hash]!.contentType = contentType
    return bytes
  }
  const readPart = async (path: string): Promise<Uint8Array | undefined> => {
    const ref = parseJson<PartRef>(parts.get(path))
    if (!ref) return undefined
    if (ref.size > MAX_COPY_BYTES) throw tooLarge()
    return readAsset(ref.hash)
  }
  const relsFor = (path: string): Promise<Record<string, CopyRelationship>> => {
    let pending = relsCache.get(path)
    if (!pending) {
      pending = (async () => {
        const relsPath = relationshipsPathFor(path)
        const bytes = await readPart(relsPath)
        const pkg = new OoxmlPackage(bytes ? new Map([[relsPath, bytes]]) : new Map())
        const result: Record<string, CopyRelationship> = Object.create(null)
        for (const rel of pkg.relationships(path)) result[rel.id] = { type: rel.type, target: rel.targetMode === 'External' ? rel.target : resolveTarget(path, rel.target), ...(rel.targetMode ? { targetMode: rel.targetMode } : {}) }
        if (path === main) for (const [id, json] of mainRels) {
          const rel = parseJson<CopyRelationship>(json)
          if (rel) result[id] = { ...rel, target: rel.targetMode === 'External' ? rel.target : resolveTarget(path, rel.target) }
        }
        return result
      })()
      relsCache.set(path, pending)
    }
    return pending
  }
  const rootRels = await relsFor(part)
  const contentTypes = await readPart('[Content_Types].xml')
  const pkg = new OoxmlPackage(contentTypes ? new Map([['[Content_Types].xml', contentTypes]]) : new Map())
  const namespaces = Object.fromEntries(Object.entries({ ...parseJson<Record<string, string>>(meta.get('documentAttrs')), ...parseJson<{ attrs?: Record<string, string> }>(doc.getMap<string>('stories').get(storyId))?.attrs }).filter(([key]) => key.startsWith('xmlns:')))
  const graph = new Map<string, CopyPart>()
  const collecting = new Set<string>()
  const collect = async (path: string): Promise<void> => {
    if (collecting.has(path)) return
    collecting.add(path)
    if (collecting.size > MAX_COPY_PARTS) throw tooLarge()
    const ref = parseJson<PartRef>(parts.get(path))
    if (!ref) throw new LiveFormatError('corrupt', `A copied part is missing: ${path}`)
    const contentType = pkg.contentType(path) ?? 'application/octet-stream'
    const bytes = await readAsset(ref.hash, contentType)
    const rels: Record<string, CopyRelationship> = Object.assign(Object.create(null), await relsFor(path))
    // Extensions sometimes bind a reference in the owning story rather than their own part.
    if (/xml|\+xml/.test(contentType) || path.endsWith('.xml')) {
      if (bytes.length > MAX_COPY_METADATA_BYTES) throw tooLarge()
      const xml = new OoxmlPackage(new Map([[path, bytes]])).xml(path)?.documentElement
      if (xml) for (const { id } of relationshipReferences(elementToJml(xml))) {
        if (!Object.hasOwn(rels, id)) {
          if (!rootRels[id]) throw new LiveFormatError('corrupt', `A copied relationship is missing: ${id}`)
          rels[id] = rootRels[id]!
        }
      }
    }
    graph.set(path, { ...ref, size: bytes.length, contentType, rels })
    if (graph.size > MAX_COPY_PARTS) throw tooLarge()
    for (const rel of Object.values(rels)) if (rel.targetMode !== 'External') await collect(rel.target)
  }
  const manifestFor = async (value: unknown, src?: string): Promise<CopyManifest | undefined> => {
    const refs = relationshipReferences(value)
    if (!refs.length) return undefined
    const rels: Record<string, CopyRelationship> = Object.create(null)
    for (const ref of refs) {
      const rel = rootRels[ref.id]
      if (rel) {
        rels[ref.id] = rel
        if (rel.targetMode !== 'External') await collect(rel.target)
      } else if (src && isPictureReference(ref)) {
        const bytes = await readAsset(src)
        const image = sniffImage(bytes)
        output[src]!.contentType = image.mimeType
        const target = `word/media/pulpo-${src}.${image.extension}`
        graph.set(target, { hash: src, size: bytes.length, contentType: image.mimeType, rels: {} })
        if (graph.size > MAX_COPY_PARTS) throw tooLarge()
        rels[ref.id] = { type: REL.image, target }
      } else throw new LiveFormatError('corrupt', `A copied relationship is missing: ${ref.id}`)
    }
    // Only this root's reachable closure belongs in its metadata; sharing unrelated parts would
    // multiply large manifests and keep deleted objects' assets alive.
    const closure = new Map<string, CopyPart>()
    const pending = Object.values(rels).filter((rel) => rel.targetMode !== 'External').map((rel) => rel.target)
    for (let i = 0; i < pending.length; i++) {
      const path = pending[i]!
      if (closure.has(path)) continue
      const entry = graph.get(path)!
      closure.set(path, entry)
      for (const rel of Object.values(entry.rels)) if (rel.targetMode !== 'External') pending.push(rel.target)
    }
    const prefix = `word/pulpo-copy/${await sha256Hex(JSON.stringify([...closure].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)))}/`
    const rename = (rels: Record<string, CopyRelationship>) => Object.fromEntries(Object.entries(rels).map(([id, rel]) => [id, rel.targetMode === 'External' ? rel : { ...rel, target: prefix + rel.target }]))
    return { version: 1, rels: rename(rels), parts: Object.fromEntries([...closure].map(([path, entry]) => [prefix + path, { ...entry, rels: rename(entry.rels) }])) }
  }
  const bind = async (value: unknown, src?: string): Promise<unknown> => {
    if (typeof value !== 'string') return value
    let parsed: unknown
    try { parsed = JSON.parse(value) } catch { return value }
    const walk = async (data: unknown): Promise<unknown> => {
      if (isJmlElement(data)) {
        const existing = copyManifest(data[1][COPY_RELATIONSHIPS])
        if (existing) {
          for (const entry of Object.values(existing.parts)) await readAsset(entry.hash, entry.contentType)
          return data
        }
        const manifest = await manifestFor(data, src)
        return manifest ? [data[0], { ...namespaces, ...data[1], [COPY_RELATIONSHIPS]: JSON.stringify(manifest) }, ...data.slice(2)] : data
      }
      if (Array.isArray(data)) {
        const entries = []
        for (const entry of data) entries.push(await walk(entry))
        return entries
      }
      if (data && typeof data === 'object') {
        const object = data as Record<string, unknown>
        if (typeof object.v === 'string') return { ...object, v: await bind(object.v, src) }
        if (object.attrs) return { ...object, attrs: await walk(object.attrs) }
        const existing = copyManifest(object[COPY_RELATIONSHIPS] as string | undefined)
        if (existing) {
          for (const entry of Object.values(existing.parts)) await readAsset(entry.hash, entry.contentType)
          return object
        }
        const manifest = await manifestFor(object, src)
        return manifest ? { ...namespaces, ...object, [COPY_RELATIONSHIPS]: JSON.stringify(manifest) } : object
      }
      return data
    }
    return JSON.stringify(await walk(parsed))
  }
  const boundValues = new Map<string, Promise<unknown>>()
  const bound = (value: unknown, src?: string): Promise<unknown> => {
    if (typeof value !== 'string') return Promise.resolve(value)
    const key = JSON.stringify([value, src])
    let result = boundValues.get(key)
    if (!result) { result = bind(value, src); boundValues.set(key, result) }
    return result
  }
  let metadataBytes = 0
  const countMetadata = (value: unknown) => {
    if (typeof value === 'string') metadataBytes += value.length * 2
    if (metadataBytes > MAX_COPY_METADATA_BYTES) throw tooLarge()
    return value
  }
  const node = async (child: ProseMirrorNode): Promise<ProseMirrorNode> => {
    const src = child.type.name === 'drawing' && typeof child.attrs.src === 'string' ? child.attrs.src : undefined
    if (src) await readAsset(src)
    const attrs: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(child.attrs)) attrs[key] = countMetadata(await bound(value, src))
    const marks = []
    for (const mark of child.marks) {
      const attrs: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(mark.attrs)) attrs[key] = countMetadata(await bound(value))
      marks.push(mark.type.create(attrs))
    }
    if (child.isText) return child.mark(marks)
    const children: ProseMirrorNode[] = []
    for (let i = 0; i < child.childCount; i++) children.push(await node(child.child(i)))
    return child.type.create(attrs, children, marks)
  }
  const children: ProseMirrorNode[] = []
  for (let i = 0; i < slice.content.childCount; i++) children.push(await node(slice.content.child(i)))
  // Relationship XML and content types were read to build the graph, but aren't copied assets.
  const used = new Set<string>()
  for (const child of children) {
    child.descendants((node) => {
      if (node.type.name === 'drawing' && typeof node.attrs.src === 'string') used.add(node.attrs.src)
      for (const value of [...Object.values(node.attrs), ...node.marks.flatMap((mark) => Object.values(mark.attrs))]) for (const manifest of manifestsIn(value)) for (const entry of Object.values(manifest.parts)) used.add(entry.hash)
    })
    if (child.type.name === 'drawing' && typeof child.attrs.src === 'string') used.add(child.attrs.src)
    for (const value of [...Object.values(child.attrs), ...child.marks.flatMap((mark) => Object.values(mark.attrs))]) for (const manifest of manifestsIn(value)) for (const entry of Object.values(manifest.parts)) used.add(entry.hash)
  }
  return { slice: new Slice(Fragment.fromArray(children), slice.openStart, slice.openEnd), assets: Object.fromEntries(Object.entries(output).filter(([hash]) => used.has(hash))) }
}

/** Import into the destination's asset namespace before inserting any shared references. */
export async function receiveCopiedParts(copy: CopiedParts, assets: LiveAssetStore): Promise<Slice> {
  let total = 0
  for (const [hash, entry] of Object.entries(copy.assets)) {
    total += entry.data.length * 0.75
    if (total > MAX_COPY_BYTES || !/^[0-9a-f]{64}$/.test(hash)) throw tooLarge()
    const bytes = Uint8Array.from(atob(entry.data), (char) => char.charCodeAt(0))
    if (await sha256Hex(bytes) !== hash) throw new LiveFormatError('corrupt', 'Invalid copied asset')
    const stored = await assets.put(bytes, entry.contentType)
    if (stored.hash !== hash) throw new LiveFormatError('corrupt', 'A copied asset has changed')
  }
  return copy.slice
}
