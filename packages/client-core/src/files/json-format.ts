/** JSON larger than this is not pretty-printed automatically. */
export const MAX_JSON_FORMAT_CHARACTERS = 5_000_000
/** Formatted output may grow to this multiple of the input (deep nesting grows indentation fast). */
const MAX_FORMAT_GROWTH = 4
/** Formatting stops past this many characters, however small the input. */
const MAX_FORMATTED_CHARACTERS = 10_000_000

/**
 * JSON re-indented with two spaces, or null when the text isn't valid JSON, is too large (before
 * or after formatting), or is already formatted that way.
 *
 * Only whitespace between tokens changes: strings and numbers are copied exactly as written. A
 * parse/stringify round trip would show (and let users copy) different data, since numbers beyond
 * double precision get rounded (`9007199254740993`), overflow to `null` (`1e400`), or lose their
 * spelling (`1.0`), and string escapes get rewritten.
 */
export function formatJson(text: string): string | null {
  if (text.length > MAX_JSON_FORMAT_CHARACTERS) return null
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  try {
    JSON.parse(source)
  } catch {
    return null
  }
  // Indentation grows with depth on every line, so a small, deeply nested file could expand
  // enormously; past this budget the file is shown as written instead.
  const budget = Math.min(MAX_FORMATTED_CHARACTERS, Math.max(1_000_000, source.length * MAX_FORMAT_GROWTH))
  const out: string[] = []
  let size = 0
  let depth = 0
  const newline = () => {
    size += 1 + depth * 2
    out.push('\n', '  '.repeat(depth))
  }
  for (let index = 0; index < source.length; index++) {
    // Tokens are copied from the input, so only indentation can push the output past the budget.
    if (size + index > budget) return null
    const char = source[index]!
    if (char === '"') {
      // Valid JSON, so the string ends at the first quote not escaped by a backslash.
      let end = index + 1
      while (source[end] !== '"') end += source[end] === '\\' ? 2 : 1
      out.push(source.slice(index, end + 1))
      index = end
    } else if (char === '{' || char === '[') {
      const close = char === '{' ? '}' : ']'
      let next = index + 1
      while (/\s/.test(source[next] ?? '')) next++
      if (source[next] === close) {
        out.push(char, close)
        index = next
      } else {
        out.push(char)
        depth++
        newline()
      }
    } else if (char === '}' || char === ']') {
      depth--
      newline()
      out.push(char)
    } else if (char === ',') {
      out.push(',')
      newline()
    } else if (char === ':') {
      out.push(': ')
    } else if (!/\s/.test(char)) {
      // Numbers, true, false, null: copied as one run.
      let end = index
      while (end + 1 < source.length && !/[\s,:\]}]/.test(source[end + 1]!)) end++
      out.push(source.slice(index, end + 1))
      index = end
    }
  }
  const formatted = out.join('')
  return formatted === text ? null : formatted
}
