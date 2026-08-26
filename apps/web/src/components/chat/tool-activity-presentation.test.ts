import { describe, expect, it } from 'vitest'
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
} from 'lucide-react'
import { toolActivityPresentation } from './tool-activity-presentation'

describe('toolActivityPresentation', () => {
  it.each([
    ['read', 'Reading a file…', FileText],
    ['view_image', 'Viewing an image…', Image],
    ['bash', 'Running bash…', Terminal],
    ['write', 'Writing a file…', FilePlus],
    ['edit', 'Editing a file…', FilePenLine],
    ['ls', 'Listing files…', List],
    ['find', 'Finding files…', FolderSearch],
    ['grep', 'Searching files…', Search],
    ['attach_file', 'Attaching a file…', Paperclip],
    ['web_search', 'Searching the web…', Search],
    ['web_fetch', 'Fetching a webpage…', Globe],
  ])('maps %s to a friendly label and icon', (name, label, icon) => {
    expect(toolActivityPresentation(name)).toEqual({ label, icon })
  })

  it('uses generic work presentation for unknown tools', () => {
    expect(toolActivityPresentation('custom_tool')).toEqual({ label: 'Working…', icon: Wrench })
  })
})
