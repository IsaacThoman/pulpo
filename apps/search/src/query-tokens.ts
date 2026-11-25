/** Keep quoted phrases, including unfinished ones, as single query tokens. */
export function queryTokens(query: string) {
  return [...query.matchAll(/(?:[^\s"]+|"(?:\\(?:[\s\S]|$)|[^"\\])*(?:"|$))+/gu)]
    .map(match => ({ text: match[0], start: match.index, end: match.index + match[0].length }))
}
