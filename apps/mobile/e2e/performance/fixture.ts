import type { ServerChat, ServerResponse } from '../../src/types'

export function fixture(turns: number, chars = 256, chatId = 'benchmark'): ServerChat {
  const responses: ServerResponse[] = Array.from({ length: turns }, (_, index) => {
    const id = `${chatId}-response-${index}`
    const output = [{ type: 'message', content: [{ type: 'output_text', text: 'x'.repeat(chars) }] }]
    return {
      id, parentResponseId: index ? `${chatId}-response-${index - 1}` : null,
      previousResponseId: index ? `${chatId}-response-${index - 1}` : null,
      userMessageId: `${id}-user`, modelId: 'fixture', status: 'completed',
      input: [{ role: 'user', content: 'Synthetic performance question' }], output,
      presetSelections: {}, agentMode: false, usage: null, error: null,
      createdAt: '2026-09-06T00:00:00.000Z', completedAt: '2026-09-06T00:00:01.000Z',
      snapshot: { responseId: id, sequence: 1, status: 'completed', output, updatedAt: '2026-09-06T00:00:01.000Z' },
      branches: { user: { ids: [id], index: 0 }, assistant: { ids: [id], index: 0 } },
    } as ServerResponse
  })
  return {
    id: chatId, title: 'Synthetic benchmark', modelId: 'fixture', pinned: false, folderId: null,
    sortOrder: 0, temporary: false, activeResponseId: responses.at(-1)?.id ?? null,
    activeBranchLeafId: responses.at(-1)?.id ?? null,
    createdAt: '2026-09-06T00:00:00.000Z', updatedAt: '2026-09-06T00:00:01.000Z', responses,
  }
}
