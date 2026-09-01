function normalizeDisplayMath(tex: string): string {
  return tex.trim().replace(/\s*\r?\n\s*/g, ' ')
}

function isEscaped(content: string, index: number): boolean {
  let backslashes = 0
  for (let cursor = index - 1; cursor >= 0 && content[cursor] === '\\'; cursor -= 1) backslashes += 1
  return backslashes % 2 === 1
}

function isCurrencyDollar(content: string, index: number): boolean {
  const amount = /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[kKmMbB])?/.exec(content.slice(index + 1))
  if (!amount) return false

  const remainder = content.slice(index + 1 + amount[0].length)
  const next = remainder[0]
  if (next === '$') return false
  if (next === undefined || /[\s.,;:!?)}\]/“”‘’'"–—-]/.test(next)) return true
  return /^[*_~]{1,3}(?=$|[\s.,;:!?)}\]/“”‘’'"–—-])/.test(remainder)
}

function closingInlineDollar(content: string, opening: number): number {
  for (let cursor = opening + 1; cursor < content.length; cursor += 1) {
    const character = content[cursor]
    if (character === '\n' || character === '\r') return -1
    if (character !== '$' || isEscaped(content, cursor)) continue
    if (content[cursor - 1] === '$' || content[cursor + 1] === '$') continue
    return cursor
  }
  return -1
}

function protectLiteralDollars(content: string): string {
  let result = ''
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]
    if (character !== '$' || isEscaped(content, index)) {
      result += character
      continue
    }

    if (content[index + 1] === '$') {
      result += '$$'
      index += 1
      continue
    }

    if (!isCurrencyDollar(content, index)) {
      const closing = closingInlineDollar(content, index)
      if (closing !== -1) {
        const tex = content.slice(index + 1, closing)
        if (tex.length > 0 && tex.trim() === tex) {
          result += content.slice(index, closing + 1)
          index = closing
          continue
        }
      }
    }

    result += '\\$'
  }
  return result
}

export interface MathDelimiterOptions {
  displayMathStyle?: 'single-line' | 'multiline'
}

/** Normalize common LLM math delimiters while preserving ordinary currency and literal dollar signs. */
export function normalizeMathDelimiters(content: string, options: MathDelimiterOptions = {}): string {
  const parts = content.split(/(```[\s\S]*?```|`[^`\n]+`)/g)
  return parts.map((part, index) => {
    if (index % 2 === 1) return part
    const explicitMath = part
      .replace(/(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\]/g, (_match, tex: string) => `\n$$${normalizeDisplayMath(tex)}$$\n`)
      .replace(/(?<!\\)\\\(([\s\S]*?)(?<!\\)\\\)/g, (_match, tex: string) => `$${tex}$`)
      .replace(/^[ \t]*\$\$[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\$\$[ \t]*$/gm, (_match, tex: string) => `$$${normalizeDisplayMath(tex)}$$`)
    const normalized = protectLiteralDollars(explicitMath)
    if (options.displayMathStyle !== 'multiline') return normalized
    return normalized.replace(/^[ \t]*\$\$([^\r\n]*?)\$\$[ \t]*$/gm, (_match, tex: string) => `$$\n${tex}\n$$`)
  }).join('')
}
