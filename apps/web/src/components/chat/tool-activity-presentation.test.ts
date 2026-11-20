import { describe, expect, it } from 'vitest'
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
} from 'lucide-react'
import { appToolSummary, isAppTool, isShellTool, pulpoComputerCommand, pulpoFilesCommand, toolActivityPresentation } from './tool-activity-presentation'

describe('toolActivityPresentation', () => {
  it.each([
    ['read', 'Reading a file…', FileText],
    ['view_image', 'Viewing an image…', Image],
    ['generate_image', 'Generating an image…', Image],
    ['bash', 'Running bash…', Terminal],
    ['powershell', 'Running PowerShell…', Terminal],
    ['write', 'Writing a file…', FilePlus],
    ['edit', 'Editing a file…', FilePenLine],
    ['ls', 'Listing files…', List],
    ['find', 'Finding files…', FolderSearch],
    ['grep', 'Searching files…', Search],
    ['attach_file', 'Attaching a file…', Paperclip],
    ['web_search', 'Searching the web…', Search],
    ['web_fetch', 'Fetching a webpage…', Globe],
    ['update_memory', 'Updating memory…', FilePenLine],
  ])('maps %s to a friendly label and icon', (name, label, icon) => {
    expect(toolActivityPresentation(name)).toEqual({ label, icon })
  })

  it.each([
    ['app_list', {}, 'Checking which apps are open…', AppWindow],
    ['app_view', { app: 'TextEdit' }, 'Looking at TextEdit…', AppWindow],
    ['app_view', {}, 'Looking at an app…', AppWindow],
    ['app_click', { app: ' Safari ', element: 4 }, 'Clicking in Safari…', MousePointerClick],
    ['app_type', { app: 'Notes', text: 'hi' }, 'Typing in Notes…', Keyboard],
    ['app_key', { app: 'Notes', keys: 'cmd+s' }, 'Pressing keys in Notes…', Keyboard],
    ['app_scroll', { app: 'Safari', direction: 'down' }, 'Scrolling in Safari…', Mouse],
    ['app_drag', { app: 'Preview' }, 'Dragging in Preview…', Move],
    ['app_set_value', { app: 'Mail', element: 2, value: 'x' }, 'Filling in a field in Mail…', TextCursorInput],
    ['app_set_value', undefined, 'Filling in a field…', TextCursorInput],
  ])('names the app %s works in', (name, args, label, icon) => {
    expect(toolActivityPresentation(name, args)).toEqual({ label, icon })
  })

  it('sums up what an app tool was asked to do', () => {
    expect(isAppTool('app_click')).toBe(true)
    expect(isAppTool('bash')).toBe(false)
    expect(appToolSummary('app_click', { app: 'TextEdit', element: 12 })).toBe('TextEdit · #12')
    expect(appToolSummary('app_click', { app: 'TextEdit', x: 10.4, y: 20 })).toBe('TextEdit · 10,20')
    expect(appToolSummary('app_type', { app: 'TextEdit', text: 'hello\nworld' })).toBe('TextEdit · "hello world"')
    expect(appToolSummary('app_key', { app: 'TextEdit', keys: 'cmd+s' })).toBe('TextEdit · cmd+s')
    expect(appToolSummary('app_scroll', { app: 'Safari', element: 3, direction: 'down' })).toBe('Safari · #3 down')
    expect(appToolSummary('app_drag', { app: 'Preview', from_x: 1, from_y: 2, to_x: 30, to_y: 40 })).toBe('Preview · 1,2 → 30,40')
    expect(appToolSummary('app_set_value', { app: 'Mail', element: 2, value: 'ada@example.com' })).toBe('Mail · #2 "ada@example.com"')
    expect(appToolSummary('app_view', { app: 'TextEdit', window: 'Notes' })).toBe('TextEdit · Notes')
    expect(appToolSummary('app_view', { app: 'TextEdit' })).toBe('TextEdit')
    expect(appToolSummary('app_list', {})).toBeNull()
    expect(appToolSummary('bash', { app: 'x' })).toBeNull()
  })

  it('uses generic work presentation for unknown tools, including the removed files_* tools', () => {
    expect(toolActivityPresentation('custom_tool')).toEqual({ label: 'Working…', icon: Wrench })
    expect(toolActivityPresentation('files_write')).toEqual({ label: 'Working…', icon: Wrench })
  })

  it.each([
    ['pulpo files ls', 'Looking through your files…', FolderOpen],
    ['pulpo files tree Projects --depth 2', 'Looking through your files…', FolderOpen],
    ['pulpo files cat "Projects/Q3 Plan.md"', 'Reading Q3 Plan.md…', FileText],
    ['pulpo files grep -i budget Projects', 'Searching your files…', Search],
    ['cd /workspace && pulpo files pull Projects/Plan.md', 'Copying from Files…', FolderDown],
    ['cd /workspace/files && pulpo files push', 'Saving to Files…', FolderUp],
    ['pulpo files push report.pdf --to Reports/report.pdf', 'Saving to Files…', FolderUp],
    ['pulpo files status', 'Checking for changes…', FileDiff],
    ['pulpo files mkdir -p Projects/2026', 'Creating a folder…', FolderPlus],
    ['pulpo files mv Notes.md Archive/', 'Moving Notes.md…', FolderInput],
    ["pulpo files rm -r 'Old drafts/'", 'Moving Old drafts to the trash…', Trash2],
    ['pulpo files --help', 'Working with your files…', FolderOpen],
    ['pulpo files pull A.md && pulpo files pull B.md', 'Copying from Files…', FolderDown],
  ])('labels the bash command %s', (command, label, icon) => {
    expect(toolActivityPresentation('bash', { command })).toEqual({ label, icon })
  })

  it.each([
    ['pulpo computer ls', 'Looking through your folder…', FolderOpen],
    ['pulpo computer tree src --depth 2', 'Looking through your folder…', FolderOpen],
    ['pulpo computer cat "src/App Shell.tsx"', 'Reading App Shell.tsx…', FileText],
    ['pulpo computer cat', 'Reading a file…', FileText],
    ['pulpo computer grep -i todo src', 'Searching your folder…', Search],
    ['cd /workspace/computer && pulpo computer pull src/app.ts', 'Copying from your computer…', FolderDown],
    ['pulpo computer push src/app.ts', 'Saving to your computer…', FolderUp],
    ['pulpo computer status', 'Checking for changes…', FileDiff],
    ['pulpo computer mkdir -p docs/2026', 'Creating a folder…', FolderPlus],
    ['pulpo computer mv notes.md archive/', 'Moving notes.md…', FolderInput],
    ['pulpo computer rm -r build/', 'Moving build to the trash…', Trash2],
    ['pulpo computer --help', 'Working with your folder…', FolderOpen],
  ])('labels the computer folder command %s', (command, label, icon) => {
    expect(toolActivityPresentation('bash', { command })).toEqual({ label, icon })
  })

  it('keeps the plain shell label for PowerShell commands and for mixed CLI groups', () => {
    expect(toolActivityPresentation('powershell', { command: 'Get-ChildItem' })).toEqual({ label: 'Running PowerShell…', icon: Terminal })
    expect(toolActivityPresentation('bash', { command: 'pulpo computer pull a.md && pulpo files push a.md' })).toEqual({ label: 'Running bash…', icon: Terminal })
  })

  it('treats bash and powershell as shell tools', () => {
    expect([isShellTool('bash'), isShellTool('powershell'), isShellTool('read'), isShellTool()]).toEqual([true, true, false, false])
  })

  it.each([
    'ls /workspace/files',
    'pulpo files pull Plan.md && python3 summarize.py',
    'echo pulpo files ls',
    'pulpofiles ls',
  ])('keeps the bash label for %s', (command) => {
    expect(toolActivityPresentation('bash', { command })).toEqual({ label: 'Running bash…', icon: Terminal })
  })
})

describe('pulpoFilesCommand', () => {
  it('reads the subcommand and its first path, skipping options and their values', () => {
    expect(pulpoFilesCommand('/usr/local/bin/pulpo files push --to "My Reports/q3.pdf" ./q3.pdf')).toEqual({ subcommand: 'push', path: './q3.pdf' })
    expect(pulpoFilesCommand('cd "/workspace/my files" && pulpo files cat Notes\\ 2026.md')).toEqual({ subcommand: 'cat', path: 'Notes 2026.md' })
    expect(pulpoFilesCommand('pulpo files ls')).toEqual({ subcommand: 'ls', path: undefined })
    expect(pulpoFilesCommand('pulpo computer ls')).toBeNull()
    expect(pulpoComputerCommand('pulpo computer cat a/b.md')).toEqual({ subcommand: 'cat', path: 'a/b.md' })
  })
})
