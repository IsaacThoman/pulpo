import vm from 'node:vm'
import { FilesCommandError } from './scope.js'

/** Total time one search may spend matching, so a pathological pattern cannot stall the worker. */
const MATCH_BUDGET_MS = 3_000

// Runs in its own context so the time limit can interrupt a backtracking regular expression.
const MATCH_SCRIPT = new vm.Script(`(() => {
  const pattern = new RegExp(source, flags)
  const matches = []
  for (let index = 0; index < lines.length; index += 1) if (pattern.test(lines[index])) matches.push(index)
  return matches
})()`)

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * A line matcher for an agent-supplied pattern: a JavaScript regular expression, or literal
 * text with `fixed`. Returns the indexes of matching lines; throws once the search has used up
 * its time budget.
 */
export function createLineMatcher(pattern: string, options: { ignoreCase?: boolean; fixed?: boolean } = {}): (lines: string[]) => number[] {
  const source = options.fixed ? escapeRegExp(pattern) : pattern
  const flags = options.ignoreCase ? 'i' : ''
  try {
    // Compiling is linear in the pattern; only matching can run away.
    new RegExp(source, flags)
  } catch (error) {
    throw new FilesCommandError(`Invalid pattern: ${error instanceof Error ? error.message : String(error)}. Use -F to search for literal text`)
  }
  const context = vm.createContext({ source, flags, lines: [] as string[] })
  const deadline = Date.now() + MATCH_BUDGET_MS
  return (lines) => {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new FilesCommandError('The search took too long; simplify the pattern, use -F, or search a smaller folder')
    context.lines = lines
    try {
      return Array.from(MATCH_SCRIPT.runInContext(context, { timeout: remaining }) as number[])
    } catch (error) {
      if ((error as { code?: string }).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
        throw new FilesCommandError('The search took too long; simplify the pattern, use -F, or search a smaller folder')
      }
      throw error
    } finally {
      context.lines = []
    }
  }
}
