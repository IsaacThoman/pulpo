/** Codex's coarse estimate: about four UTF-8 bytes per token. */
export const APPROX_BYTES_PER_TOKEN = 4

export function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

export function approxTokensFromBytes(bytes: number): number {
  return bytes > 0 ? Math.ceil(bytes / APPROX_BYTES_PER_TOKEN) : 0
}

export function approxTokenCount(text: string): number {
  return approxTokensFromBytes(utf8ByteLength(text))
}

const truncationMarker = (tokens: number) => `…${tokens} tokens truncated…`

// UTF-8 continuation bytes look like 0b10xxxxxx.
const isContinuationByte = (byte: number | undefined) => byte !== undefined && (byte & 0xc0) === 0x80

function floorCharBoundary(bytes: Buffer, index: number): number {
  let boundary = Math.min(index, bytes.length)
  while (boundary > 0 && isContinuationByte(bytes[boundary])) boundary -= 1
  return boundary
}

function ceilCharBoundary(bytes: Buffer, index: number): number {
  let boundary = Math.max(0, index)
  while (boundary < bytes.length && isContinuationByte(bytes[boundary])) boundary += 1
  return boundary
}

/** Codex truncate_middle_with_token_budget: keep both ends, mark the removed middle. */
export function truncateMiddleToTokens(text: string, maxTokens: number): string {
  if (!text) return text
  const bytes = Buffer.from(text, 'utf8')
  const budget = Math.max(0, Math.floor(maxTokens)) * APPROX_BYTES_PER_TOKEN
  if (budget === 0) return truncationMarker(approxTokensFromBytes(bytes.length))
  if (bytes.length <= budget) return text
  const left = Math.floor(budget / 2)
  const prefixEnd = floorCharBoundary(bytes, left)
  const suffixStart = ceilCharBoundary(bytes, bytes.length - (budget - left))
  return bytes.subarray(0, prefixEnd).toString('utf8')
    + truncationMarker(approxTokensFromBytes(bytes.length - budget))
    + bytes.subarray(suffixStart).toString('utf8')
}
