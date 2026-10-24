const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const LOOKUP = new Uint8Array(128)
for (let index = 0; index < ALPHABET.length; index += 1) LOOKUP[ALPHABET.charCodeAt(index)] = index

/**
 * Base64 for Yjs updates crossing the editor bridge. Plain JavaScript, because Hermes has no
 * Buffer and lib0's helpers pick Node's Buffer outside browsers. Chunks keep strings and the
 * temporary arrays small for multi-megabyte documents.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = []
  const CHUNK = 3 * 4_096
  for (let start = 0; start < bytes.length; start += CHUNK) {
    const end = Math.min(start + CHUNK, bytes.length)
    let out = ''
    let index = start
    for (; index + 2 < end; index += 3) {
      const value = (bytes[index]! << 16) | (bytes[index + 1]! << 8) | bytes[index + 2]!
      out += ALPHABET[value >> 18]! + ALPHABET[(value >> 12) & 63]! + ALPHABET[(value >> 6) & 63]! + ALPHABET[value & 63]!
    }
    const rest = end - index
    if (rest === 1) {
      const value = bytes[index]! << 16
      out += `${ALPHABET[value >> 18]!}${ALPHABET[(value >> 12) & 63]!}==`
    } else if (rest === 2) {
      const value = (bytes[index]! << 16) | (bytes[index + 1]! << 8)
      out += `${ALPHABET[value >> 18]!}${ALPHABET[(value >> 12) & 63]!}${ALPHABET[(value >> 6) & 63]!}=`
    }
    parts.push(out)
  }
  return parts.join('')
}

export function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '')
  const length = Math.floor((clean.length * 3) / 4)
  const bytes = new Uint8Array(length)
  let byte = 0
  for (let index = 0; index < clean.length; index += 4) {
    const a = LOOKUP[clean.charCodeAt(index)]!
    const b = LOOKUP[clean.charCodeAt(index + 1)]!
    const c = LOOKUP[clean.charCodeAt(index + 2)] ?? 0
    const d = LOOKUP[clean.charCodeAt(index + 3)] ?? 0
    const value = (a << 18) | (b << 12) | (c << 6) | d
    if (byte < length) bytes[byte++] = value >> 16
    if (byte < length) bytes[byte++] = (value >> 8) & 255
    if (byte < length) bytes[byte++] = value & 255
  }
  return bytes
}
