/**
 * Maps increasing offsets in lower-cased text back to the original, rounding a match's boundaries
 * outward when they fall inside an expanded character. ASCII runs need no mapping and are skipped
 * by the regex. Only the current non-ASCII character and accumulated length change are retained,
 * even if every character expands. No matches means no scan; a capped search stops scanning early.
 */
export function originalCaseOffsets(text: string): (offset: number, end: boolean) => number {
  // Iterate by code point so surrogate pairs keep their original width.
  // eslint-disable-next-line no-control-regex
  const characters = text.matchAll(/[^\x00-\x7f]/gu)
  let current: ReturnType<typeof characters.next> | undefined
  let shift = 0
  return (offset, end) => {
    current ??= characters.next()
    while (!current.done) {
      const character = current.value[0]
      const index = current.value.index
      const foldedStart = index + shift
      if (foldedStart > offset) break
      const foldedLength = character.toLowerCase().length
      if (offset < foldedStart + foldedLength) return index + (end ? character.length : 0)
      shift += foldedLength - character.length
      current = characters.next()
    }
    return offset - shift + (end ? 1 : 0)
  }
}
