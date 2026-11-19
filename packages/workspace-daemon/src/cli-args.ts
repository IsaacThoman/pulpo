import { parseArgs, type ParseArgsConfig } from 'node:util'
import { COMMAND_HELP, COMPUTER_COMMAND_HELP, COMPUTER_HELP, FILES_HELP, type CommandName } from './cli-help.js'
import { CLI_STORES, FILES_STORE, isGroup, type CliStore } from './cli-store.js'

export type Invocation =
  | { command: 'help'; topic?: CommandName }
  | { command: 'ls'; path?: string; recursive: boolean }
  | { command: 'tree'; path?: string; depth?: number }
  | { command: 'cat'; paths: string[] }
  | { command: 'grep'; pattern: string; path?: string; ignoreCase: boolean; fixed: boolean }
  | { command: 'pull'; path: string; dest?: string }
  | { command: 'status' }
  | { command: 'push'; locals: string[]; to?: string; force: boolean }
  | { command: 'mkdir'; paths: string[]; parents: boolean }
  | { command: 'mv'; from: string; to: string }
  | { command: 'rm'; paths: string[]; recursive: boolean }

/** Exit status 2: the command line itself is wrong, so the model should reread the help. */
export class UsageError extends Error {
  constructor(message: string, readonly command?: CommandName, readonly topLevel = false) { super(message) }
}

type Options = NonNullable<ParseArgsConfig['options']>
const flag = (short?: string) => ({ type: 'boolean' as const, ...(short ? { short } : {}) })

// Familiar no-op flags (grep -rn, rm -f) are accepted so habitual invocations still work.
const COMMANDS: Record<CommandName, { options: Options; min: number; max: number; operands: string }> = {
  ls: { options: { recursive: flag('r'), R: flag('R') }, min: 0, max: 1, operands: '[path]' },
  tree: { options: { depth: { type: 'string', short: 'L' } }, min: 0, max: 1, operands: '[path]' },
  cat: { options: {}, min: 1, max: Infinity, operands: '<path>...' },
  grep: { options: { 'ignore-case': flag('i'), 'fixed-strings': flag('F'), recursive: flag('r'), R: flag('R'), 'line-number': flag('n') }, min: 1, max: 2, operands: '<pattern> [path]' },
  pull: { options: {}, min: 1, max: 2, operands: '<path> [dest]' },
  status: { options: {}, min: 0, max: 0, operands: 'no arguments' },
  push: { options: { to: { type: 'string' }, force: flag('f') }, min: 0, max: Infinity, operands: '[local...]' },
  mkdir: { options: { parents: flag('p') }, min: 1, max: Infinity, operands: '<path>...' },
  mv: { options: {}, min: 2, max: 2, operands: '<from> <to>' },
  rm: { options: { recursive: flag('r'), R: flag('R'), force: flag('f') }, min: 1, max: Infinity, operands: '<path>...' },
}

const SUGGESTIONS: Record<string, CommandName> = {
  list: 'ls', dir: 'ls', find: 'grep', search: 'grep', read: 'cat', show: 'cat', view: 'cat', get: 'pull',
  download: 'pull', fetch: 'pull', clone: 'pull', checkout: 'pull', upload: 'push', save: 'push', put: 'push',
  commit: 'push', sync: 'push', diff: 'status', move: 'mv', rename: 'mv', delete: 'rm', remove: 'rm', trash: 'rm',
  del: 'rm', mkdirs: 'mkdir', md: 'mkdir', 'new-folder': 'mkdir',
}

const isHelp = (value: string | undefined) => value === '--help' || value === '-h' || value === 'help'
const isCommand = (value: string | undefined): value is CommandName => value !== undefined && Object.hasOwn(COMMANDS, value)

/** Parses `pulpo …` arguments (the wrapper passes everything after `pulpo`). */
export function parseCli(argv: string[]): Invocation {
  return parseInvocation(argv).invocation
}

/** Like parseCli, with the group's store; no store for the top-level help. */
export function parseInvocation(argv: string[]): { store?: CliStore; invocation: Invocation } {
  const [group, name, ...rest] = argv
  if (isHelp(group)) return { invocation: { command: 'help' } }
  if (group === undefined) throw new UsageError('missing command. Use `pulpo files <command>` or `pulpo computer <command>`.', undefined, true)
  if (!isGroup(group)) throw new UsageError(`unknown command "${group}". Only \`pulpo files <command>\` and \`pulpo computer <command>\` are available.`, undefined, true)
  const store = CLI_STORES[group]
  return { store, invocation: parseCommand(store, name, rest) }
}

function parseCommand(store: CliStore, name: string | undefined, rest: string[]): Invocation {
  if (isHelp(name)) return { command: 'help', topic: isCommand(rest[0]) ? rest[0] : undefined }
  if (name === undefined) throw new UsageError('missing command.')
  if (!isCommand(name)) {
    const suggestion = SUGGESTIONS[name.toLowerCase()]
    throw new UsageError(`unknown command "${name}".${suggestion ? ` Did you mean \`pulpo ${store.group} ${suggestion}\`?` : ''}`)
  }
  const spec = COMMANDS[name]
  let parsed: ReturnType<typeof parseArgs>
  try {
    parsed = parseArgs({ args: rest, options: { ...spec.options, help: flag('h') }, allowPositionals: true, strict: true })
  } catch (error) {
    const { code, message } = error as NodeJS.ErrnoException
    if (code !== 'ERR_PARSE_ARGS_UNKNOWN_OPTION') throw new UsageError(message, name)
    const option = /'([^']+)'/.exec(message)?.[1] ?? 'option'
    throw new UsageError(`unknown option ${option}.${name === 'grep' ? ' Put -- before a pattern that starts with "-".' : ''}`, name)
  }
  const values = parsed.values as Record<string, string | boolean | undefined>
  if (values.help) return { command: 'help', topic: name }
  const operands = parsed.positionals
  if (operands.length < spec.min || operands.length > spec.max) {
    throw new UsageError(`expected ${spec.operands}, got ${operands.length ? operands.map((value) => JSON.stringify(value)).join(' ') : 'nothing'}.`, name)
  }
  const recursive = Boolean(values.recursive || values.R)
  switch (name) {
    case 'ls': return { command: 'ls', path: operands[0], recursive }
    case 'tree': {
      if (values.depth === undefined) return { command: 'tree', path: operands[0] }
      const depth = Number(values.depth)
      if (!Number.isInteger(depth) || depth < 1 || depth > 8) throw new UsageError('--depth must be a whole number from 1 to 8.', name)
      return { command: 'tree', path: operands[0], depth }
    }
    case 'cat': return { command: 'cat', paths: operands }
    case 'grep': {
      if (!operands[0]) throw new UsageError('the search pattern is empty.', name)
      return { command: 'grep', pattern: operands[0], path: operands[1], ignoreCase: Boolean(values['ignore-case']), fixed: Boolean(values['fixed-strings']) }
    }
    case 'pull': return { command: 'pull', path: operands[0]!, dest: operands[1] }
    case 'status': return { command: 'status' }
    case 'push': {
      if (values.to !== undefined && (typeof values.to !== 'string' || !values.to.trim())) throw new UsageError(`--to needs a ${store.pathNoun}.`, name)
      return { command: 'push', locals: operands, to: values.to as string | undefined, force: Boolean(values.force) }
    }
    case 'mkdir': return { command: 'mkdir', paths: operands, parents: Boolean(values.parents) }
    case 'mv': return { command: 'mv', from: operands[0]!, to: operands[1]! }
    case 'rm': return { command: 'rm', paths: operands, recursive }
  }
}

export function helpText(topic?: CommandName, store: CliStore = FILES_STORE): string {
  if (store.group === 'computer') return topic ? COMPUTER_COMMAND_HELP[topic] : COMPUTER_HELP
  return topic ? COMMAND_HELP[topic] : FILES_HELP
}
