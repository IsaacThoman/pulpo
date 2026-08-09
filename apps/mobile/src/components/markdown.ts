function normalizeDisplayMath(tex: string): string {
  return tex.trim().replace(/\s*\r?\n\s*/g, ' ')
}

/** Normalize the LaTeX delimiters most LLMs emit without touching code spans. */
export function normalizeMathDelimiters(content: string): string {
  const parts = content.split(/(```[\s\S]*?```|`[^`\n]+`)/g)
  return parts.map((part, index) => {
    if (index % 2 === 1) return part
    return part
      .replace(/(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\]/g, (_match, tex: string) => `\n$$${normalizeDisplayMath(tex)}$$\n`)
      .replace(/^[ \t]*\$\$[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\$\$[ \t]*$/gm, (_match, tex: string) => `$$${normalizeDisplayMath(tex)}$$`)
      .replace(/(?<!\\)\\\(([\s\S]*?)(?<!\\)\\\)/g, (_match, tex: string) => `$${tex}$`)
  }).join('')
}
