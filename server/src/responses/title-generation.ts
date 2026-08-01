export function selectTitleHistory(history: string, firstCharacters: number, lastCharacters: number): string {
  const firstEnd = Math.min(history.length, Math.max(0, firstCharacters))
  const lastStart = Math.max(0, history.length - Math.max(0, lastCharacters))

  if (firstEnd === 0) return history.slice(lastStart)
  if (lastStart === history.length) return history.slice(0, firstEnd)
  if (lastStart <= firstEnd) return history
  return `${history.slice(0, firstEnd)}\n…\n${history.slice(lastStart)}`
}

export function parseGeneratedTitle(value: string): string | null {
  const json = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    const parsed = JSON.parse(json) as unknown
    if (typeof parsed !== 'object' || parsed === null || !("title" in parsed)) return null
    const title = (parsed as { title?: unknown }).title
    if (typeof title !== 'string' || !title.trim()) return null
    return title.trim().slice(0, 200)
  } catch {
    return null
  }
}
