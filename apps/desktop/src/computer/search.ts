import { open, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { COMPUTER_SKIPPED_FOLDERS } from '@pulpo/contracts'
import { ComputerError } from './errors'

/**
 * find and grep without ripgrep, which users do not have. Both skip `.git` and `node_modules`,
 * never follow symlinks, and stop at caps that keep the main process responsive.
 */

export const SEARCH_MAX_FILES = 50_000
export const SEARCH_MAX_OUTPUT_BYTES = 5 * 1024 * 1024
export const SEARCH_MAX_FILE_BYTES = 10 * 1024 * 1024
const SEARCH_MAX_LINE_CHARACTERS = 2_000
const BINARY_SAMPLE_BYTES = 4_096
/** How long one file's matching may take before the pattern is blamed. */
const MATCH_TIMEOUT_MS = 1_000
/**
 * How long one search may run in all. Matching happens on the main process, a file at a time, so a
 * pattern that is merely slow over a big folder must end and say it is incomplete.
 */
export const SEARCH_TIME_BUDGET_MS = 15_000

const SKIPPED = new Set<string>(COMPUTER_SKIPPED_FOLDERS)

export function isSkippedFolder(name: string): boolean { return SKIPPED.has(name) }

/** The longest glob accepted, and how many `{a,b}` combinations and pattern steps it may come to. */
const GLOB_MAX_LENGTH = 1_000
const GLOB_MAX_ALTERNATIVES = 100
const GLOB_MAX_TOKENS = 2_000

type GlobToken =
  | { kind: 'literal'; character: string }
  /** `?`: one character other than `/`. */
  | { kind: 'one' }
  | { kind: 'class'; expression: RegExp }
  /** `*`: any run of characters other than `/`. */
  | { kind: 'star' }
  /** `**`: any run of characters. */
  | { kind: 'globstar' }
  // Opens a `**` with its slash at the start of a segment, which may also match nothing: matching may jump to `to`.
  | { kind: 'skip'; to: number }

/** A glob as it is written: tokens, `**` with its slash at the start of a segment, and `{a,b}` alternatives. */
type GlobPiece = Exclude<GlobToken, { kind: 'skip' }> | { kind: 'folders' } | { kind: 'alternatives'; options: GlobPiece[][] }

function parseGlob(glob: string, ignoreCase: boolean): GlobPiece[] {
  let index = 0
  // A sequence ends with the glob or, inside braces, at the `,` or `}` that closes it.
  const sequence = (inBraces: boolean): GlobPiece[] => {
    const pieces: GlobPiece[] = []
    for (; index < glob.length; index += 1) {
      const character = glob[index]!
      if (inBraces && (character === ',' || character === '}')) break
      if (character === '*') {
        if (glob[index + 1] !== '*') { pieces.push({ kind: 'star' }); continue }
        const startsSegment = (index === 0 || glob[index - 1] === '/') && glob[index + 2] === '/'
        // `**/` at the start of a segment: any folders, or none at all.
        pieces.push({ kind: startsSegment ? 'folders' : 'globstar' })
        index += startsSegment ? 2 : 1
      } else if (character === '?') pieces.push({ kind: 'one' })
      else if (character === '[' && glob.indexOf(']', index + 1) >= 0) {
        const close = glob.indexOf(']', index + 1)
        const body = glob.slice(index + 1, close).replace(/\\/g, '\\\\').replace(/^!/, '^')
        // Tested against one character at a time, so it cannot take long whatever it holds.
        try { pieces.push({ kind: 'class', expression: new RegExp(`^[${body}]$`, ignoreCase ? 'i' : '') }) } catch {
          throw new ComputerError('invalid_request', `Invalid character class [${body.slice(0, 50)}] in the glob`)
        }
        index = close
      } else if (character === '{') {
        const options: GlobPiece[][] = []
        do {
          index += 1
          options.push(sequence(true))
          if (index >= glob.length) throw new ComputerError('invalid_request', `Unbalanced braces in glob "${glob.slice(0, 100)}"`)
        } while (glob[index] === ',')
        pieces.push({ kind: 'alternatives', options })
      } else pieces.push({ kind: 'literal', character: ignoreCase ? character.toLowerCase() : character })
    }
    return pieces
  }
  return sequence(false)
}

/** Writes out every combination of the `{a,b}` alternatives as its own run of tokens. */
function expandGlob(pieces: GlobPiece[], glob: string): Array<Array<Exclude<GlobPiece, { kind: 'alternatives' }>>> {
  let results: Array<Array<Exclude<GlobPiece, { kind: 'alternatives' }>>> = [[]]
  for (const piece of pieces) {
    const options = piece.kind === 'alternatives' ? piece.options.flatMap((option) => expandGlob(option, glob)) : [[piece]]
    if (results.length * options.length > GLOB_MAX_ALTERNATIVES) throw new ComputerError('invalid_request', `The glob "${glob.slice(0, 100)}" has too many {a,b} alternatives`)
    results = results.flatMap((left) => options.map((right) => [...left, ...right]))
  }
  return results
}

function tokensOf(pieces: Array<Exclude<GlobPiece, { kind: 'alternatives' }>>): GlobToken[] {
  const tokens: GlobToken[] = []
  for (const piece of pieces) {
    if (piece.kind === 'folders') tokens.push({ kind: 'skip', to: tokens.length + 3 }, { kind: 'globstar' }, { kind: 'literal', character: '/' })
    else tokens.push(piece)
  }
  return tokens
}

/**
 * A matcher for one plain glob that follows every way the pattern could match at once, a character
 * at a time. It never backtracks, so its cost is at most the pattern's length times the path's:
 * a pattern like `*a*a*a…b`, which makes a regular expression take forever, cannot freeze the app.
 */
function tokenMatcher(tokens: GlobToken[], ignoreCase: boolean): (text: string) => boolean {
  const size = tokens.length
  let active = new Uint8Array(size + 1)
  let next = new Uint8Array(size + 1)
  // What can be reached without reading anything; these steps only ever lead forward.
  const reach = (states: Uint8Array) => {
    for (let position = 0; position < size; position += 1) {
      if (!states[position]) continue
      const token = tokens[position]!
      if (token.kind === 'star' || token.kind === 'globstar') states[position + 1] = 1
      else if (token.kind === 'skip') { states[position + 1] = 1; states[token.to] = 1 }
    }
  }
  return (text) => {
    active.fill(0)
    active[0] = 1
    reach(active)
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index]!
      const compared = ignoreCase ? character.toLowerCase() : character
      next.fill(0)
      let alive = false
      for (let position = 0; position < size; position += 1) {
        if (!active[position]) continue
        const token = tokens[position]!
        let to = -1
        if (token.kind === 'literal') { if (token.character === compared) to = position + 1 }
        else if (token.kind === 'one') { if (character !== '/') to = position + 1 }
        else if (token.kind === 'class') { if (token.expression.test(character)) to = position + 1 }
        else if (token.kind === 'star') { if (character !== '/') to = position }
        else if (token.kind === 'globstar') to = position
        if (to >= 0) { next[to] = 1; alive = true }
      }
      if (!alive) return false
      reach(next)
      const swap = active; active = next; next = swap
    }
    return active[size] === 1
  }
}

/** Compiles a glob (`*`, `**`, `?`, `[…]`, `{a,b}`) into a test over `/`-separated paths. */
export function compileGlob(glob: string, ignoreCase = false): (text: string) => boolean {
  if (glob.length > GLOB_MAX_LENGTH) throw new ComputerError('invalid_request', `The glob is longer than ${GLOB_MAX_LENGTH} characters`)
  const alternatives = expandGlob(parseGlob(glob, ignoreCase), glob).map(tokensOf)
  if (alternatives.reduce((total, tokens) => total + tokens.length, 0) > GLOB_MAX_TOKENS) throw new ComputerError('invalid_request', 'The glob is too long once its {a,b} alternatives are written out')
  const matchers = alternatives.map((tokens) => tokenMatcher(tokens, ignoreCase))
  return (text) => matchers.some((matches) => matches(text))
}

/** Matches a glob the way ripgrep's `--glob` does: a pattern without `/` matches the file name at any depth. */
export function globMatcher(glob: string, ignoreCase = false): (relativePath: string) => boolean {
  const pattern = glob.replace(/^\.\//, '').replace(/^\//, '')
  const matches = compileGlob(pattern, ignoreCase)
  return pattern.includes('/') ? matches : (relativePath) => matches(relativePath.slice(relativePath.lastIndexOf('/') + 1))
}

export interface LineMatch { line: number; text: string }

/**
 * Runs a regular expression over text in a separate V8 context with a time limit: patterns come
 * from the agent, and a catastrophic one would otherwise freeze the app.
 */
export function createLineMatcher(pattern: string, options: { ignoreCase?: boolean; fixed?: boolean } = {}): (text: string, limit: number) => LineMatch[] {
  const source = options.fixed ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pattern
  const flags = options.ignoreCase ? 'i' : ''
  try { new RegExp(source, flags) } catch (error) {
    throw new ComputerError('invalid_request', `Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`)
  }
  const context = vm.createContext({ source, flags, text: '', limit: 0, maxCharacters: SEARCH_MAX_LINE_CHARACTERS, result: [] as LineMatch[] })
  const script = new vm.Script(`
    result = [];
    { const expression = new RegExp(source, flags); const lines = text.split('\\n');
      for (let index = 0; index < lines.length && result.length < limit; index += 1) {
        const line = lines[index].endsWith('\\r') ? lines[index].slice(0, -1) : lines[index];
        if (expression.test(line)) result.push({ line: index + 1, text: line.length > maxCharacters ? line.slice(0, maxCharacters) + '…' : line });
      } }`)
  return (text, limit) => {
    context.text = text
    context.limit = limit
    try { script.runInContext(context, { timeout: MATCH_TIMEOUT_MS }) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') throw new ComputerError('invalid_request', 'The search pattern took too long to run; use a simpler pattern.')
      throw error
    } finally { context.text = '' }
    return (context.result as LineMatch[]).map(({ line, text: value }) => ({ line, text: value }))
  }
}

export function looksBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, BINARY_SAMPLE_BYTES)
  return sample.includes(0)
}

/** A file's text for searching, or null for binary or oversized files. */
export async function searchableText(file: string): Promise<string | null> {
  const handle = await open(file, 'r')
  try {
    const metadata = await handle.stat()
    if (!metadata.isFile() || metadata.size > SEARCH_MAX_FILE_BYTES) return null
    const bytes = await handle.readFile()
    return looksBinary(bytes) ? null : bytes.toString('utf8')
  } finally { await handle.close() }
}

export interface WalkEntry { absolute: string; relative: string; kind: 'file' | 'folder' }

/**
 * Walks a folder depth-first in name order. Symlinks are never followed or reported. Folders
 * named in COMPUTER_SKIPPED_FOLDERS below the start are reported to `onSkipped` instead.
 */
export async function* walk(root: string, options: { shouldStop?: () => boolean; onSkipped?: (relative: string) => void; relative?: string } = {}): AsyncGenerator<WalkEntry> {
  let entries
  try { entries = await readdir(root, { withFileTypes: true }) } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EACCES' || code === 'EPERM') return
    throw error
  }
  entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
  for (const entry of entries) {
    if (options.shouldStop?.()) return
    if (entry.isSymbolicLink()) continue
    const relative = options.relative ? `${options.relative}/${entry.name}` : entry.name
    const absolute = path.join(root, entry.name)
    if (entry.isDirectory()) {
      if (isSkippedFolder(entry.name)) { options.onSkipped?.(relative); continue }
      yield { absolute, relative, kind: 'folder' }
      yield* walk(absolute, { ...options, relative })
    } else if (entry.isFile()) yield { absolute, relative, kind: 'file' }
  }
}

export interface SearchOutput { output: string; exitCode: number; complete: boolean }

function displayJoin(base: string, relative: string): string {
  if (!base || base === '.') return relative
  return `${base.replace(/[\\/]+$/, '')}/${relative}`
}

class OutputCollector {
  private readonly lines: string[] = []
  private bytes = 0
  full = false
  add(line: string): void {
    if (this.full) return
    const size = Buffer.byteLength(line, 'utf8') + 1
    if (this.bytes + size > SEARCH_MAX_OUTPUT_BYTES) { this.full = true; return }
    this.lines.push(line); this.bytes += size
  }
  get count(): number { return this.lines.length }
  text(notes: string[]): string { return [...this.lines, ...notes].join('\n') }
}

/** `find`: files under `searchPath` (relative to `cwd`, or absolute) whose path matches the glob. */
export async function findFiles(cwd: string, args: { pattern?: unknown; path?: unknown }, shouldStop?: () => boolean, platform: NodeJS.Platform = process.platform): Promise<SearchOutput> {
  const base = typeof args.path === 'string' && args.path ? args.path : '.'
  const root = path.resolve(cwd, base)
  const matches = globMatcher(typeof args.pattern === 'string' && args.pattern ? args.pattern : '*', platform === 'win32')
  const output = new OutputCollector()
  let visited = 0
  const deadline = Date.now() + SEARCH_TIME_BUDGET_MS
  let timedOut = false
  const stop = () => {
    if (Date.now() > deadline) timedOut = true
    return timedOut || output.full || visited >= SEARCH_MAX_FILES || Boolean(shouldStop?.())
  }
  const metadata = await stat(root)
  if (metadata.isFile()) {
    if (matches(path.basename(root))) output.add(base)
  } else {
    for await (const entry of walk(root, { shouldStop: stop })) {
      if (entry.kind !== 'file') continue
      visited += 1
      if (matches(entry.relative)) output.add(displayJoin(base, entry.relative))
    }
  }
  const notes: string[] = []
  if (visited >= SEARCH_MAX_FILES) notes.push(`[Stopped after ${SEARCH_MAX_FILES} files; narrow the path or pattern.]`)
  if (timedOut) notes.push(`[Stopped after ${SEARCH_TIME_BUDGET_MS / 1000} seconds; narrow the path or pattern.]`)
  if (output.full) notes.push(`[Output stopped at ${SEARCH_MAX_OUTPUT_BYTES / 1024 / 1024} MB; narrow the path or pattern.]`)
  return { output: output.text(notes), exitCode: output.count ? 0 : 1, complete: notes.length === 0 }
}

/** `grep`: lines matching a regular expression, printed `path:line:text`. */
export async function grepFiles(cwd: string, args: { pattern?: unknown; path?: unknown; ignoreCase?: unknown }, shouldStop?: () => boolean): Promise<SearchOutput> {
  const pattern = typeof args.pattern === 'string' ? args.pattern : ''
  if (!pattern) throw new ComputerError('invalid_request', 'pattern must be a non-empty string')
  const base = typeof args.path === 'string' && args.path ? args.path : '.'
  const root = path.resolve(cwd, base)
  const match = createLineMatcher(pattern, { ignoreCase: args.ignoreCase === true })
  const output = new OutputCollector()
  let visited = 0
  const deadline = Date.now() + SEARCH_TIME_BUDGET_MS
  let timedOut = false
  const stop = () => {
    if (Date.now() > deadline) timedOut = true
    return timedOut || output.full || visited >= SEARCH_MAX_FILES || Boolean(shouldStop?.())
  }
  const searchFile = async (absolute: string, display: string) => {
    visited += 1
    let text: string | null
    try { text = await searchableText(absolute) } catch { return }
    if (text === null) return
    for (const found of match(text, Number.MAX_SAFE_INTEGER)) {
      output.add(`${display}:${found.line}:${found.text}`)
      if (output.full) return
    }
  }
  const metadata = await stat(root)
  if (metadata.isFile()) await searchFile(root, base)
  else for await (const entry of walk(root, { shouldStop: stop })) if (entry.kind === 'file') await searchFile(entry.absolute, displayJoin(base, entry.relative))
  const notes: string[] = []
  if (visited >= SEARCH_MAX_FILES) notes.push(`[Stopped after ${SEARCH_MAX_FILES} files; narrow the path or pattern.]`)
  if (timedOut) notes.push(`[Stopped after ${SEARCH_TIME_BUDGET_MS / 1000} seconds; narrow the path or pattern.]`)
  if (output.full) notes.push(`[Output stopped at ${SEARCH_MAX_OUTPUT_BYTES / 1024 / 1024} MB; narrow the path or pattern.]`)
  return { output: output.text(notes), exitCode: output.count ? 0 : 1, complete: notes.length === 0 }
}
