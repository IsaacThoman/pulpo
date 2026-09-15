import { expect, it } from 'vitest'
import { workspaceAttachmentIds } from './workspace-attachments.js'

const input = (id: string) => [{ role: 'user', content: [{ type: 'input_file', attachment_id: id }] }]
const output = (id: string) => [{ type: 'pulpo_attachment', attachment_id: id }]
const turns = [
  { id: 'parent', parentResponseId: null, input: input('upload'), output: output('saved-parent-file') },
  { id: 'original', parentResponseId: 'parent', input: input('original-upload'), output: output('original-result') },
  { id: 'regenerate', parentResponseId: 'parent', input: input('original-upload'), output: [] },
  { id: 'edit', parentResponseId: 'parent', input: input('replacement-upload'), output: output('edited-result') },
  { id: 'follow-up', parentResponseId: 'edit', input: input('next-upload'), output: [] },
]

it('restores uploads and attached deliverables only from the active branch', () => {
  expect(workspaceAttachmentIds(turns, 'follow-up')).toEqual(['upload', 'saved-parent-file', 'replacement-upload', 'edited-result', 'next-upload'])
})

it('regenerates with the same input files but none of the replaced answer’s files', () => {
  expect(workspaceAttachmentIds(turns, 'regenerate')).toEqual(['upload', 'saved-parent-file', 'original-upload'])
})

it('retains explicitly reattached files and current-response deliverables during recovery', () => {
  expect(workspaceAttachmentIds([...turns, {
    id: 'reattach', parentResponseId: 'regenerate', input: input('original-result'),
    output: [...output('current-result'), { type: 'pulpo_tool', output: { attachment_id: 'preview' } }, null],
  }], 'reattach')).toEqual(['upload', 'saved-parent-file', 'original-upload', 'original-result', 'current-result'])
})
