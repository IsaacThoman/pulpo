import { describe, expect, it, vi } from 'vitest';
import { toolActivityPresentation } from './toolActivityPresentation';

const icons = vi.hoisted(() => ({
  FileDiff: Symbol('FileDiff'),
  FolderDown: Symbol('FolderDown'),
  FolderInput: Symbol('FolderInput'),
  FolderUp: Symbol('FolderUp'),
  Trash2: Symbol('Trash2'),
  FilePenLine: Symbol('FilePenLine'),
  FilePlus: Symbol('FilePlus'),
  FileText: Symbol('FileText'),
  FolderOpen: Symbol('FolderOpen'),
  FolderPlus: Symbol('FolderPlus'),
  FolderSearch: Symbol('FolderSearch'),
  Globe: Symbol('Globe'),
  Image: Symbol('Image'),
  List: Symbol('List'),
  Paperclip: Symbol('Paperclip'),
  Search: Symbol('Search'),
  Terminal: Symbol('Terminal'),
  Wrench: Symbol('Wrench'),
}));

vi.mock('lucide-react-native', () => icons);

describe('toolActivityPresentation', () => {
  it.each([
    ['read', 'Reading a file…', icons.FileText],
    ['view_image', 'Viewing an image…', icons.Image],
    ['generate_image', 'Generating an image…', icons.Image],
    ['bash', 'Running bash…', icons.Terminal],
    ['write', 'Writing a file…', icons.FilePlus],
    ['edit', 'Editing a file…', icons.FilePenLine],
    ['ls', 'Listing files…', icons.List],
    ['find', 'Finding files…', icons.FolderSearch],
    ['grep', 'Searching files…', icons.Search],
    ['attach_file', 'Attaching a file…', icons.Paperclip],
    ['web_search', 'Searching the web…', icons.Search],
    ['web_fetch', 'Fetching a webpage…', icons.Globe],
    ['update_memory', 'Updating memory…', icons.FilePenLine],
    ['files_list', 'Looking through your files…', icons.FolderOpen],
    ['files_read', 'Reading a document…', icons.FileText],
    ['files_write', 'Writing a document…', icons.FilePlus],
    ['files_edit', 'Editing a document…', icons.FilePenLine],
    ['files_create_folder', 'Creating a folder…', icons.FolderPlus],
  ])('maps %s to a friendly label and icon', (name, label, icon) => {
    expect(toolActivityPresentation(name)).toEqual({ label, icon });
  });

  it('uses generic work presentation for unknown tools', () => {
    expect(toolActivityPresentation('custom_tool')).toEqual({ label: 'Working…', icon: icons.Wrench });
  });

  it('labels the agent\'s pulpo files commands like the web does', () => {
    expect(toolActivityPresentation('bash', { command: 'pulpo files cat "Projects/Plan.md"' })).toEqual({ icon: icons.FileText, label: 'Reading Plan.md…' })
    expect(toolActivityPresentation('bash', { command: 'cd /workspace && pulpo files push --to Notes notes.md' })).toEqual({ icon: icons.FolderUp, label: 'Saving to Files…' })
    expect(toolActivityPresentation('bash', { command: 'pulpo files rm Old/' })).toEqual({ icon: icons.Trash2, label: 'Moving Old to the trash…' })
    // Anything besides `pulpo files` keeps the bash label.
    expect(toolActivityPresentation('bash', { command: 'pulpo files ls && rm -rf /tmp/x' }).label).toBe('Running bash…')
    expect(toolActivityPresentation('bash', { command: 'ls -la' }).label).toBe('Running bash…')
  });
});
