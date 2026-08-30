function normalizeDisplayMath(tex: string): string {
  return tex.trim().replace(/\s*\r?\n\s*/g, ' ')
}

/** Preserve ordinary currency signs while native math parsing is enabled. */
function escapeSingleDollarSigns(content: string): string {
  let result = ''
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]
    if (character !== '$' || content[index - 1] === '$' || content[index + 1] === '$') {
      result += character
      continue
    }

    let precedingBackslashes = 0
    for (let cursor = index - 1; cursor >= 0 && content[cursor] === '\\'; cursor -= 1) precedingBackslashes += 1
    result += precedingBackslashes % 2 === 0 ? '\\$' : '$'
  }
  return result
}

/** Whether the first visible Markdown block is an ATX heading. */
export function beginsWithMarkdownHeading(content: string): boolean {
  return /^(?:[ \t]*\r?\n)*[ \t]{0,3}#{1,6}(?:[ \t]+|$)/.test(content)
}

/** Normalize the LaTeX delimiters most LLMs emit without touching code spans. */
export function normalizeMathDelimiters(content: string): string {
  const parts = content.split(/(```[\s\S]*?```|`[^`\n]+`)/g)
  return parts.map((part, index) => {
    if (index % 2 === 1) return part
    return escapeSingleDollarSigns(part)
      .replace(/(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\]/g, (_match, tex: string) => `\n$$${normalizeDisplayMath(tex)}$$\n`)
      .replace(/^[ \t]*\$\$[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\$\$[ \t]*$/gm, (_match, tex: string) => `$$${normalizeDisplayMath(tex)}$$`)
      .replace(/(?<!\\)\\\(([\s\S]*?)(?<!\\)\\\)/g, (_match, tex: string) => `$${tex}$`)
  }).join('')
}
