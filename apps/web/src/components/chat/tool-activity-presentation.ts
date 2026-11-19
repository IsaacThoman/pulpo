import {
  AppWindow,
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
  Keyboard,
  List,
  Mouse,
  MousePointerClick,
  Move,
  Paperclip,
  Search,
  Terminal,
  TextCursorInput,
  Trash2,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { agentPathName, pulpoCliCommand } from '@pulpo/client-core/files'
import { ui } from '@/i18n/ui'

export { pulpoComputerCommand, pulpoFilesCommand } from '@pulpo/client-core/files'

/** Shell tools: `powershell` is what a full-access run on a Windows computer calls its shell. */
export function isShellTool(name?: string): boolean {
  return name === 'bash' || name === 'powershell'
}

type ToolActivityPresentation = {
  icon: LucideIcon
  label: string
}

const presentations: Record<string, ToolActivityPresentation> = {
  read: { icon: FileText, label: 'Reading a file…' },
  generate_image: { icon: Image, label: 'Generating an image…' },
  view_image: { icon: Image, label: 'Viewing an image…' },
  bash: { icon: Terminal, label: 'Running bash…' },
  powershell: { icon: Terminal, label: 'Running PowerShell…' },
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

function cliCommandPresentation(command: string): ToolActivityPresentation | null {
  const parsed = pulpoCliCommand(command)
  if (!parsed) return null
  const name = parsed.path ? agentPathName(parsed.path) : null
  // `pulpo computer` mirrors `pulpo files` on the folder the user chose on their computer.
  const computer = parsed.group === 'computer'
  switch (parsed.subcommand) {
    case 'ls':
    case 'tree': return { icon: FolderOpen, label: computer ? ui("Looking through your folder…") : ui("Looking through your files…") }
    case 'cat': return { icon: FileText, label: name ? ui("Reading {{name}}…", { name }) : ui("Reading a file…") }
    case 'grep': return { icon: Search, label: computer ? ui("Searching your folder…") : ui("Searching your files…") }
    case 'pull': return { icon: FolderDown, label: computer ? ui("Copying from your computer…") : ui("Copying from Files…") }
    case 'push': return { icon: FolderUp, label: computer ? ui("Saving to your computer…") : ui("Saving to Files…") }
    case 'status': return { icon: FileDiff, label: ui("Checking for changes…") }
    case 'mkdir': return { icon: FolderPlus, label: ui("Creating a folder…") }
    case 'mv': return { icon: FolderInput, label: name ? ui("Moving {{name}}…", { name }) : ui("Moving an item…") }
    case 'rm': return { icon: Trash2, label: name ? ui("Moving {{name}} to the trash…", { name }) : ui("Moving an item to the trash…") }
    default: return { icon: FolderOpen, label: computer ? ui("Working with your folder…") : ui("Working with your files…") }
  }
}

/** The app tools: a full-access run seeing and working in another app's window on the user's computer. */
export function isAppTool(name?: string): boolean {
  return Boolean(name?.startsWith('app_'))
}

function appToolName(args: unknown): string | null {
  const app = args && typeof args === 'object' ? (args as { app?: unknown }).app : undefined
  if (typeof app !== 'string' || !app.trim()) return null
  const name = app.trim()
  return name.length > 40 ? `${name.slice(0, 39)}…` : name
}

function appToolPresentation(tool: string, args: unknown): ToolActivityPresentation | null {
  const name = appToolName(args)
  switch (tool) {
    case 'app_list': return { icon: AppWindow, label: ui("Checking which apps are open…") }
    case 'app_view': return { icon: AppWindow, label: name ? ui("Looking at {{name}}…", { name }) : ui("Looking at an app…") }
    case 'app_click': return { icon: MousePointerClick, label: name ? ui("Clicking in {{name}}…", { name }) : ui("Clicking in an app…") }
    case 'app_type': return { icon: Keyboard, label: name ? ui("Typing in {{name}}…", { name }) : ui("Typing in an app…") }
    case 'app_key': return { icon: Keyboard, label: name ? ui("Pressing keys in {{name}}…", { name }) : ui("Pressing keys in an app…") }
    case 'app_scroll': return { icon: Mouse, label: name ? ui("Scrolling in {{name}}…", { name }) : ui("Scrolling in an app…") }
    case 'app_drag': return { icon: Move, label: name ? ui("Dragging in {{name}}…", { name }) : ui("Dragging in an app…") }
    case 'app_set_value': return { icon: TextCursorInput, label: name ? ui("Filling in a field in {{name}}…", { name }) : ui("Filling in a field…") }
    default: return null
  }
}

/** What an app tool was asked to do, in a few words: the app, then the element, point, keys or text. */
export function appToolSummary(tool: string | undefined, args: unknown): string | null {
  if (!isAppTool(tool) || !args || typeof args !== 'object') return null
  const record = args as Record<string, unknown>
  const short = (value: string) => { const line = value.replace(/\s+/g, ' ').trim(); return line.length > 48 ? `${line.slice(0, 48)}…` : line }
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null
  const element = number(record.element)
  const place = element !== null ? `#${element}` : number(record.x) !== null && number(record.y) !== null ? `${number(record.x)},${number(record.y)}` : null
  const detail = tool === 'app_type' && typeof record.text === 'string' ? JSON.stringify(short(record.text))
    : tool === 'app_key' && typeof record.keys === 'string' ? short(record.keys)
    : tool === 'app_scroll' && typeof record.direction === 'string' ? [place, record.direction].filter(Boolean).join(' ')
    : tool === 'app_drag' && number(record.from_x) !== null && number(record.to_x) !== null ? `${number(record.from_x)},${number(record.from_y)} → ${number(record.to_x)},${number(record.to_y)}`
    : tool === 'app_set_value' && typeof record.value === 'string' ? [place, JSON.stringify(short(record.value))].filter(Boolean).join(' ')
    : tool === 'app_view' && typeof record.window === 'string' ? short(record.window)
    : place
  return [appToolName(args), detail].filter(Boolean).join(' · ') || null
}

export function toolActivityPresentation(name?: string, args?: unknown): ToolActivityPresentation {
  // `pulpo` runs only in the cloud workspace's bash, never in a computer's PowerShell.
  const command = name === 'bash' && args && typeof args === 'object' ? (args as { command?: unknown }).command : undefined
  const cli = typeof command === 'string' ? cliCommandPresentation(command) : null
  if (cli) return cli
  const app = name && isAppTool(name) ? appToolPresentation(name, args) : null
  if (app) return app
  const presentation = name ? presentations[name] : undefined
  return presentation
    ? { ...presentation, label: ui(presentation.label) }
    : { icon: Wrench, label: ui('Working…') }
}
