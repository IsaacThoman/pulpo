/** Splits a shell command line into words, honoring quotes and backslash escapes. */
export function shellWords(line: string): string[] {
  const words: string[] = []
  let word: string | null = null
  let quote: '"' | "'" | null = null
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!
    if (quote) {
      if (char === quote) quote = null
      else if (char === '\\' && quote === '"' && index + 1 < line.length) word += line[++index]!
      else word += char
    } else if (char === '"' || char === "'") {
      quote = char
      word ??= ''
    } else if (char === '\\' && index + 1 < line.length) {
      word = (word ?? '') + line[++index]!
    } else if (/\s/.test(char)) {
      if (word !== null) words.push(word)
      word = null
    } else {
      word = (word ?? '') + char
    }
  }
  if (word !== null) words.push(word)
  return words
}

/** Options of `pulpo files` subcommands that take a value. */
const VALUE_OPTIONS = new Set(['--to', '--depth'])

/**
 * The (first) `pulpo files` subcommand a bash command runs and its first path, when running
 * `pulpo files` is all it does, after an optional `cd … &&`. Anything else keeps the bash label.
 */
export function pulpoFilesCommand(command: string): { subcommand: string; path?: string } | null {
  // Splitting on operators inside quotes only matters for odd paths; those fall back to bash.
  const segments = command.split(/&&|\|\||;|\n/).map((segment) => segment.trim()).filter(Boolean)
  let found: { subcommand: string; path?: string } | null = null
  for (const segment of segments) {
    const words = shellWords(segment)
    if (words[0] === 'cd') continue
    if (!/(^|\/)pulpo$/.test(words[0] ?? '') || words[1] !== 'files') return null
    if (found) continue
    const rest = words.slice(2)
    const subcommand = rest[0] && !rest[0].startsWith('-') ? rest[0] : 'help'
    const positional = rest.slice(1).filter((word, index, all) => !word.startsWith('-') && !VALUE_OPTIONS.has(all[index - 1] ?? ''))
    found = { subcommand, path: positional[0] }
  }
  return found
}

/** The last segment of an agent path, for labels such as "Reading Plan.md…". */
export function agentPathName(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || path
}
