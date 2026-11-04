/**
 * Turns an uploaded file's bytes into text. Most files are UTF-8, but spreadsheets exported on
 * Windows are often Windows-1252 ("ANSI") or UTF-16 with a byte order mark, and reading those as
 * UTF-8 would scatter replacement characters through every accented name.
 *
 * Runs without `TextDecoder` too (Hermes on older React Native), so the fallbacks are hand-written.
 */

export type TextEncodingName = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252'

export interface DecodedText {
  text: string
  encoding: TextEncodingName
  /** Whether a byte order mark was found (and dropped). */
  bom: boolean
}

// Windows-1252 differs from Latin-1 only in 0x80–0x9F; unassigned bytes keep their C1 code point.
const WINDOWS_1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8d, 0x017d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178,
]

const CHUNK = 0x8000

function fromCodeUnits(units: ArrayLike<number>, length: number): string {
  let text = ''
  for (let start = 0; start < length; start += CHUNK) {
    text += String.fromCharCode(...Array.prototype.slice.call(units, start, Math.min(length, start + CHUNK)) as number[])
  }
  return text
}

/**
 * Walks UTF-8, appending code units to `units` (when given) and counting well-formed multibyte
 * sequences and invalid bytes. Invalid bytes become U+FFFD, as browsers decode them.
 */
function scanUtf8(bytes: Uint8Array, units: Uint16Array | null): { length: number; multibyte: number; invalid: number } {
  let length = 0
  let multibyte = 0
  let invalid = 0
  const emit = (unit: number) => {
    if (units) units[length] = unit
    length += 1
  }
  for (let index = 0; index < bytes.length;) {
    const lead = bytes[index]!
    let size = 0
    let codePoint = 0
    if (lead < 0x80) {
      emit(lead)
      index += 1
      continue
    }
    if (lead >= 0xc2 && lead <= 0xdf) [size, codePoint] = [2, lead & 0x1f]
    else if (lead >= 0xe0 && lead <= 0xef) [size, codePoint] = [3, lead & 0x0f]
    else if (lead >= 0xf0 && lead <= 0xf4) [size, codePoint] = [4, lead & 0x07]
    let valid = size > 0 && index + size <= bytes.length
    for (let offset = 1; valid && offset < size; offset += 1) {
      const next = bytes[index + offset]!
      if ((next & 0xc0) !== 0x80) valid = false
      else codePoint = (codePoint << 6) | (next & 0x3f)
    }
    // Overlong forms, surrogates, and code points past U+10FFFF are invalid.
    if (valid && ((size === 3 && codePoint < 0x800) || (size === 4 && (codePoint < 0x10000 || codePoint > 0x10ffff)) || (codePoint >= 0xd800 && codePoint <= 0xdfff))) valid = false
    if (!valid) {
      invalid += 1
      emit(0xfffd)
      index += 1
      continue
    }
    multibyte += 1
    if (codePoint > 0xffff) {
      const offset = codePoint - 0x10000
      emit(0xd800 + (offset >> 10))
      emit(0xdc00 + (offset & 0x3ff))
    } else {
      emit(codePoint)
    }
    index += size
  }
  return { length, multibyte, invalid }
}

/** Strict UTF-8, or null when the bytes are not valid UTF-8. */
export function decodeUtf8Strict(bytes: Uint8Array): string | null {
  if (scanUtf8(bytes, null).invalid > 0) return null
  return decodeUtf8Lossy(bytes)
}

/** UTF-8 with each invalid byte replaced by U+FFFD. */
export function decodeUtf8Lossy(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
  const units = new Uint16Array(bytes.length)
  const { length } = scanUtf8(bytes, units)
  return fromCodeUnits(units, length)
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean, start: number): string {
  const count = Math.floor((bytes.length - start) / 2)
  const units = new Uint16Array(count)
  for (let index = 0; index < count; index += 1) {
    const low = bytes[start + index * 2]!
    const high = bytes[start + index * 2 + 1]!
    units[index] = littleEndian ? low | (high << 8) : (low << 8) | high
  }
  return fromCodeUnits(units, count)
}

export function decodeWindows1252(bytes: Uint8Array): string {
  const units = new Uint16Array(bytes.length)
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index]!
    units[index] = byte >= 0x80 && byte <= 0x9f ? WINDOWS_1252_HIGH[byte - 0x80]! : byte
  }
  return fromCodeUnits(units, bytes.length)
}

/**
 * Decodes a text file: a byte order mark wins, then UTF-8, then Windows-1252, which maps every
 * byte, so decoding never fails.
 */
export function decodeTextBytes(bytes: Uint8Array): DecodedText {
  // A UTF-8 byte order mark is decisive, even if some bytes after it are damaged.
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: decodeUtf8Lossy(bytes.subarray(3)), encoding: 'utf-8', bom: true }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: decodeUtf16(bytes, true, 2), encoding: 'utf-16le', bom: true }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: decodeUtf16(bytes, false, 2), encoding: 'utf-16be', bom: true }
  // One pass decides: text with no invalid sequences, or far more valid multibyte characters than
  // invalid bytes (a UTF-8 file with a stray corrupt byte), is UTF-8. Windows-1252 text has accents
  // as lone high bytes, which are invalid UTF-8 and rarely form valid sequences by chance.
  const { multibyte, invalid } = scanUtf8(bytes, null)
  if (invalid === 0 || multibyte > invalid * 4) return { text: decodeUtf8Lossy(bytes), encoding: 'utf-8', bom: false }
  return { text: decodeWindows1252(bytes), encoding: 'windows-1252', bom: false }
}
