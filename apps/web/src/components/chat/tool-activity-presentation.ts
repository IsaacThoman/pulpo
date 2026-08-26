import {
  FilePenLine,
  FilePlus,
  FileText,
  FolderSearch,
  Globe,
  Image,
  List,
  Paperclip,
  Search,
  Terminal,
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
}

export function toolActivityPresentation(name?: string): ToolActivityPresentation {
  const presentation = name ? presentations[name] : undefined
  return presentation
    ? { ...presentation, label: ui(presentation.label) }
    : { icon: Wrench, label: ui('Working…') }
}
