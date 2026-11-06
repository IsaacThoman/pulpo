import { decodePartText } from '../ooxml/package.js'

/** A chart part as one line of text (title, series, values), for `cat` and search. */
export function textSummaryOfChart(bytes: Uint8Array): string {
  const xml = decodePartText(bytes)
  const texts = [...xml.matchAll(/<(?:a:t|c:v)>([^<]*)<\/(?:a:t|c:v)>/g)].map((match) => match[1]!).slice(0, 200)
  return texts.length ? `[Chart: ${texts.join(', ')}]` : '[Chart]'
}
