type DisplayMathStyle = NonNullable<MathDelimiterOptions['displayMathStyle']>

function normalizeDisplayMath(tex: string, style: DisplayMathStyle): string {
  if (style === 'single-line') return tex.trim().replace(/\s*\r?\n\s*/g, ' ')
  return tex.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join('\n')
}

function displayMathBlock(tex: string, style: DisplayMathStyle): string {
  const normalized = normalizeDisplayMath(tex, style)
  return style === 'single-line' ? `$$${normalized}$$` : `$$\n${normalized}\n$$`
}

/** Replace `\[...\]` pairs by nesting depth, so an inner block cannot close its enclosing one. */
function replaceBracketDisplayMath(content: string, style: DisplayMathStyle): string {
  let result = ''
  let cursor = 0
  let opening = -1
  let depth = 0
  for (let index = 0; index < content.length - 1; index += 1) {
    if (content[index] !== '\\' || isEscaped(content, index)) continue
    const delimiter = content[index + 1]
    if (delimiter === '[') {
      if (depth === 0) opening = index
      depth += 1
    } else if (delimiter === ']' && depth > 0) {
      depth -= 1
      if (depth === 0) {
        result += `${content.slice(cursor, opening)}\n${displayMathBlock(content.slice(opening + 2, index), style)}\n`
        cursor = index + 2
      }
    }
    index += 1
  }
  return result + content.slice(cursor)
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
  const style = options.displayMathStyle ?? 'single-line'
  const parts = content.split(/(```[\s\S]*?```|`[^`\n]+`)/g)
  return parts.map((part, index) => {
    if (index % 2 === 1) return part
    const explicitMath = replaceBracketDisplayMath(part, style)
      .replace(/(?<!\\)\\\(([\s\S]*?)(?<!\\)\\\)/g, (_match, tex: string) => `$${tex}$`)
      .replace(/^[ \t]*\$\$[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\$\$[ \t]*$/gm, (_match, tex: string) => displayMathBlock(tex, style))
    const normalized = protectLiteralDollars(explicitMath)
    if (style !== 'multiline') return normalized
    return normalized.replace(/^[ \t]*\$\$([^\r\n]*?)\$\$[ \t]*$/gm, (_match, tex: string) => `$$\n${tex}\n$$`)
  }).join('')
}
