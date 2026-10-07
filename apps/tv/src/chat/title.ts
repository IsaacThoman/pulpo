let leadingEmoji: RegExp | null = null
try {
  leadingEmoji = new RegExp('^((?:\\p{Extended_Pictographic}|\\p{Regional_Indicator})(?:\\uFE0F|\\u200D|\\p{Extended_Pictographic}|\\p{Emoji_Modifier}|\\p{Regional_Indicator})*)\\s*', 'u')
} catch {
  // Engines without Unicode property escapes show the title unchanged.
}

/** Generated titles lead with an emoji; cards show it large, apart from the words. */
export function splitTitle(title: string): { emoji: string | null; text: string } {
  const trimmed = title.trim()
  const match = leadingEmoji?.exec(trimmed)
  if (!match || match[0].length === trimmed.length) return { emoji: null, text: trimmed || 'New chat' }
  return { emoji: match[1]!, text: trimmed.slice(match[0].length) }
}
