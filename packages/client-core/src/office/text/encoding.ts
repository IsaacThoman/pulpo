import { LiveFormatError } from '../live-format.js'

/**
 * How a text file is stored on disk. Everything else is decoded into a JavaScript string with
 * `\n` line breaks, and written back the same way it came, so an unchanged file keeps its bytes.
 */
export type TextEncodingName = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be' | 'windows-1252'
export type LineEnding = 'lf' | 'crlf' | 'cr'

export interface DecodedText {
  /** The content with every line break as `\n`. */
  text: string
  encoding: TextEncodingName
  /** The most common line break (LF for files without one). */
  lineEnding: LineEnding
  /** More than one kind of line break: normalizing to `lineEnding` would change other lines. */
  mixed: boolean
}

const BREAKS: Record<LineEnding, string> = { lf: '\n', crlf: '\r\n', cr: '\r' }

/** Windows-1252's characters for bytes 0x80–0x9F; the rest of the upper half is Latin-1. */
const CP1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
]
const CP1252_ENCODE = new Map(CP1252_HIGH.map((code, index) => [code, 0x80 + index]))

/** Control characters text files do not contain; many of them mean binary data. */
function isBinaryControl(code: number): boolean {
  return (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0c && code !== 0x0d && code !== 0x1b) || code === 0x7f
}

const notText = () => new LiveFormatError('unsupported', 'This file is not text, so it cannot be edited as text')

function decodeUtf16(bytes: Uint8Array, start: number, littleEndian: boolean): string {
  if ((bytes.length - start) % 2) throw new LiveFormatError('corrupt', 'This UTF-16 file ends in the middle of a character')
  const units = new Uint16Array((bytes.length - start) / 2)
  for (let index = 0; index < units.length; index += 1) {
    const low = bytes[start + index * 2]!
    const high = bytes[start + index * 2 + 1]!
    units[index] = littleEndian ? low | (high << 8) : (low << 8) | high
  }
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index]!
    // Documents store text as UTF-8, which cannot hold half a surrogate pair: refuse rather than
    // write back a replacement character.
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = units[index + 1]
      if (next === undefined || next < 0xdc00 || next > 0xdfff) throw unpairedSurrogate()
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw unpairedSurrogate()
    }
  }
  let text = ''
  // Chunked: spreading a few million arguments overflows the call stack.
  for (let index = 0; index < units.length; index += 8_192) text += String.fromCharCode(...units.subarray(index, index + 8_192))
  return text
}

const unpairedSurrogate = () => new LiveFormatError('unsupported', 'This UTF-16 file holds a broken character, so it cannot be edited without changing it')

function encodeUtf16(text: string, littleEndian: boolean): Uint8Array {
  const bytes = new Uint8Array(2 + text.length * 2)
  bytes[0] = littleEndian ? 0xff : 0xfe
  bytes[1] = littleEndian ? 0xfe : 0xff
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    bytes[2 + index * 2] = littleEndian ? code & 0xff : code >> 8
    bytes[3 + index * 2] = littleEndian ? code >> 8 : code & 0xff
  }
  return bytes
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return null
  }
}

function decodeWindows1252(bytes: Uint8Array): string {
  let text = ''
  for (let index = 0; index < bytes.length; index += 8_192) {
    const chunk = bytes.subarray(index, index + 8_192)
    text += String.fromCharCode(...Array.from(chunk, (byte) => byte >= 0x80 && byte < 0xa0 ? CP1252_HIGH[byte - 0x80]! : byte))
  }
  return text
}

/** Null when a character has no Windows-1252 byte (say, an emoji typed into a legacy file). */
function encodeWindows1252(text: string): Uint8Array | null {
  const bytes = new Uint8Array(text.length)
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    const byte = code < 0x80 || (code >= 0xa0 && code <= 0xff) ? code : CP1252_ENCODE.get(code)
    if (byte === undefined) return null
    bytes[index] = byte
  }
  return bytes
}

function lineBreaks(raw: string): { lineEnding: LineEnding; mixed: boolean } {
  let crlf = 0
  let lf = 0
  let cr = 0
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index)
    if (code === 0x0d) {
      if (raw.charCodeAt(index + 1) === 0x0a) {
        crlf += 1
        index += 1
      } else {
        cr += 1
      }
    } else if (code === 0x0a) {
      lf += 1
    }
  }
  const kinds = (crlf ? 1 : 0) + (lf ? 1 : 0) + (cr ? 1 : 0)
  const lineEnding: LineEnding = crlf > lf && crlf >= cr ? 'crlf' : cr > lf && cr > crlf ? 'cr' : 'lf'
  return { lineEnding, mixed: kinds > 1 }
}

/**
 * Decodes a text file: UTF-8 (with or without a byte order mark), UTF-16 with a byte order mark,
 * or, for bytes that are not UTF-8 but read as text, Windows-1252. Anything with NUL bytes or many
 * control characters is binary and refused.
 */
export function decodeTextFile(bytes: Uint8Array): DecodedText {
  let raw: string
  let encoding: TextEncodingName
  if (bytes[0] === 0xff && bytes[1] === 0xfe && !(bytes[2] === 0 && bytes[3] === 0)) {
    raw = decodeUtf16(bytes, 2, true)
    encoding = 'utf-16le'
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    raw = decodeUtf16(bytes, 2, false)
    encoding = 'utf-16be'
  } else {
    if (bytes.includes(0)) throw notText()
    const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
    const utf8 = decodeUtf8(bom ? bytes.subarray(3) : bytes)
    if (utf8 !== null) {
      raw = utf8
      encoding = bom ? 'utf-8-bom' : 'utf-8'
    } else {
      // Western text in a legacy encoding has a few accented letters and smart quotes. A steady
      // share of high bytes means another encoding (Shift-JIS, GBK, …) that Windows-1252 would
      // turn into gibberish, so it is refused rather than guessed.
      let high = 0
      for (const byte of bytes) if (byte >= 0x80) high += 1
      if (bom || high > Math.max(4, bytes.length / 10)) throw notText()
      raw = decodeWindows1252(bytes)
      encoding = 'windows-1252'
    }
  }
  let controls = 0
  for (let index = 0; index < raw.length; index += 1) if (isBinaryControl(raw.charCodeAt(index))) controls += 1
  // A stray form feed or bell happens in real text; a steady share of them is binary data.
  if (raw.includes('\0') || controls > Math.max(8, raw.length / 200)) throw notText()
  return { text: raw.replace(/\r\n?/g, '\n'), encoding, ...lineBreaks(raw) }
}

/**
 * Writes text back in a file's encoding and line breaks. A Windows-1252 file that now holds a
 * character that encoding lacks is written as UTF-8, rather than losing the character.
 */
export function encodeTextFile(text: string, encoding: TextEncodingName, lineEnding: LineEnding): Uint8Array {
  const raw = lineEnding === 'lf' ? text : text.replace(/\n/g, BREAKS[lineEnding])
  switch (encoding) {
    case 'utf-16le': return encodeUtf16(raw, true)
    case 'utf-16be': return encodeUtf16(raw, false)
    case 'windows-1252': return encodeWindows1252(raw) ?? new TextEncoder().encode(raw)
    case 'utf-8-bom': {
      const body = new TextEncoder().encode(raw)
      const bytes = new Uint8Array(body.length + 3)
      bytes.set([0xef, 0xbb, 0xbf])
      bytes.set(body, 3)
      return bytes
    }
    case 'utf-8': return new TextEncoder().encode(raw)
  }
}
