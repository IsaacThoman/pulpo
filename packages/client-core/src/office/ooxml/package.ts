import { DOMParser, XMLSerializer, type Document as XmlDocument } from '@xmldom/xmldom'
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { LiveFormatError } from '../live-format.js'

/** The time every written entry carries (local, so the DOS date fields are the same everywhere). */
const ZIP_TIME = new Date(1980, 0, 1)

/**
 * Open Packaging Conventions (the zip container of .docx, .xlsx, and .pptx): parts, content types,
 * and relationships. Parts nobody touches are written back byte for byte.
 */

export type { XmlDocument }

export const CONTENT_TYPES_PATH = '[Content_Types].xml'
export const PACKAGE_RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
export const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'
export const OFFICE_RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

export interface PackageLimits {
  /** Most entries a package may hold. */
  maxEntries: number
  /** Most bytes all entries may expand to, against zip bombs. */
  maxUncompressedBytes: number
}

export const DEFAULT_PACKAGE_LIMITS: PackageLimits = {
  maxEntries: 10_000,
  maxUncompressedBytes: 512 * 1024 * 1024,
}

export interface Relationship {
  id: string
  type: string
  /** As written in the file: relative to the source part's folder unless external. */
  target: string
  targetMode?: 'External'
}

const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const ZIP_SIGNATURE = [0x50, 0x4b]

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte)
}

/** Normalizes a part name: no leading slash, forward slashes, `.`/`..` resolved. */
export function normalizePartPath(path: string): string {
  const segments: string[] = []
  for (const segment of path.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  return segments.join('/')
}

/** The folder a part lives in, with a trailing slash ('' at the root). */
export function partFolder(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index + 1)
}

/** The relationships part that belongs to `partPath` ('' for the package's own relationships). */
export function relationshipsPathFor(partPath: string): string {
  if (!partPath) return '_rels/.rels'
  const folder = partFolder(partPath)
  return `${folder}_rels/${partPath.slice(folder.length)}.rels`
}

/** Resolves a relationship target against its source part, as a part path. */
export function resolveTarget(sourcePartPath: string, target: string): string {
  if (target.startsWith('/')) return normalizePartPath(target)
  return normalizePartPath(partFolder(sourcePartPath) + target)
}

/** The target to write in `sourcePartPath`'s relationships for the part at `targetPartPath`. */
export function relativeTarget(sourcePartPath: string, targetPartPath: string): string {
  const from = partFolder(sourcePartPath).split('/').filter(Boolean)
  const to = normalizePartPath(targetPartPath).split('/')
  let common = 0
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++
  return [...Array(from.length - common).fill('..'), ...to.slice(common)].join('/')
}

export function parseXml(source: string): XmlDocument {
  const errors: string[] = []
  let document: XmlDocument
  try {
    document = new DOMParser({
      onError: (level, message) => {
        if (level !== 'warning') errors.push(message)
      },
    }).parseFromString(source, 'application/xml')
  } catch (error) {
    throw new LiveFormatError('corrupt', `Malformed XML: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
  if (errors.length || !document.documentElement) {
    throw new LiveFormatError('corrupt', `Malformed XML: ${errors[0] ?? 'no root element'}`)
  }
  return document
}

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

export function serializeXml(document: XmlDocument): string {
  const body = new XMLSerializer().serializeToString(document).replace(/^<\?xml[^?]*\?>\s*/, '')
  return XML_DECLARATION + body
}

/** Decodes a part as text: UTF-8, or UTF-16 when it starts with a byte order mark. */
export function decodePartText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  return strFromU8(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes)
}

/**
 * Refuses zips whose central directory and local headers name an entry differently. Readers
 * disagree on which to trust, so such a file shows one document to Pulpo and another to Word
 * (or to a virus scanner): a known way to smuggle content.
 */
function assertConsistentZip(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      end = offset
      break
    }
  }
  if (end < 0) return
  const count = view.getUint16(end + 10, true)
  let offset = view.getUint32(end + 16, true)
  // Zip64 archives keep these in another record; fflate validates those itself.
  if (count === 0xffff || offset === 0xffffffff) return
  // Readers that find the directory by its size and readers that follow its offset must agree.
  if (offset + view.getUint32(end + 12, true) !== end) throw new LiveFormatError('corrupt', 'This zip package has a misplaced directory')
  const decoder = new TextDecoder()
  for (let index = 0; index < count; index++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) throw new LiveFormatError('corrupt', 'This zip package has a damaged directory')
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const local = view.getUint32(offset + 42, true)
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength)
    // An Info-ZIP Unicode Path field renames the entry for readers that honor it.
    for (let field = offset + 46 + nameLength; field + 4 <= offset + 46 + nameLength + extraLength;) {
      const id = view.getUint16(field, true)
      const size = view.getUint16(field + 2, true)
      if (id === 0x7075 && size >= 5 && decoder.decode(bytes.subarray(field + 9, field + 4 + size)) !== decoder.decode(name)) {
        throw new LiveFormatError('corrupt', 'This zip package names its parts inconsistently')
      }
      field += 4 + size
    }
    if (local !== 0xffffffff) {
      if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) throw new LiveFormatError('corrupt', 'This zip package has a damaged entry')
      const localLength = view.getUint16(local + 26, true)
      const localName = bytes.subarray(local + 30, local + 30 + localLength)
      if (decoder.decode(localName) !== decoder.decode(name)) throw new LiveFormatError('corrupt', 'This zip package names its parts inconsistently')
    }
    offset += 46 + nameLength + extraLength + commentLength
  }
}

export class OoxmlPackage {
  /** Part bytes by normalized path, in the order they were read or added. */
  private readonly parts: Map<string, Uint8Array>
  private readonly xmlCache = new Map<string, XmlDocument>()
  /** How each cached document serialized when it was read, so parts only read stay byte for byte. */
  private readonly pristine = new Map<string, string>()

  constructor(parts: Map<string, Uint8Array> = new Map()) {
    this.parts = parts
  }

  /** Reads a package. Throws LiveFormatError for encrypted, legacy binary, or malformed files. */
  static read(bytes: Uint8Array, limits: PackageLimits = DEFAULT_PACKAGE_LIMITS): OoxmlPackage {
    if (startsWith(bytes, CFB_SIGNATURE)) {
      // Encrypted OOXML is wrapped in a compound file; so are legacy .doc/.xls/.ppt files.
      throw new LiveFormatError('encrypted', 'This file is password protected or in a legacy binary format')
    }
    if (!startsWith(bytes, ZIP_SIGNATURE)) throw new LiveFormatError('corrupt', 'This is not an Office Open XML package')
    try {
      assertConsistentZip(bytes)
    } catch (error) {
      if (error instanceof LiveFormatError) throw error
      throw new LiveFormatError('corrupt', 'This zip package has a damaged directory', { cause: error })
    }
    let entries = 0
    let declared = 0
    let files: Record<string, Uint8Array>
    try {
      files = unzipSync(bytes, {
        filter: (file) => {
          entries++
          declared += file.originalSize
          if (entries > limits.maxEntries) throw new LiveFormatError('too_large', 'This file has too many parts')
          if (declared > limits.maxUncompressedBytes) throw new LiveFormatError('too_large', 'This file expands to too much data')
          return !file.name.endsWith('/')
        },
      })
    } catch (error) {
      if (error instanceof LiveFormatError) throw error
      throw new LiveFormatError('corrupt', 'This file is not a readable zip package', { cause: error })
    }
    let actual = 0
    const parts = new Map<string, Uint8Array>()
    for (const [name, data] of Object.entries(files)) {
      actual += data.byteLength
      if (actual > limits.maxUncompressedBytes) throw new LiveFormatError('too_large', 'This file expands to too much data')
      parts.set(normalizePartPath(name), data)
    }
    if (!parts.has(CONTENT_TYPES_PATH)) throw new LiveFormatError('corrupt', 'This package has no [Content_Types].xml')
    return new OoxmlPackage(parts)
  }

  /**
   * Writes the package. `[Content_Types].xml` goes first, as some readers expect. Entries carry a
   * fixed time, so the same content always writes the same bytes: versions are checksums of
   * exports, and an export that changed with the clock would look like an edit.
   */
  write(): Uint8Array {
    this.flushXml()
    const files: Zippable = {}
    const contentTypes = this.parts.get(CONTENT_TYPES_PATH)
    if (contentTypes) files[CONTENT_TYPES_PATH] = [contentTypes, { level: 6, mtime: ZIP_TIME }]
    for (const [path, data] of this.parts) {
      if (path === CONTENT_TYPES_PATH) continue
      // Media is usually compressed already; storing it saves time without growing the file.
      const stored = /\.(png|jpe?g|gif|mp4|mp3|m4a|wdp|zip)$/i.test(path)
      files[path] = [data, { level: stored ? 0 : 6, mtime: ZIP_TIME }]
    }
    return zipSync(files, { mtime: ZIP_TIME })
  }

  paths(): string[] {
    this.flushXml()
    return [...this.parts.keys()]
  }

  has(path: string): boolean {
    const normalized = normalizePartPath(path)
    return this.xmlCache.has(normalized) || this.parts.has(normalized)
  }

  get(path: string): Uint8Array | undefined {
    const normalized = normalizePartPath(path)
    const cached = this.xmlCache.get(normalized)
    if (cached) this.flushPart(normalized, cached)
    return this.parts.get(normalized)
  }

  set(path: string, data: Uint8Array): void {
    const normalized = normalizePartPath(path)
    this.xmlCache.delete(normalized)
    this.pristine.delete(normalized)
    this.parts.set(normalized, data)
  }

  delete(path: string): void {
    const normalized = normalizePartPath(path)
    this.xmlCache.delete(normalized)
    this.pristine.delete(normalized)
    this.parts.delete(normalized)
  }

  text(path: string): string | undefined {
    const data = this.get(path)
    return data && decodePartText(data)
  }

  /**
   * A part as a mutable XML document. Changes to it are written back when the package is written,
   * so callers edit the returned document in place.
   */
  xml(path: string): XmlDocument | undefined {
    const normalized = normalizePartPath(path)
    const cached = this.xmlCache.get(normalized)
    if (cached) return cached
    const text = this.text(normalized)
    if (text === undefined) return undefined
    const document = parseXml(text)
    this.xmlCache.set(normalized, document)
    this.pristine.set(normalized, serializeXml(document))
    return document
  }

  setXml(path: string, document: XmlDocument | string): void {
    const normalized = normalizePartPath(path)
    if (typeof document === 'string') {
      this.set(normalized, strToU8(document))
      return
    }
    this.parts.set(normalized, new Uint8Array())
    this.pristine.delete(normalized)
    this.xmlCache.set(normalized, document)
  }

  /** Writes a cached document back to its bytes unless it still reads as it did when parsed. */
  private flushPart(path: string, document: XmlDocument): void {
    const xml = serializeXml(document)
    if (xml === this.pristine.get(path)) return
    this.parts.set(path, strToU8(xml))
    this.pristine.set(path, xml)
  }

  private flushXml(): void {
    for (const [path, document] of this.xmlCache) this.flushPart(path, document)
  }

  /** The content type of a part: its Override, else the Default for its extension. */
  contentType(path: string): string | undefined {
    const types = this.xml(CONTENT_TYPES_PATH)
    if (!types) return undefined
    const partName = '/' + normalizePartPath(path)
    const overrides = types.getElementsByTagNameNS(CONTENT_TYPES_NS, 'Override')
    for (let index = 0; index < overrides.length; index++) {
      const override = overrides.item(index)!
      if (override.getAttribute('PartName')?.toLowerCase() === partName.toLowerCase()) return override.getAttribute('ContentType') ?? undefined
    }
    const extension = partName.slice(partName.lastIndexOf('.') + 1).toLowerCase()
    const defaults = types.getElementsByTagNameNS(CONTENT_TYPES_NS, 'Default')
    for (let index = 0; index < defaults.length; index++) {
      const entry = defaults.item(index)!
      if (entry.getAttribute('Extension')?.toLowerCase() === extension) return entry.getAttribute('ContentType') ?? undefined
    }
    return undefined
  }

  /** Paths of every part with this content type. */
  partsOfType(contentType: string): string[] {
    return this.paths().filter((path) => this.contentType(path) === contentType)
  }

  /** Declares a part's content type with an Override (replacing any earlier one). */
  setContentType(path: string, contentType: string): void {
    const types = this.xml(CONTENT_TYPES_PATH)
    if (!types?.documentElement) throw new LiveFormatError('corrupt', 'This package has no [Content_Types].xml')
    const partName = '/' + normalizePartPath(path)
    const overrides = types.getElementsByTagNameNS(CONTENT_TYPES_NS, 'Override')
    for (let index = 0; index < overrides.length; index++) {
      const override = overrides.item(index)!
      if (override.getAttribute('PartName')?.toLowerCase() === partName.toLowerCase()) {
        override.setAttribute('ContentType', contentType)
        return
      }
    }
    const override = types.createElementNS(CONTENT_TYPES_NS, 'Override')
    override.setAttribute('PartName', partName)
    override.setAttribute('ContentType', contentType)
    types.documentElement.appendChild(override)
  }

  /** Makes sure files with `extension` have a Default content type. */
  ensureDefaultContentType(extension: string, contentType: string): void {
    const types = this.xml(CONTENT_TYPES_PATH)
    if (!types?.documentElement) throw new LiveFormatError('corrupt', 'This package has no [Content_Types].xml')
    const defaults = types.getElementsByTagNameNS(CONTENT_TYPES_NS, 'Default')
    for (let index = 0; index < defaults.length; index++) {
      if (defaults.item(index)!.getAttribute('Extension')?.toLowerCase() === extension.toLowerCase()) return
    }
    const entry = types.createElementNS(CONTENT_TYPES_NS, 'Default')
    entry.setAttribute('Extension', extension)
    entry.setAttribute('ContentType', contentType)
    types.documentElement.insertBefore(entry, types.documentElement.firstChild)
  }

  /** The relationships of `partPath` ('' for the package's own). */
  relationships(partPath: string): Relationship[] {
    const document = this.xml(relationshipsPathFor(partPath))
    if (!document) return []
    const elements = document.getElementsByTagNameNS(PACKAGE_RELATIONSHIPS_NS, 'Relationship')
    const relationships: Relationship[] = []
    for (let index = 0; index < elements.length; index++) {
      const element = elements.item(index)!
      relationships.push({
        id: element.getAttribute('Id') ?? '',
        type: element.getAttribute('Type') ?? '',
        target: element.getAttribute('Target') ?? '',
        ...(element.getAttribute('TargetMode') === 'External' ? { targetMode: 'External' as const } : {}),
      })
    }
    return relationships
  }

  /** The part path a relationship of `partPath` points to, or undefined for external targets. */
  relationshipTarget(partPath: string, id: string): string | undefined {
    const relationship = this.relationships(partPath).find((entry) => entry.id === id)
    if (!relationship || relationship.targetMode === 'External') return undefined
    return resolveTarget(partPath, relationship.target)
  }

  /** Parts `partPath` links to with `type`, resolved to part paths. */
  relatedParts(partPath: string, type: string): string[] {
    return this.relationships(partPath)
      .filter((entry) => entry.type === type && entry.targetMode !== 'External')
      .map((entry) => resolveTarget(partPath, entry.target))
  }

  /** Adds a relationship from `partPath` and returns its new id (`rIdN`, unused so far). */
  addRelationship(partPath: string, type: string, target: string, targetMode?: 'External'): string {
    const relsPath = relationshipsPathFor(partPath)
    let document = this.xml(relsPath)
    if (!document) {
      this.setXml(relsPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NS}"/>`)
      document = this.xml(relsPath)!
    }
    const taken = new Set(this.relationships(partPath).map((entry) => entry.id))
    let next = taken.size + 1
    while (taken.has(`rId${next}`)) next++
    const id = `rId${next}`
    const element = document.createElementNS(PACKAGE_RELATIONSHIPS_NS, 'Relationship')
    element.setAttribute('Id', id)
    element.setAttribute('Type', type)
    element.setAttribute('Target', target)
    if (targetMode) element.setAttribute('TargetMode', targetMode)
    document.documentElement!.appendChild(element)
    return id
  }

  /** Removes a relationship from `partPath`. */
  removeRelationship(partPath: string, id: string): void {
    const document = this.xml(relationshipsPathFor(partPath))
    if (!document) return
    const elements = document.getElementsByTagNameNS(PACKAGE_RELATIONSHIPS_NS, 'Relationship')
    for (let index = 0; index < elements.length; index++) {
      const element = elements.item(index)!
      if (element.getAttribute('Id') === id) {
        element.parentNode?.removeChild(element)
        return
      }
    }
  }

  /** The main part of the package (the officeDocument relationship), e.g. `word/document.xml`. */
  mainPart(): string | undefined {
    return this.relatedParts('', `${OFFICE_RELATIONSHIPS_NS}/officeDocument`)[0]
  }
}
