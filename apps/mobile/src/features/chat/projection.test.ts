import { describe, expect, it } from 'vitest'
import type { ResponseSnapshot } from '@pulpo/contracts'
import type { ServerChat, ServerResponse } from '../../types'
import { projectChat } from './projection'

function response(input: {
  id: string
  text: string
  output: string
  branchIds: string[]
  branchIndex: number
}): ServerResponse {
  const output = [{ type: 'message', content: [{ type: 'output_text', text: input.output }] }]
  return {
    id: input.id,
    parentResponseId: null,
    previousResponseId: null,
    userMessageId: 'user-1',
    modelId: 'model-1',
    status: 'completed',
    input: [{ role: 'user', content: input.text }],
    output,
    presetSelections: {},
    agentMode: false,
    usage: null,
    error: null,
    createdAt: '2026-08-04T12:00:00.000Z',
    completedAt: '2026-08-04T12:00:01.000Z',
    snapshot: { responseId: input.id, sequence: 1, status: 'completed', output } as ResponseSnapshot,
    branches: {
      user: { ids: [input.id], index: 0 },
      assistant: { ids: input.branchIds, index: input.branchIndex },
    },
  }
}

describe('projectChat branch variants', () => {
  it('retains each regenerated assistant branch body', () => {
    const branchIds = ['response-a', 'response-b']
    const responses = [
      response({ id: branchIds[0]!, text: 'Prompt', output: 'First generation', branchIds, branchIndex: 0 }),
      response({ id: branchIds[1]!, text: 'Prompt', output: 'Second generation', branchIds, branchIndex: 1 }),
    ]
    const chat = {
      id: 'chat-1',
      title: 'Branches',
      modelId: 'model-1',
      pinned: false,
      folderId: null,
      sortOrder: 0,
      temporary: false,
      activeResponseId: branchIds[1],
      activeBranchLeafId: branchIds[1],
      createdAt: '2026-08-04T12:00:00.000Z',
      updatedAt: '2026-08-04T12:00:01.000Z',
      responses,
    } satisfies ServerChat

    const projected = projectChat(chat, {})
    const assistant = projected.find((message) => message.role === 'assistant')

    expect(assistant?.text).toBe('Second generation')
    expect(assistant?.branch.index).toBe(1)
    expect(assistant?.branch.variants.map((branch) => branch.text)).toEqual([
      'First generation',
      'Second generation',
    ])
  })

  it('projects a newer live snapshot into its matching branch only', () => {
    const branchIds = ['response-a', 'response-b']
    const responses = [
      response({ id: branchIds[0]!, text: 'Prompt', output: 'First generation', branchIds, branchIndex: 0 }),
      response({ id: branchIds[1]!, text: 'Prompt', output: 'Old second generation', branchIds, branchIndex: 1 }),
    ]
    const liveOutput = [{ type: 'message', content: [{ type: 'output_text', text: 'Streaming second generation' }] }]
    const live = {
      'response-b': {
        responseId: 'response-b',
        sequence: 2,
        status: 'in_progress',
        output: liveOutput,
      } as ResponseSnapshot,
    }
    const chat = {
      id: 'chat-1', title: 'Branches', modelId: 'model-1', pinned: false, folderId: null,
      sortOrder: 0, temporary: false, activeResponseId: 'response-b', activeBranchLeafId: 'response-b',
      createdAt: '2026-08-04T12:00:00.000Z', updatedAt: '2026-08-04T12:00:01.000Z', responses,
    } satisfies ServerChat

    const assistant = projectChat(chat, live).find((message) => message.role === 'assistant')

    expect(assistant?.text).toBe('Streaming second generation')
    expect(assistant?.branch.variants.map((branch) => branch.text)).toEqual([
      'First generation',
      'Streaming second generation',
    ])
  })
})
