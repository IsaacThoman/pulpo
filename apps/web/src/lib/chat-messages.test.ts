import { describe, expect, it } from 'vitest'
import { messagesFromResponses, type ChatResponseDto } from './chat-messages'

const response: ChatResponseDto = {
  id: '00000000-0000-4000-8000-000000000001',
  modelId: 'requested-model',
  displayModelId: 'actual-model',
  status: 'completed',
  input: [{ role: 'user', content: [
    { type: 'input_text', text: 'Inspect these' },
    { type: 'input_file', attachment_id: '00000000-0000-4000-8000-000000000002' },
  ] }],
  output: [
    { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Checked both files' }] },
    { type: 'pulpo_tool', id: 'tool-1', tool: 'read', arguments: { path: '/workspace/report.pdf' }, output: 'ok', status: 'completed' },
    { type: 'message', content: [{ type: 'output_text', text: 'Finished' }] },
    { type: 'pulpo_attachment', attachment_id: '00000000-0000-4000-8000-000000000003', name: 'result.csv', mime_type: 'text/csv', size_bytes: 42 },
  ],
  presetSelections: {},
  usage: { inputTokens: 12, outputTokens: 8 },
  error: null,
  createdAt: '2026-08-14T12:00:00.000Z',
  completedAt: '2026-08-14T12:00:02.000Z',
  agentMode: true,
}

describe('shared chat message projection', () => {
  it('reuses normal message fields for thoughts, activity, and both attachment origins', () => {
    const messages = messagesFromResponses([response], [
      { id: '00000000-0000-4000-8000-000000000002', originalName: 'report.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
      { id: '00000000-0000-4000-8000-000000000003', originalName: 'result.csv', mimeType: 'text/csv', sizeBytes: 42 },
    ])

    expect(messages[0]).toMatchObject({ role: 'user', content: 'Inspect these', attachments: [{ name: 'report.pdf' }] })
    expect(messages[1]).toMatchObject({
      role: 'assistant', content: 'Finished', modelId: 'actual-model', reasoning: 'Checked both files',
      attachments: [{ name: 'result.csv' }], tokensIn: 12, tokensOut: 8, latencyMs: 2000,
    })
    expect(messages[1]?.outputItems).toEqual(response.output)
  })
})
