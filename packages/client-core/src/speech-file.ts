export type SpeechAudioFormat = 'mp3' | 'wav'
/** Generated speech joined into one file, ready to download, share, or save to Files. */
export type SpeechAudioFile = { bytes: Uint8Array<ArrayBuffer>; format: SpeechAudioFormat; mimeType: string; name: string }

export const SPEECH_MIME_TYPES: Record<SpeechAudioFormat, string> = { mp3: 'audio/mpeg', wav: 'audio/wav' }
const NAME_MAX_CHARACTERS = 60

/** A file name from the start of the spoken text, without characters file systems reject. */
export function speechFileName(text: string, format: SpeechAudioFormat): string {
  const words = text.replace(/[\\/:*?"<>|\p{Cc}\p{Cf}]+/gu, ' ').split(/\s+/u).filter(Boolean)
  let title = ''
  for (const word of words) {
    const next = title ? `${title} ${word}` : word
    if (Array.from(next).length > NAME_MAX_CHARACTERS) { if (!title) title = Array.from(word).slice(0, NAME_MAX_CHARACTERS).join(''); break }
    title = next
  }
  // Trailing dots and spaces are dropped by Windows and read as an extension by others.
  title = title.replace(/[\s.]+$/u, '').replace(/^\.+/u, '')
  return `${title || 'Speech'}.${format}`
}

/** Joins the audio of consecutive speech chunks, all generated in the same format, into one file. */
export function joinSpeechAudio(parts: Uint8Array[], format: SpeechAudioFormat): Uint8Array<ArrayBuffer> {
  if (!parts.length) throw new Error('There is no audio to save')
  return format === 'wav' ? joinWav(parts) : concat(parts.map(mp3Frames))
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) { result.set(part, offset); offset += part.length }
  return result
}
const ascii = (bytes: Uint8Array, offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length))

/**
 * MPEG audio frames without ID3 tags or the leading Xing/Info/VBRI frame. That frame describes
 * only its own chunk, so keeping it would make players report the first chunk's duration for the
 * whole file; without it, players measure the joined frames.
 */
function mp3Frames(bytes: Uint8Array): Uint8Array {
  let start = 0, end = bytes.length
  while (end - start >= 10 && ascii(bytes, start, 3) === 'ID3') {
    const size = (bytes[start + 6]! & 0x7f) << 21 | (bytes[start + 7]! & 0x7f) << 14 | (bytes[start + 8]! & 0x7f) << 7 | (bytes[start + 9]! & 0x7f)
    start += 10 + size + (bytes[start + 5]! & 0x10 ? 10 : 0)
  }
  if (end - start >= 128 && ascii(bytes, end - 128, 3) === 'TAG') end -= 128
  start = Math.min(start, end)
  const frame = mp3FrameLength(bytes, start)
  if (frame && start + frame <= end) {
    const header = bytes[start + 1]!, mpeg1 = (header >> 3 & 3) === 3, mono = (bytes[start + 3]! >> 6) === 3
    const xing = start + 4 + (mpeg1 ? mono ? 17 : 32 : mono ? 9 : 17)
    if (['Xing', 'Info'].includes(ascii(bytes, xing, 4)) || ascii(bytes, start + 36, 4) === 'VBRI') start += frame
  }
  return bytes.subarray(start, end)
}
const BITRATES = { 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] }
const SAMPLE_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] } as Record<number, number[]>
/** The length of the MPEG-1/2/2.5 Layer III frame at `offset`, or 0 when there is none. */
function mp3FrameLength(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length || bytes[offset] !== 0xff || (bytes[offset + 1]! & 0xe0) !== 0xe0) return 0
  const version = bytes[offset + 1]! >> 3 & 3, layer = bytes[offset + 1]! >> 1 & 3
  const bitrate = (version === 3 ? BITRATES[1] : BITRATES[2])[bytes[offset + 2]! >> 4]
  const sampleRate = SAMPLE_RATES[version]?.[bytes[offset + 2]! >> 2 & 3]
  if (layer !== 1 || !bitrate || !sampleRate) return 0
  return Math.floor((version === 3 ? 144_000 : 72_000) * bitrate / sampleRate) + (bytes[offset + 2]! >> 1 & 1)
}

/** One RIFF/WAVE file holding every part's samples. Every part must share the same sample format. */
function joinWav(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  let format: Uint8Array | undefined
  const samples = parts.map(part => {
    const chunks = wavChunks(part)
    if (!chunks.fmt || !chunks.data) throw new Error('Speech audio is not valid WAV')
    if (!format) format = chunks.fmt
    else if (format.length !== chunks.fmt.length || format.some((byte, index) => byte !== chunks.fmt![index])) throw new Error('Speech audio chunks have different formats')
    // Keep whole sample frames, so a truncated part cannot shift every later sample.
    const blockAlign = chunks.fmt.length >= 14 ? new DataView(chunks.fmt.buffer, chunks.fmt.byteOffset).getUint16(12, true) : 0
    return blockAlign ? chunks.data.subarray(0, chunks.data.length - chunks.data.length % blockAlign) : chunks.data
  })
  const fmt = format!, dataSize = samples.reduce((total, part) => total + part.length, 0)
  const fmtPadded = fmt.length + (fmt.length & 1)
  const header = new Uint8Array(12 + 8 + fmtPadded + 8)
  const view = new DataView(header.buffer)
  const write = (offset: number, text: string) => { for (let index = 0; index < text.length; index++) header[offset + index] = text.charCodeAt(index) }
  write(0, 'RIFF'); view.setUint32(4, header.length - 8 + dataSize + (dataSize & 1), true); write(8, 'WAVE')
  write(12, 'fmt '); view.setUint32(16, fmt.length, true); header.set(fmt, 20)
  write(20 + fmtPadded, 'data'); view.setUint32(24 + fmtPadded, dataSize, true)
  return concat([header, ...samples, ...(dataSize & 1 ? [new Uint8Array(1)] : [])])
}
function wavChunks(bytes: Uint8Array): { fmt?: Uint8Array; data?: Uint8Array } {
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') return {}
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const result: { fmt?: Uint8Array; data?: Uint8Array } = {}
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset, 4), declared = view.getUint32(offset + 4, true), body = offset + 8
    // Streamed WAV leaves the data size unknown (0 or 0xFFFFFFFF); its samples run to the end.
    const size = id === 'data' && (declared === 0 || declared === 0xffffffff || body + declared > bytes.length) ? bytes.length - body : declared
    if (id === 'fmt ') result.fmt = bytes.subarray(body, Math.min(bytes.length, body + size))
    if (id === 'data') { result.data = bytes.subarray(body, body + size); break }
    offset = body + size + (size & 1)
  }
  return result
}
