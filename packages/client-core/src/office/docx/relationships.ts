import { LiveFormatError } from '../live-format.js'
import type { JmlElement } from './jsonml.js'

/** Internal copy metadata lives in preserved XML attributes, never in exported XML. */
export const PRESERVED_LINK = 'pulpo:href'
export const PRESERVED_IMAGE = 'pulpo:src'
export const COPY_RELATIONSHIPS = 'pulpo:relationships'
export const MAX_COPY_PARTS = 5_000
export const MAX_COPY_BYTES = 256 * 1024 * 1024
export interface CopyRelationship { type: string; target: string; targetMode?: 'External' }
export interface CopyPart { hash: string; size: number; contentType: string; rels: Record<string, CopyRelationship> }
export interface CopyManifest { version: 1; rels: Record<string, CopyRelationship>; parts: Record<string, CopyPart> }
export interface RelationshipReference { element?: string; attribute: string; id: string; bound?: boolean; src?: string }
export const isRelationshipAttribute = (name: string) => name.startsWith('r:') || name === 'o:relid'

function parsed(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return undefined }
}
export function isJmlElement(value: unknown): value is JmlElement {
  return Array.isArray(value) && typeof value[0] === 'string' && !!value[1] && typeof value[1] === 'object' && !Array.isArray(value[1])
}

/** Visit XML roots and packed marks without parsing XML text or rebuilding large trees. */
function visitStoredXml(value: unknown, visit: (attrs: Record<string, unknown>, name?: string, scope?: CopyManifest) => void): void {
  const walk = (value: unknown, inherited?: CopyManifest): void => {
    if (isJmlElement(value)) {
      const scope = copyManifest(value[1][COPY_RELATIONSHIPS]) ?? inherited
      visit(value[1], value[0], scope)
      for (const child of value.slice(2)) if (typeof child !== 'string') walk(child, scope)
    } else if (Array.isArray(value)) {
      for (const child of value) walk(child, inherited)
    } else if (value && typeof value === 'object') {
      const attrs = value as Record<string, unknown>
      const scope = copyManifest(typeof attrs[COPY_RELATIONSHIPS] === 'string' ? attrs[COPY_RELATIONSHIPS] : undefined) ?? inherited
      visit(attrs, undefined, scope)
      for (const [key, entry] of Object.entries(attrs)) {
        if (entry && typeof entry === 'object') walk(entry, scope)
        else if (key === 'v' && typeof entry === 'string') walk(parsed(entry), scope)
      }
    }
  }
  walk(typeof value === 'string' ? parsed(value) : value)
}

export function relationshipReferences(value: unknown): RelationshipReference[] {
  const refs: RelationshipReference[] = []
  visitStoredXml(value, (attrs, element, scope) => {
    for (const [attribute, id] of Object.entries(attrs)) if (isRelationshipAttribute(attribute) && typeof id === 'string' && id) refs.push({ element, attribute, id, ...(typeof attrs[PRESERVED_IMAGE] === 'string' ? { src: attrs[PRESERVED_IMAGE] } : {}), ...(scope && Object.hasOwn(scope.rels, id) ? { bound: true } : {}) })
  })
  return refs
}

export function preservedImageHashes(value: unknown): string[] {
  const hashes: string[] = []
  visitStoredXml(value, (attrs) => {
    const hash = attrs[PRESERVED_IMAGE]
    if (typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash)) hashes.push(hash)
  })
  return hashes
}

export function isPictureReference(ref: RelationshipReference): boolean {
  return ['a:blip', 'v:imagedata', 'v:fill'].includes(ref.element ?? '')
}

export function copyManifest(value: string | undefined): CopyManifest | undefined {
  const data = parsed(value) as CopyManifest | undefined
  if (data?.version !== 1 || !data.rels || typeof data.rels !== 'object' || !data.parts || typeof data.parts !== 'object' || Object.keys(data.parts).length > MAX_COPY_PARTS) return undefined
  let size = 0
  const relsValid = (rels: Record<string, CopyRelationship>) => Object.values(rels).every((rel) => rel && typeof rel.type === 'string' && typeof rel.target === 'string' && (!rel.targetMode || rel.targetMode === 'External'))
  if (!relsValid(data.rels)) return undefined
  for (const [path, part] of Object.entries(data.parts)) {
    // eslint-disable-next-line no-control-regex
    if (!part || typeof part !== 'object' || !/^word\/pulpo-copy\/[0-9a-f]{64}\/[^\\\u0000-\u001f]+$/.test(path) || path.split('/').some((part) => !part || part === '..' || part === '.') || !/^[0-9a-f]{64}$/.test(part.hash) || !Number.isSafeInteger(part.size) || part.size < 0 || typeof part.contentType !== 'string' || !part.rels || !relsValid(part.rels)) return undefined
    size += part.size
    if (size > MAX_COPY_BYTES) return undefined
  }
  const targetsExist = (rels: Record<string, CopyRelationship>) => Object.values(rels).every((rel) => rel.targetMode === 'External' || Object.hasOwn(data.parts, rel.target))
  if (!targetsExist(data.rels) || !Object.values(data.parts).every((part) => targetsExist(part.rels))) return undefined
  return data
}

export function manifestsIn(value: unknown): CopyManifest[] {
  if (typeof value === 'string' && !value.includes(COPY_RELATIONSHIPS)) return []
  const found: CopyManifest[] = []
  visitStoredXml(value, (attrs) => {
    const manifest = copyManifest(typeof attrs[COPY_RELATIONSHIPS] === 'string' ? attrs[COPY_RELATIONSHIPS] : undefined)
    if (manifest) found.push(manifest)
  })
  return found
}

/** Remap every descendant reference against the owning copied XML's relationship scope. */
export function remapStoredXml(value: unknown, resolve: (rel: CopyRelationship) => string): unknown {
  if (typeof value === 'string' && !value.includes(COPY_RELATIONSHIPS)) return value
  // First resolve each root's bindings, then use the general walker within that root.
  const walk = (data: unknown, inherited?: Record<string, string>): unknown => {
    if (isJmlElement(data)) {
      const attrs = data[1]
      const manifest = copyManifest(attrs[COPY_RELATIONSHIPS])
      const ids = manifest ? Object.fromEntries(Object.entries(manifest.rels).map(([id, rel]) => [id, resolve(rel)])) : inherited
      return [data[0], mappedAttrs(attrs, ids), ...data.slice(2).map((child) => typeof child === 'string' ? child : walk(child, ids))]
    }
    if (Array.isArray(data)) return data.map((child) => walk(child, inherited))
    if (data && typeof data === 'object') {
      const attrs = data as Record<string, unknown>
      const manifest = copyManifest(typeof attrs[COPY_RELATIONSHIPS] === 'string' ? attrs[COPY_RELATIONSHIPS] : undefined)
      const ids = manifest ? Object.fromEntries(Object.entries(manifest.rels).map(([id, rel]) => [id, resolve(rel)])) : inherited
      return Object.fromEntries(Object.entries(mappedAttrs(attrs, ids)).map(([key, entry]) => [key, key === 'v' && typeof entry === 'string' && parsed(entry) !== undefined ? JSON.stringify(walk(parsed(entry), ids)) : entry && typeof entry === 'object' ? walk(entry, ids) : entry]))
    }
    return data
  }
  const mappedAttrs = <T extends Record<string, unknown>>(attrs: T, ids?: Record<string, string>): T => Object.fromEntries(Object.entries(attrs).filter(([key]) => key !== COPY_RELATIONSHIPS).map(([key, value]) => {
    if (ids && isRelationshipAttribute(key) && typeof value === 'string' && value) {
      if (!Object.hasOwn(ids, value)) throw new LiveFormatError('corrupt', 'Unresolved copied relationship')
      return [key, ids[value]]
    }
    return [key, value]
  })) as T
  const data = parsed(value)
  if (data === undefined) return value
  const mapped = walk(data)
  return typeof value === 'string' ? JSON.stringify(mapped) : mapped
}
