// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Markdown } from '@tiptap/markdown'
import { NoteAttachment } from './NoteAttachment'
import { NoteLinkPreview } from './NoteLinkPreview'
import { NoteUnderline } from './NoteUnderline'

const extensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] }, underline: false }),
  NoteUnderline,
  TableKit,
  TaskList,
  TaskItem.configure({ nested: true }),
  NoteAttachment,
  NoteLinkPreview,
  Markdown.configure({ markedOptions: { gfm: true } }),
]

describe('notes Markdown round trips', () => {
  it('preserves core, GFM table/task, underline, and code content', () => {
    const source = '# Heading\n\n**bold** _italic_ ~~strike~~ <u>under</u> `inline`\n\n> quote\n\n- item\n- [x] task\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst value = 1\n```\n\n---'
    const first = new Editor({ element: document.createElement('div'), extensions, content: source, contentType: 'markdown' })
    const markdown = first.getMarkdown()
    const second = new Editor({ element: document.createElement('div'), extensions, content: markdown, contentType: 'markdown' })
    expect(second.getText()).toContain('Heading')
    expect(second.isActive('underline')).toBe(false)
    expect(second.getJSON().content?.some((node) => node.type === 'table')).toBe(true)
    expect(second.getJSON().content?.some((node) => node.type === 'taskList')).toBe(true)
    expect(second.getJSON().content?.some((node) => node.type === 'codeBlock')).toBe(true)
    expect(markdown).toContain('<u>under</u>')
    first.destroy(); second.destroy()
  })

  it('preserves authenticated media references and passive preview metadata', () => {
    const first = new Editor({ element: document.createElement('div'), extensions, content: {
      type: 'doc', content: [
        { type: 'noteAttachment', attrs: { attachmentId: 'asset-id', name: 'map & "plan".png', mimeType: 'image/png', sizeBytes: 42, kind: 'image' } },
        { type: 'noteLinkPreview', attrs: { url: 'https://example.com/a?x=1', title: 'Example title', description: 'Summary', siteName: 'example.com' } },
      ],
    } })
    const markdown = first.getMarkdown()
    const second = new Editor({ element: document.createElement('div'), extensions, content: markdown, contentType: 'markdown' })
    const content = second.getJSON().content ?? []
    expect(content[0]).toMatchObject({ type: 'noteAttachment', attrs: { attachmentId: 'asset-id', name: 'map & "plan".png', kind: 'image' } })
    expect(content[1]).toMatchObject({ type: 'noteLinkPreview', attrs: { url: 'https://example.com/a?x=1', title: 'Example title' } })
    first.destroy(); second.destroy()
  })
})
