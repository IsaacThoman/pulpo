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

/** Options of `pulpo files` / `pulpo computer` subcommands that take a value. */
const VALUE_OPTIONS = new Set(['--to', '--depth'])

/** The `pulpo` CLI groups: Files, and the folder on the user's computer (same subcommands). */
export type PulpoCliGroup = 'files' | 'computer'
export type PulpoCliCommand = { group: PulpoCliGroup; subcommand: string; path?: string }

/**
 * The (first) `pulpo files|computer` subcommand a bash command runs and its first path, when
 * running one group of `pulpo` is all it does, after an optional `cd … &&`. Anything else keeps
 * the bash label.
 */
export function pulpoCliCommand(command: string): PulpoCliCommand | null {
  // Splitting on operators inside quotes only matters for odd paths; those fall back to bash.
  const segments = command.split(/&&|\|\||;|\n/).map((segment) => segment.trim()).filter(Boolean)
  let found: PulpoCliCommand | null = null
  for (const segment of segments) {
    const words = shellWords(segment)
    if (words[0] === 'cd') continue
    const group = words[1]
    if (!/(^|\/)pulpo$/.test(words[0] ?? '') || (group !== 'files' && group !== 'computer')) return null
    // Mixing groups (copy from the computer, save to Files) is described best by the plain command.
    if (found && found.group !== group) return null
    if (found) continue
    const rest = words.slice(2)
    const subcommand = rest[0] && !rest[0].startsWith('-') ? rest[0] : 'help'
    const positional = rest.slice(1).filter((word, index, all) => !word.startsWith('-') && !VALUE_OPTIONS.has(all[index - 1] ?? ''))
    found = { group, subcommand, path: positional[0] }
  }
  return found
}

function groupCommand(command: string, group: PulpoCliGroup): { subcommand: string; path?: string } | null {
  const parsed = pulpoCliCommand(command)
  return parsed?.group === group ? { subcommand: parsed.subcommand, path: parsed.path } : null
}

/** {@link pulpoCliCommand} for `pulpo files` only. */
export function pulpoFilesCommand(command: string): { subcommand: string; path?: string } | null {
  return groupCommand(command, 'files')
}

/** {@link pulpoCliCommand} for `pulpo computer` only. */
export function pulpoComputerCommand(command: string): { subcommand: string; path?: string } | null {
  return groupCommand(command, 'computer')
}

/** The last segment of an agent path, for labels such as "Reading Plan.md…". */
export function agentPathName(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || path
}
