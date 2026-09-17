import { expect, it } from 'vitest'
import { workspaceAttachments } from './workspace-attachments.js'
import { attachmentWorkspacePath } from './policy.js'

const file = (id: string, sourceResponseId: string | null = null, origin = 'user', workspacePath: string | null = null) => ({ id, sourceResponseId, origin, workspacePath, originalName: `${id}.txt` })
const input = (...ids: string[]) => [{ role: 'user', content: ids.map(id => ({ type: 'input_file', attachment_id: id })) }]

it('restores only lineage inputs and assistant deliverables, excluding other branches and incidental previews', () => {
  const files = [file('upload'), file('removed'), file('ancestor', 'a', 'assistant'), file('other', 'b', 'assistant'), file('preview', 'a', 'tool_preview'), file('current', 'c', 'assistant')]
  expect(workspaceAttachments([{ id: 'a', input: input('upload') }, { id: 'c', input: [] }], files).map(f => f.id)).toEqual(['ancestor', 'current', 'upload'])
})

it('uses conversation order for colliding deliverables and supplies explicit attachment aliases', () => {
  const files = [file('new', 'c', 'assistant', '/workspace/report.txt'), file('old', 'a', 'assistant', '/workspace/report.txt'), file('preview', 'b', 'tool_preview')]
  const result = workspaceAttachments([{ id: 'a', input: [] }, { id: 'c', input: input('old', 'preview') }], files)
  expect(result.map(f => [f.id, f.path])).toEqual([
    ['new', '/workspace/report.txt'], ['old', attachmentWorkspacePath('old.txt', 'old')], ['preview', attachmentWorkspacePath('preview.txt', 'preview')],
  ])
})
