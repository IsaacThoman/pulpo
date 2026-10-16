export type BannerSegment = { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string }

// `[label](url)` or a bare URL. Bare URLs stop before trailing punctuation so "see https://x.y." links "https://x.y".
const LINK_PATTERN = /\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)|(https?:\/\/[^\s<]*[^\s<.,;:!?)\]'"])/g

/** Splits admin-authored banner copy into text and http(s)/mailto links without pulling in a Markdown renderer. */
export function bannerSegments(content: string): BannerSegment[] {
  const segments: BannerSegment[] = []
  let cursor = 0
  for (const match of content.matchAll(LINK_PATTERN)) {
    if (match.index > cursor) segments.push({ kind: 'text', text: content.slice(cursor, match.index) })
    const [, label, labelledHref, bareHref] = match
    segments.push(label && labelledHref
      ? { kind: 'link', text: label, href: labelledHref }
      : { kind: 'link', text: bareHref!, href: bareHref! })
    cursor = match.index + match[0].length
  }
  if (cursor < content.length) segments.push({ kind: 'text', text: content.slice(cursor) })
  return segments
}
