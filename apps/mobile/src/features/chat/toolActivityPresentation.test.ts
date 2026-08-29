import { describe, expect, it, vi } from 'vitest';
import { toolActivityPresentation } from './toolActivityPresentation';

const icons = vi.hoisted(() => ({
  FilePenLine: Symbol('FilePenLine'),
  FilePlus: Symbol('FilePlus'),
  FileText: Symbol('FileText'),
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
  ])('maps %s to a friendly label and icon', (name, label, icon) => {
    expect(toolActivityPresentation(name)).toEqual({ label, icon });
  });

  it('uses generic work presentation for unknown tools', () => {
    expect(toolActivityPresentation('custom_tool')).toEqual({ label: 'Working…', icon: icons.Wrench });
  });
});
