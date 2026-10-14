import { describe, expect, it } from 'vitest'
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
} from 'lucide-react'
import { pulpoFilesCommand, toolActivityPresentation } from './tool-activity-presentation'

describe('toolActivityPresentation', () => {
  it.each([
    ['read', 'Reading a file…', FileText],
    ['view_image', 'Viewing an image…', Image],
    ['generate_image', 'Generating an image…', Image],
    ['bash', 'Running bash…', Terminal],
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
  })
})
