import { Inflate, strFromU8 } from 'fflate'
import { LiveFormatError } from '../live-format.js'

// Internal ZIP reader for OPC. We own directory/header validation and output accounting;
// fflate only decodes raw deflate streams. unzipSync trusts sizes and does not verify CRCs.
// Record layouts: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
interface ZipLimits {
  maxEntries: number
  maxUncompressedBytes: number
}

interface ZipEntry {
  name: string
  local: number
  start: number
  end: number
  recordEnd: number
  size: number
  crc: number
  method: number
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0)
  return value >>> 0
})

function updateCrc(crc: number, bytes: Uint8Array): number {
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255]! ^ (crc >>> 8)
  return crc
}

/** ZIP's CRC-32, shared by the bounded reader and the deterministic writer. */
export function zipCrc32(bytes: Uint8Array): number {
  return (updateCrc(-1, bytes) ^ -1) >>> 0
}

function corrupt(message: string): never {
  throw new LiveFormatError('corrupt', `This zip package ${message}`)
}

/** Internal descriptor parser, shared by the reader and small ambiguous-layout regressions. */
export function zipDescriptorEnd(view: DataView, offset: number, boundary: number, zip64: boolean, crc: number, compressed: number, size: number): number {
  // The signature is optional, and a CRC can itself equal the signature. A speculative
  // signed layout can decode an enormous uint64 from the unsigned layout's sizes and the
  // following header. Compare as BigInt; a mismatch must not prevent trying the other layout.
  for (const signature of [true, false]) {
    const start = offset + (signature ? 4 : 0)
    const length = 4 + (zip64 ? 16 : 8)
    if (start + length > boundary || (signature && view.getUint32(offset, true) !== 0x08074b50)) continue
    if (view.getUint32(start, true) !== crc) continue
    const compressedSize = zip64 ? view.getBigUint64(start + 4, true) : BigInt(view.getUint32(start + 4, true))
    const originalSize = zip64 ? view.getBigUint64(start + 12, true) : BigInt(view.getUint32(start + 8, true))
    if (compressedSize === BigInt(compressed) && originalSize === BigInt(size)) return start + length
  }
  return corrupt('has an inconsistent data descriptor')
}

class ZipReader {
  private readonly view: DataView

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  private range(offset: number, size: number, end = this.bytes.length): void {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset > end - size) {
      corrupt('has a damaged record')
    }
  }

  private u16(offset: number): number {
    this.range(offset, 2)
    return this.view.getUint16(offset, true)
  }

  private u32(offset: number): number {
    this.range(offset, 4)
    return this.view.getUint32(offset, true)
  }

  private u64(offset: number): number {
    this.range(offset, 8)
    const value = this.view.getBigUint64(offset, true)
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) corrupt('has an out-of-range ZIP64 value')
    return Number(value)
  }

  private directory(): { start: number; end: number; count: number } {
    let end = -1
    for (let offset = this.bytes.length - 22; offset >= Math.max(0, this.bytes.length - 65_557); offset--) {
      // A signature inside a ZIP comment is not another end record.
      if (this.u32(offset) === 0x06054b50 && offset + 22 + this.u16(offset + 20) === this.bytes.length) {
        end = offset
        break
      }
    }
    if (end < 0) corrupt('has no end record')
    const disk = this.u16(end + 4)
    const directoryDisk = this.u16(end + 6)
    const diskCount = this.u16(end + 8)
    let count = this.u16(end + 10)
    let size = this.u32(end + 12)
    let start = this.u32(end + 16)
    let directoryEnd = end
    const locator = end - 20
    if (locator >= 0 && this.u32(locator) === 0x07064b50) {
      if ((disk !== 0 && disk !== 0xffff) || (directoryDisk !== 0 && directoryDisk !== 0xffff)) corrupt('uses multiple disks')
      if (this.u32(locator + 4) !== 0 || this.u32(locator + 16) !== 1) corrupt('uses multiple disks')
      const zip64 = this.u64(locator + 8)
      this.range(zip64, 56, locator)
      if (this.u32(zip64) !== 0x06064b50) corrupt('has no ZIP64 end record')
      const recordSize = this.u64(zip64 + 4)
      if (recordSize < 44 || recordSize !== locator - zip64 - 12) corrupt('has a damaged ZIP64 end record')
      if (this.u32(zip64 + 16) !== 0 || this.u32(zip64 + 20) !== 0) corrupt('uses multiple disks')
      const zipCount = this.u64(zip64 + 32)
      if (this.u64(zip64 + 24) !== zipCount) corrupt('has inconsistent entry counts')
      const zipSize = this.u64(zip64 + 40)
      const zipStart = this.u64(zip64 + 48)
      if ((diskCount !== 0xffff && diskCount !== zipCount) || (count !== 0xffff && count !== zipCount)
        || (size !== 0xffffffff && size !== zipSize) || (start !== 0xffffffff && start !== zipStart)) {
        corrupt('has inconsistent ZIP64 end records')
      }
      count = zipCount
      size = zipSize
      start = zipStart
      directoryEnd = zip64
    } else if (count === 0xffff || diskCount === 0xffff || size === 0xffffffff || start === 0xffffffff || disk === 0xffff || directoryDisk === 0xffff) {
      // Sentinels require a real locator/end record, never a validation bypass.
      corrupt('has no ZIP64 locator')
    } else if (disk !== 0 || directoryDisk !== 0 || diskCount !== count) {
      corrupt('has inconsistent entry counts')
    }
    this.range(start, size, directoryEnd)
    if (size !== directoryEnd - start) corrupt('has a misplaced directory')
    if (count > Math.floor(size / 46)) corrupt('has an inconsistent directory size')
    return { start, end: directoryEnd, count }
  }

  private extra(start: number, length: number, name: string): Map<number, { start: number; size: number }> {
    this.range(start, length)
    const fields = new Map<number, { start: number; size: number }>()
    const end = start + length
    for (let offset = start; offset < end;) {
      this.range(offset, 4, end)
      const id = this.u16(offset)
      const size = this.u16(offset + 2)
      this.range(offset + 4, size, end)
      if ((id === 1 || id === 0x7075) && fields.has(id)) corrupt('has repeated extra fields')
      fields.set(id, { start: offset + 4, size })
      if (id === 0x7075) {
        if (size < 5 || this.bytes[offset + 4] !== 1 || strFromU8(this.bytes.subarray(offset + 9, offset + 4 + size)) !== name) {
          corrupt('names its parts inconsistently')
        }
      }
      if (id === 0x9901) throw new LiveFormatError('encrypted', 'This file is password protected')
      offset += 4 + size
    }
    return fields
  }

  private zip64Values(fields: Map<number, { start: number; size: number }>, values: number[], sentinels: number[]): number[] {
    const field = fields.get(1)
    let offset = field?.start ?? 0
    const resolved = values.map((value, index) => {
      if (value !== sentinels[index]) return value
      const width = sentinels[index] === 0xffff ? 4 : 8
      if (!field || offset + width > field.start + field.size) corrupt('has an incomplete ZIP64 extra field')
      const result = width === 8 ? this.u64(offset) : this.u32(offset)
      offset += width
      return result
    })
    if (field && offset !== field.start + field.size) corrupt('has an inconsistent ZIP64 extra field')
    return resolved
  }

  private flags(flags: number, method: number): void {
    if (flags & (1 | 0x40 | 0x2000)) throw new LiveFormatError('encrypted', 'This file is password protected')
    if ((method !== 0 && method !== 8) || (flags & ~0x080e)) corrupt('uses unsupported ZIP features')
  }

  private localSizes(fields: Map<number, { start: number; size: number }>, size: number, compressed: number, descriptor: boolean): [number, number] {
    const field = fields.get(1)
    if (!field) {
      if (size === 0xffffffff || compressed === 0xffffffff) corrupt('has no local ZIP64 sizes')
      return [size, compressed]
    }
    // Unlike the central extra field's conditional fields, a local ZIP64 field always
    // contains BOTH sizes, including when only one classic field uses a sentinel.
    if (field.size !== 16) corrupt('has incomplete local ZIP64 sizes')
    const original = this.u64(field.start)
    const packed = this.u64(field.start + 8)
    if ((size !== 0xffffffff && size !== original && !(descriptor && size === 0))
      || (compressed !== 0xffffffff && compressed !== packed && !(descriptor && compressed === 0))) {
      corrupt('has inconsistent local ZIP64 sizes')
    }
    return [original, packed]
  }

  entries(limits: ZipLimits): ZipEntry[] {
    const directory = this.directory()
    if (directory.count > limits.maxEntries) throw new LiveFormatError('too_large', 'This file has too many parts')
    const entries: ZipEntry[] = []
    let declared = 0
    let offset = directory.start
    for (let index = 0; index < directory.count; index++) {
      this.range(offset, 46, directory.end)
      if (this.u32(offset) !== 0x02014b50) corrupt('has a damaged directory')
      const flags = this.u16(offset + 8)
      const method = this.u16(offset + 10)
      this.flags(flags, method)
      const crc = this.u32(offset + 16)
      const nameLength = this.u16(offset + 28)
      const extraLength = this.u16(offset + 30)
      const length = 46 + nameLength + extraLength + this.u16(offset + 32)
      this.range(offset, length, directory.end)
      const rawName = this.bytes.subarray(offset + 46, offset + 46 + nameLength)
      const name = strFromU8(rawName, !(flags & 0x800))
      if (!name || name.includes('\0')) corrupt('has an invalid part name')
      const fields = this.extra(offset + 46 + nameLength, extraLength, name)
      const rawCompressed = this.u32(offset + 20)
      const rawSize = this.u32(offset + 24)
      const [size, compressed, local, disk] = this.zip64Values(fields,
        [rawSize, rawCompressed, this.u32(offset + 42), this.u16(offset + 34)],
        [0xffffffff, 0xffffffff, 0xffffffff, 0xffff]) as [number, number, number, number]
      if (disk !== 0) corrupt('uses multiple disks')
      declared += size
      if (declared > limits.maxUncompressedBytes) throw new LiveFormatError('too_large', 'This file expands to too much data')
      this.range(local, 30, directory.start)
      if (this.u32(local) !== 0x04034b50) corrupt('has a damaged local header')
      const localFlags = this.u16(local + 6)
      const localMethod = this.u16(local + 8)
      this.flags(localFlags, localMethod)
      if (localFlags !== flags || localMethod !== method) corrupt('has inconsistent entry headers')
      const localNameLength = this.u16(local + 26)
      const localExtraLength = this.u16(local + 28)
      const start = local + 30 + localNameLength + localExtraLength
      this.range(local, start - local, directory.start)
      if (localNameLength !== nameLength || !rawName.every((byte, at) => byte === this.bytes[local + 30 + at])) {
        corrupt('names its parts inconsistently')
      }
      const localFields = this.extra(local + 30 + localNameLength, localExtraLength, name)
      const descriptor = !!(flags & 8)
      const [localSize, localCompressed] = this.localSizes(localFields, this.u32(local + 22), this.u32(local + 18), descriptor)
      const localCrc = this.u32(local + 14)
      if (descriptor ? ((localSize !== 0 && localSize !== size) || (localCompressed !== 0 && localCompressed !== compressed)
        || (localCrc !== 0 && localCrc !== crc)) : (localSize !== size || localCompressed !== compressed || localCrc !== crc)) {
        corrupt('has inconsistent entry sizes or checksums')
      }
      this.range(start, compressed, directory.start)
      const end = start + compressed
      const recordEnd = descriptor ? zipDescriptorEnd(this.view, end, directory.start,
        rawSize === 0xffffffff || rawCompressed === 0xffffffff || localFields.has(1), crc, compressed, size) : end
      entries.push({ name, local, start, end, recordEnd, size, crc, method })
      offset += length
    }
    if (offset !== directory.end) {
      // ZIP's optional central-directory signature follows the last entry.
      this.range(offset, 6, directory.end)
      if (this.u32(offset) !== 0x05054b50 || offset + 6 + this.u16(offset + 4) !== directory.end) corrupt('has a damaged directory')
    }
    // Central-directory order need not match physical order. Reject entries that share or
    // overlap a local header, payload, or descriptor without changing the exposed part order.
    let previousEnd = 0
    for (const entry of [...entries].sort((a, b) => a.local - b.local)) {
      if (entry.local < previousEnd) corrupt('has overlapping entries')
      previousEnd = entry.recordEnd
    }
    return entries
  }
}

/** Read in directory order; never size an inflater's output buffer from an untrusted header. */
export function* readZip(bytes: Uint8Array, limits: ZipLimits): Generator<[string, Uint8Array]> {
  const entries = new ZipReader(bytes).entries(limits)
  let total = 0
  const names = new Set<string>()
  for (const entry of entries) {
    if (names.has(entry.name)) corrupt('has duplicate part names')
    names.add(entry.name)
    let size = 0
    let crc = -1
    const chunks: Uint8Array[] = []
    const accept = (chunk: Uint8Array): void => {
      size += chunk.length
      if (size > entry.size) corrupt('has an entry larger than its declared size')
      if (size > limits.maxUncompressedBytes || total + size > limits.maxUncompressedBytes) {
        throw new LiveFormatError('too_large', 'This file expands to too much data')
      }
      crc = updateCrc(crc, chunk)
      chunks.push(chunk)
    }
    if (entry.method === 0) {
      if (entry.end - entry.start !== entry.size) corrupt('has inconsistent stored sizes')
      accept(bytes.slice(entry.start, entry.end))
    } else {
      const inflater = new Inflate((chunk) => accept(chunk))
      if (entry.start === entry.end) corrupt('has an empty deflate stream')
      // Even a maximally compressible hostile stream can only expand one small input chunk
      // before our callback checks the actual output and aborts. Never push the whole entry.
      for (let offset = entry.start; offset < entry.end; offset += 1024) {
        const end = Math.min(offset + 1024, entry.end)
        inflater.push(bytes.subarray(offset, end), end === entry.end)
        // fflate's callback's `final` means final INPUT, not a completed deflate block. Its
        // retained state lets us reject missing end markers and unused compressed bytes too.
        // Truncated/trailing-stream regression tests guard this check on fflate upgrades.
        const state = inflater as unknown as { s: { f?: number; l?: unknown; p: number }; p: Uint8Array }
        const finished = state.s.f && !state.s.l
        if ((finished && (end !== entry.end || state.p.length !== Math.ceil(state.s.p / 8))) || (!finished && end === entry.end)) {
          corrupt('has an incomplete or trailing deflate stream')
        }
      }
    }
    if (size !== entry.size || ((crc ^ -1) >>> 0) !== entry.crc) corrupt('has an incorrect entry size or CRC-32')
    total += size
    const data = chunks.length === 1 ? chunks[0]! : new Uint8Array(size)
    if (chunks.length !== 1) {
      let offset = 0
      for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length }
    }
    yield [entry.name, data]
  }
}
