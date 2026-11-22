import { agentPathName, pulpoFilesCommand } from '@pulpo/client-core/files';
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
} from 'lucide-react-native';

type ToolActivityPresentation = {
  icon: LucideIcon;
  label: string;
};

const presentations: Record<string, ToolActivityPresentation> = {
  read: { icon: FileText, label: 'Reading a file…' },
  generate_image: { icon: Image, label: 'Generating an image…' },
  view_image: { icon: Image, label: 'Viewing an image…' },
  bash: { icon: Terminal, label: 'Running bash…' },
  // A full-access run on a Windows computer names its shell tool `powershell`.
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
  files_list: { icon: FolderOpen, label: 'Looking through your files…' },
  files_read: { icon: FileText, label: 'Reading a document…' },
  files_write: { icon: FilePlus, label: 'Writing a document…' },
  files_edit: { icon: FilePenLine, label: 'Editing a document…' },
  files_create_folder: { icon: FolderPlus, label: 'Creating a folder…' },
};

/** What a `pulpo files` command in the agent's bash does, as the web labels it. */
function filesCommandPresentation(command: string): ToolActivityPresentation | null {
  const parsed = pulpoFilesCommand(command);
  if (!parsed) return null;
  const name = parsed.path ? agentPathName(parsed.path) : null;
  switch (parsed.subcommand) {
    case 'ls':
    case 'tree': return { icon: FolderOpen, label: 'Looking through your files…' };
    case 'cat': return { icon: FileText, label: name ? `Reading ${name}…` : 'Reading a file…' };
    case 'grep': return { icon: Search, label: 'Searching your files…' };
    case 'pull': return { icon: FolderDown, label: 'Copying from Files…' };
    case 'push': return { icon: FolderUp, label: 'Saving to Files…' };
    case 'status': return { icon: FileDiff, label: 'Checking for changes…' };
    case 'mkdir': return { icon: FolderPlus, label: 'Creating a folder…' };
    case 'mv': return { icon: FolderInput, label: name ? `Moving ${name}…` : 'Moving an item…' };
    case 'rm': return { icon: Trash2, label: name ? `Moving ${name} to the trash…` : 'Moving an item to the trash…' };
    default: return { icon: FolderOpen, label: 'Working with your files…' };
  }
}

/** The app tools of a full-access run on the user's computer, labelled as the web labels them. */
function appToolPresentation(tool: string, args: unknown): ToolActivityPresentation | null {
  const app = args && typeof args === 'object' ? (args as { app?: unknown }).app : undefined;
  const trimmed = typeof app === 'string' ? app.trim() : '';
  const name = trimmed.length > 40 ? `${trimmed.slice(0, 39)}…` : trimmed;
  switch (tool) {
    case 'app_list': return { icon: AppWindow, label: 'Checking which apps are open…' };
    case 'app_view': return { icon: AppWindow, label: name ? `Looking at ${name}…` : 'Looking at an app…' };
    case 'app_click': return { icon: MousePointerClick, label: name ? `Clicking in ${name}…` : 'Clicking in an app…' };
    case 'app_type': return { icon: Keyboard, label: name ? `Typing in ${name}…` : 'Typing in an app…' };
    case 'app_key': return { icon: Keyboard, label: name ? `Pressing keys in ${name}…` : 'Pressing keys in an app…' };
    case 'app_scroll': return { icon: Mouse, label: name ? `Scrolling in ${name}…` : 'Scrolling in an app…' };
    case 'app_drag': return { icon: Move, label: name ? `Dragging in ${name}…` : 'Dragging in an app…' };
    case 'app_set_value': return { icon: TextCursorInput, label: name ? `Filling in a field in ${name}…` : 'Filling in a field…' };
    default: return null;
  }
}

export function toolActivityPresentation(name?: string, args?: unknown): ToolActivityPresentation {
  const command = name === 'bash' && args && typeof args === 'object' ? (args as { command?: unknown }).command : undefined;
  const files = typeof command === 'string' ? filesCommandPresentation(command) : null;
  if (files) return files;
  const app = name?.startsWith('app_') ? appToolPresentation(name, args) : null;
  if (app) return app;
  return name && presentations[name]
    ? presentations[name]
    : { icon: Wrench, label: 'Working…' };
}
