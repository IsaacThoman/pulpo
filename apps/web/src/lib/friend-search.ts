export function normalizedFriendSearchQuery(value: string): string {
  return value.trim().replace(/^@/, '').trim().toLowerCase()
}

export function shouldSearchFriends(value: string): boolean {
  return normalizedFriendSearchQuery(value).length >= 3
}

export interface HighlightPart {
  text: string
  match: boolean
}

export function friendSearchHighlight(value: string, query: string): HighlightPart[] {
  const needle = normalizedFriendSearchQuery(query)
  if (!needle) return [{ text: value, match: false }]
  const index = value.toLowerCase().indexOf(needle)
  if (index < 0) return [{ text: value, match: false }]
  return [
    { text: value.slice(0, index), match: false },
    { text: value.slice(index, index + needle.length), match: true },
    { text: value.slice(index + needle.length), match: false },
  ].filter((part) => part.text.length > 0)
}

export function nextFriendSearchIndex(current: number, direction: 1 | -1, count: number): number {
  if (count <= 0) return -1
  if (current < 0) return direction === 1 ? 0 : count - 1
  return (current + direction + count) % count
}
