import { liveFormat, liveFormatOfName, LIVE_FORMATS, type LiveFormatInfo } from './formats.js'
import type { LiveFormatCodec, LiveFormatId } from './live-format.js'
import { markdownCodec } from './markdown/index.js'
import { textCodec } from './text/codec.js'

/**
 * The codec of every live format in `LIVE_FORMATS`. This module loads all of them (Markdown pulls
 * in TipTap's schema), so servers import it; clients load only the codec they need.
 */
const CODECS: Partial<Record<LiveFormatId, LiveFormatCodec>> = {
  markdown: markdownCodec,
  text: textCodec,
}

for (const format of LIVE_FORMATS) {
  const codec = CODECS[format.id]
  if (!codec) throw new Error(`The live format ${format.id} has no codec`)
  if (codec.schemaVersion !== format.schemaVersion || codec.extensions.join() !== format.extensions.join()) {
    throw new Error(`The ${format.id} codec disagrees with its catalog entry`)
  }
}

/** The codec of a registered format; throws for formats this build does not know. */
export function liveFormatCodec(format: LiveFormatId | LiveFormatInfo | string): LiveFormatCodec {
  const id = typeof format === 'string' ? format : format.id
  const codec = liveFormat(id) ? CODECS[id as LiveFormatId] : undefined
  if (!codec) throw new Error(`Unknown live format: ${id}`)
  return codec
}

/** The codec for a file name, or null for names that stay ordinary files. */
export function liveFormatCodecOfName(name: string): LiveFormatCodec | null {
  const format = liveFormatOfName(name)
  return format ? liveFormatCodec(format) : null
}
