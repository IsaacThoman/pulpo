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

/** Strict UTF-8, or null when the bytes are not valid UTF-8. */
export function decodeUtf8Strict(bytes: Uint8Array): string | null {
  if (typeof TextDecoder !== 'undefined') {
    try {
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    } catch (error) {
      if (error instanceof TypeError) return null
      // A runtime whose TextDecoder lacks `fatal` falls through to the manual decoder.
    }
  }
  const units = new Uint16Array(bytes.length)
  let length = 0
  for (let index = 0; index < bytes.length;) {
    const lead = bytes[index]!
    let codePoint: number
    let size: number
    if (lead < 0x80) {
      codePoint = lead
      size = 1
    } else if (lead >= 0xc2 && lead <= 0xdf) {
      codePoint = lead & 0x1f
      size = 2
    } else if (lead >= 0xe0 && lead <= 0xef) {
      codePoint = lead & 0x0f
      size = 3
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      codePoint = lead & 0x07
      size = 4
    } else {
      return null
    }
    if (index + size > bytes.length) return null
    for (let offset = 1; offset < size; offset += 1) {
      const next = bytes[index + offset]!
      if ((next & 0xc0) !== 0x80) return null
      codePoint = (codePoint << 6) | (next & 0x3f)
    }
    // Overlong forms, surrogates, and code points past U+10FFFF are invalid.
    if ((size === 3 && codePoint < 0x800) || (size === 4 && (codePoint < 0x10000 || codePoint > 0x10ffff)) || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return null
    if (codePoint > 0xffff) {
      const offset = codePoint - 0x10000
      units[length++] = 0xd800 + (offset >> 10)
      units[length++] = 0xdc00 + (offset & 0x3ff)
    } else {
      units[length++] = codePoint
    }
    index += size
  }
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
 * Decodes a text file: a byte order mark wins, then strict UTF-8, then Windows-1252, which maps
 * every byte, so decoding never fails.
 */
export function decodeTextBytes(bytes: Uint8Array): DecodedText {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    const text = decodeUtf8Strict(bytes.subarray(3))
    return text === null
      ? { text: decodeWindows1252(bytes.subarray(3)), encoding: 'windows-1252', bom: true }
      : { text, encoding: 'utf-8', bom: true }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: decodeUtf16(bytes, true, 2), encoding: 'utf-16le', bom: true }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: decodeUtf16(bytes, false, 2), encoding: 'utf-16be', bom: true }
  const utf8 = decodeUtf8Strict(bytes)
  if (utf8 !== null) return { text: utf8, encoding: 'utf-8', bom: false }
  return { text: decodeWindows1252(bytes), encoding: 'windows-1252', bom: false }
}
