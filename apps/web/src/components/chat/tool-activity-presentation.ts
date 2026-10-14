import {
  FileDiff,
  FilePenLine,
  FilePlus,
  FileText,
  FolderDown,
  FolderInput,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  FolderUp,
  Globe,
  Image,
  List,
  Paperclip,
  Search,
  Terminal,
  Trash2,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { ui } from '@/i18n/ui'

type ToolActivityPresentation = {
  icon: LucideIcon
  label: string
}

const presentations: Record<string, ToolActivityPresentation> = {
  read: { icon: FileText, label: 'Reading a file…' },
  generate_image: { icon: Image, label: 'Generating an image…' },
  view_image: { icon: Image, label: 'Viewing an image…' },
  bash: { icon: Terminal, label: 'Running bash…' },
  write: { icon: FilePlus, label: 'Writing a file…' },
  edit: { icon: FilePenLine, label: 'Editing a file…' },
  ls: { icon: List, label: 'Listing files…' },
  find: { icon: FolderSearch, label: 'Finding files…' },
  grep: { icon: Search, label: 'Searching files…' },
  attach_file: { icon: Paperclip, label: 'Attaching a file…' },
  web_search: { icon: Search, label: 'Searching the web…' },
  web_fetch: { icon: Globe, label: 'Fetching a webpage…' },
  update_memory: { icon: FilePenLine, label: 'Updating memory…' },
}

/** Splits a shell command line into words, honoring quotes and backslash escapes. */
function shellWords(line: string): string[] {
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

function baseName(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || path
}

function filesCommandPresentation(command: string): ToolActivityPresentation | null {
  const parsed = pulpoFilesCommand(command)
  if (!parsed) return null
  const name = parsed.path ? baseName(parsed.path) : null
  switch (parsed.subcommand) {
    case 'ls':
    case 'tree': return { icon: FolderOpen, label: ui("Looking through your files…") }
    case 'cat': return { icon: FileText, label: name ? ui("Reading {{name}}…", { name }) : ui("Reading a file…") }
    case 'grep': return { icon: Search, label: ui("Searching your files…") }
    case 'pull': return { icon: FolderDown, label: ui("Copying from Files…") }
    case 'push': return { icon: FolderUp, label: ui("Saving to Files…") }
    case 'status': return { icon: FileDiff, label: ui("Checking for changes…") }
    case 'mkdir': return { icon: FolderPlus, label: ui("Creating a folder…") }
    case 'mv': return { icon: FolderInput, label: name ? ui("Moving {{name}}…", { name }) : ui("Moving an item…") }
    case 'rm': return { icon: Trash2, label: name ? ui("Moving {{name}} to the trash…", { name }) : ui("Moving an item to the trash…") }
    default: return { icon: FolderOpen, label: ui("Working with your files…") }
  }
}

export function toolActivityPresentation(name?: string, args?: unknown): ToolActivityPresentation {
  const command = name === 'bash' && args && typeof args === 'object' ? (args as { command?: unknown }).command : undefined
  const files = typeof command === 'string' ? filesCommandPresentation(command) : null
  if (files) return files
  const presentation = name ? presentations[name] : undefined
  return presentation
    ? { ...presentation, label: ui(presentation.label) }
    : { icon: Wrench, label: ui('Working…') }
}
