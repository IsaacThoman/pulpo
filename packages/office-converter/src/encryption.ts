import { inflateRawSync } from 'node:zlib'

/**
 * Recognizes password-protected documents, so a failed conversion can say why instead of
 * "could not be converted". Headless LibreOffice has nobody to ask for the password, so these
 * fail unless they use a format's default password. Everything here reads untrusted bytes:
 * every offset is bounds-checked, loops are capped, and any surprise means "not recognized".
 */

const DIRECTORY_ENTRY_BYTES = 128
const END_OF_CHAIN = 0xfffffffe
/** Enough for any real directory, small enough that a looping chain ends quickly. */
const MAX_CHAIN_SECTORS = 4_096
const MAX_MANIFEST_BYTES = 1024 * 1024

interface CompoundFile {
  bytes: Uint8Array
  view: DataView
  sectorSize: number
  miniStreamCutoff: number
  fat: number[]
}

interface DirectoryEntry {
  name: string
  startSector: number
  size: number
}

function sectorOffset(file: CompoundFile, sector: number): number {
  return (sector + 1) * file.sectorSize
}

/** Parses the header and the FAT sectors the header lists (enough for files up to ~7 MB at 512-byte sectors). */
function openCompoundFile(bytes: Uint8Array): CompoundFile | null {
  if (bytes.length < 512) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const sectorShift = view.getUint16(0x1e, true)
  if (sectorShift !== 9 && sectorShift !== 12) return null
  const sectorSize = 1 << sectorShift
  const fatSectorCount = view.getUint32(0x2c, true)
  const file: CompoundFile = { bytes, view, sectorSize, miniStreamCutoff: view.getUint32(0x38, true), fat: [] }
  for (let index = 0; index < Math.min(fatSectorCount, 109); index += 1) {
    const sector = view.getUint32(0x4c + index * 4, true)
    const offset = sectorOffset(file, sector)
    if (offset + sectorSize > bytes.length) break
    for (let entry = 0; entry < sectorSize / 4; entry += 1) file.fat.push(view.getUint32(offset + entry * 4, true))
  }
  return file
}

function readDirectory(file: CompoundFile): DirectoryEntry[] {
  const entries: DirectoryEntry[] = []
  let sector = file.view.getUint32(0x30, true)
  for (let visited = 0; sector !== END_OF_CHAIN && visited < MAX_CHAIN_SECTORS; visited += 1) {
    const offset = sectorOffset(file, sector)
    if (offset + file.sectorSize > file.bytes.length) break
    for (let start = offset; start < offset + file.sectorSize; start += DIRECTORY_ENTRY_BYTES) {
      const nameBytes = Math.min(file.view.getUint16(start + 0x40, true), 64)
      if (nameBytes < 2) continue
      const name = Buffer.from(file.bytes.subarray(start, start + nameBytes - 2)).toString('utf16le')
      entries.push({ name, startSector: file.view.getUint32(start + 0x74, true), size: file.view.getUint32(start + 0x78, true) })
    }
    sector = file.fat[sector] ?? END_OF_CHAIN
  }
  return entries
}

/** The first bytes of a stream stored in regular sectors; small streams live in the mini stream and are skipped. */
function streamStart(file: CompoundFile, entry: DirectoryEntry | undefined, length: number): DataView | null {
  if (!entry || entry.size < file.miniStreamCutoff || entry.size < length) return null
  const offset = sectorOffset(file, entry.startSector)
  if (offset + length > file.bytes.length || length > file.sectorSize) return null
  return new DataView(file.bytes.buffer, file.bytes.byteOffset + offset, length)
}

function compoundFileEncrypted(bytes: Uint8Array): boolean {
  const file = openCompoundFile(bytes)
  if (!file) return false
  const entries = readDirectory(file)
  const named = (name: string) => entries.find((entry) => entry.name === name)
  // Office Open XML packages are wrapped in a compound file only when encrypted; PowerPoint 97
  // keeps an encrypted summary stream.
  if (named('EncryptionInfo') || named('EncryptedPackage') || named('EncryptedSummary')) return true
  // Word 97: the FIB's fEncrypted flag (bit 8 of the flags at 0x0A).
  const fib = streamStart(file, named('WordDocument'), 0x0c)
  if (fib && (fib.getUint16(0x0a, true) & 0x0100) !== 0) return true
  // Excel 97: a FILEPASS record (0x002F) right after the workbook's BOF record.
  const book = streamStart(file, named('Workbook') ?? named('Book'), 256)
  if (book && book.getUint16(0, true) === 0x0809) {
    const next = 4 + book.getUint16(2, true)
    if (next + 2 <= book.byteLength && book.getUint16(next, true) === 0x002f) return true
  }
  return false
}

/** One member of a zip archive, found through the central directory and inflated with a size cap. */
export function readZipEntry(bytes: Uint8Array, name: string, maxBytes = MAX_MANIFEST_BYTES): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // The end-of-central-directory record sits in the last 64 KiB + 22 bytes.
  let end = -1
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { end = offset; break }
  }
  if (end < 0) return null
  const count = view.getUint16(end + 10, true)
  let offset = view.getUint32(end + 16, true)
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) return null
    const method = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localOffset = view.getUint32(offset + 42, true)
    const entryName = Buffer.from(bytes.subarray(offset + 46, offset + 46 + nameLength)).toString('utf8')
    if (entryName === name) {
      if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) return null
      const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true)
      const data = bytes.subarray(dataStart, Math.min(bytes.length, dataStart + compressedSize))
      if (method === 0) return data.length <= maxBytes ? data : null
      if (method !== 8) return null
      try {
        return inflateRawSync(data, { maxOutputLength: maxBytes })
      } catch {
        return null
      }
    }
    offset += 46 + nameLength + extraLength + commentLength
  }
  return null
}

/** OpenDocument packages list how each encrypted member was encrypted in their manifest. */
function openDocumentEncrypted(bytes: Uint8Array): boolean {
  const manifest = readZipEntry(bytes, 'META-INF/manifest.xml')
  return manifest !== null && Buffer.from(manifest).toString('utf8').includes('encryption-data')
}

/** Whether the document is recognizably password-protected. Never throws. */
export function looksEncrypted(bytes: Uint8Array): boolean {
  try {
    if (bytes[0] === 0xd0 && bytes[1] === 0xcf) return compoundFileEncrypted(bytes)
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) return openDocumentEncrypted(bytes)
  } catch {
    // Malformed structures are reported as not encrypted; the conversion itself fails on them.
  }
  return false
}
