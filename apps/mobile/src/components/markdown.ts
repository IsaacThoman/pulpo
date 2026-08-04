/** Normalize the LaTeX delimiters most LLMs emit without touching code spans. */
export function normalizeMathDelimiters(content: string): string {
  const parts = content.split(/(```[\s\S]*?```|`[^`\n]+`)/g)
  return parts.map((part, index) => {
    if (index % 2 === 1) return part
    return part
      .replace(/(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\]/g, (_match, tex: string) => `\n$$\n${tex.trim()}\n$$\n`)
      .replace(/(?<!\\)\\\(([\s\S]*?)(?<!\\)\\\)/g, (_match, tex: string) => `$${tex}$`)
  }).join('')
}
