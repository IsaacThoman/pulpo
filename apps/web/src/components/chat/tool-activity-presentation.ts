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
import { agentPathName, pulpoFilesCommand } from '@pulpo/client-core/files'
import { ui } from '@/i18n/ui'

export { pulpoFilesCommand } from '@pulpo/client-core/files'

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

function filesCommandPresentation(command: string): ToolActivityPresentation | null {
  const parsed = pulpoFilesCommand(command)
  if (!parsed) return null
  const name = parsed.path ? agentPathName(parsed.path) : null
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
