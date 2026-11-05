import { deflateSync, strToU8 } from 'fflate'
import { LiveFormatError } from '../live-format.js'
import type { PackageLimits } from './package.js'
import { zipCrc32 } from './zip.js'

interface Entry {
  name: Uint8Array
  data: Uint8Array
  size: number
  crc: number
  method: number
  flags: number
  offset: number
}

function tooLarge(): never {
  throw new LiveFormatError('too_large', 'This file is too large to write as an Office zip package')
}

/**
 * Writes entries directly, without object keys or data descriptors. One-shot deflate is
 * essential: fflate's streaming ZipDeflate corrupts some binary printer-settings parts.
 * The default package limits fit classic ZIP, so refuse ZIP64-sized exports rather than
 * truncating counts, sizes, names or offsets into the classic header fields.
 */
export function writeZip(parts: Iterable<[string, Uint8Array]>, limits: PackageLimits): Uint8Array {
  const entries: Entry[] = []
  let expanded = 0
  let localSize = 0
  let directorySize = 0
  for (const [path, bytes] of parts) {
    expanded += bytes.length
    if (entries.length >= limits.maxEntries || entries.length >= 0xfffe || expanded > limits.maxUncompressedBytes) tooLarge()
    const name = strToU8(path)
    if (name.length > 0xffff) tooLarge()
    // Match the original zipSync writer: already-compressed media is stored (method 0),
    // everything else uses raw one-shot deflate at level 6 (method 8).
    const stored = /\.(png|jpe?g|gif|mp4|mp3|m4a|wdp|zip)$/i.test(path)
    const data = stored ? bytes : deflateSync(bytes, { level: 6 })
    if (bytes.length >= 0xffffffff || data.length >= 0xffffffff) tooLarge()
    entries.push({ name, data, size: bytes.length, crc: zipCrc32(bytes), method: stored ? 0 : 8,
      flags: name.some((byte) => byte > 0x7f) ? 0x800 : 0, offset: localSize })
    localSize += 30 + name.length + data.length
    directorySize += 46 + name.length
    if (localSize + directorySize + 22 >= 0xffffffff) tooLarge()
  }
  // Build the civil timestamp per write: caching a Date would let a timezone change move
  // it into 1979. DOS stores these local fields, not an epoch or a timezone offset.
  const mtime = new Date(1980, 0, 1)
  const time = (mtime.getHours() << 11) | (mtime.getMinutes() << 5) | (mtime.getSeconds() >> 1)
  const date = ((mtime.getFullYear() - 1980) << 9) | ((mtime.getMonth() + 1) << 5) | mtime.getDate()
  const output = new Uint8Array(localSize + directorySize + 22)
  const view = new DataView(output.buffer)
  const header = (offset: number, entry: Entry, central: boolean): void => {
    view.setUint32(offset, central ? 0x02014b50 : 0x04034b50, true)
    if (central) view.setUint16(offset + 4, 20, true) // Made by ZIP 2.0, MS-DOS (as zipSync).
    const fields = offset + (central ? 6 : 4)
    view.setUint16(fields, 20, true)
    view.setUint16(fields + 2, entry.flags, true)
    view.setUint16(fields + 4, entry.method, true)
    view.setUint16(fields + 6, time, true)
    view.setUint16(fields + 8, date, true)
    view.setUint32(fields + 10, entry.crc, true)
    view.setUint32(fields + 14, entry.data.length, true)
    view.setUint32(fields + 18, entry.size, true)
    view.setUint16(fields + 22, entry.name.length, true)
    // Extra fields, comments, disk numbers and attributes stay zero in both headers.
    if (central) view.setUint32(offset + 42, entry.offset, true)
    output.set(entry.name, offset + (central ? 46 : 30))
  }
  let directory = localSize
  for (const entry of entries) {
    header(entry.offset, entry, false)
    output.set(entry.data, entry.offset + 30 + entry.name.length)
    header(directory, entry, true)
    directory += 46 + entry.name.length
  }
  view.setUint32(directory, 0x06054b50, true)
  view.setUint16(directory + 8, entries.length, true)
  view.setUint16(directory + 10, entries.length, true)
  view.setUint32(directory + 12, directorySize, true)
  view.setUint32(directory + 16, localSize, true)
  return output
}
