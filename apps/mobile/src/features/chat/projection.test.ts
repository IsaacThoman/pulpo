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
  modelId?: string
  displayModelId?: string
}): ServerResponse {
  const output = [{ type: 'message', content: [{ type: 'output_text', text: input.output }] }]
  return {
    id: input.id,
    parentResponseId: null,
    previousResponseId: null,
    userMessageId: 'user-1',
    modelId: input.modelId ?? 'model-1',
    displayModelId: input.displayModelId,
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
  it('projects persisted recalled-chat activity and raw source metadata', () => {
    const serverResponse = response({
      id: 'response-recall', text: 'What did we decide?', output: 'We chose a parallel rebuild.',
      branchIds: ['response-recall'], branchIndex: 0,
    })
    const recall = {
      id: 'response-recall:recall', type: 'pulpo_recall', status: 'completed',
      sources: [{
        chat_id: '00000000-0000-4000-8000-000000000001',
        response_id: '00000000-0000-4000-8000-000000000002',
        title: 'Earlier architecture chat', updated_at: '2026-08-27T00:00:00.000Z',
        excerpt: 'Use a parallel index generation during model changes.',
      }],
    }
    serverResponse.output = [recall, ...serverResponse.output]
    serverResponse.snapshot = { ...serverResponse.snapshot, output: serverResponse.output }
    const chat = {
      id: 'chat-1', title: 'Recall', modelId: 'model-1', pinned: false, folderId: null,
      sortOrder: 0, temporary: false, activeResponseId: serverResponse.id, activeBranchLeafId: serverResponse.id,
      createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:01.000Z', responses: [serverResponse],
    } satisfies ServerChat

    const assistant = projectChat(chat, {}).find((message) => message.role === 'assistant')
    expect(assistant?.activity).toMatchObject([{
      kind: 'recall', title: 'Recalled from 1 chat', detail: expect.stringContaining('Earlier architecture chat'),
    }])
    expect(assistant?.outputItems[0]).toEqual(recall)
  })

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
    expect(assistant?.latencyMs).toBe(1_000)
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

  it('does not let an equal-version empty cached snapshot hide a fetched branch body', () => {
    const branchIds = ['response-a', 'response-b']
    const responses = [
      response({ id: branchIds[0]!, text: 'Prompt', output: 'First generation', branchIds, branchIndex: 0 }),
      response({ id: branchIds[1]!, text: 'Prompt', output: 'Fetched second generation', branchIds, branchIndex: 1 }),
    ]
    const fetched = responses[1]!
    fetched.detailAvailable = true
    fetched.snapshot = {
      responseId: fetched.id,
      sequence: 1,
      status: 'completed',
      output: fetched.output,
      usage: null,
      error: null,
      updatedAt: fetched.createdAt,
    }
    const live = {
      [fetched.id]: {
        ...fetched.snapshot,
        output: [],
      } as ResponseSnapshot,
    }
    const chat = {
      id: 'chat-1', title: 'Branches', modelId: 'model-1', pinned: false, folderId: null,
      sortOrder: 0, temporary: false, activeResponseId: fetched.id, activeBranchLeafId: fetched.id,
      createdAt: '2026-08-04T12:00:00.000Z', updatedAt: '2026-08-04T12:00:01.000Z', responses,
    } satisfies ServerChat

    const assistant = projectChat(chat, live).find((message) => message.role === 'assistant')

    expect(assistant?.text).toBe('Fetched second generation')
    expect(assistant?.branch.index).toBe(1)
    expect(assistant?.branch.variants[1]?.text).toBe('Fetched second generation')
  })

  it('preserves the producing model for every regeneration branch', () => {
    const branchIds = ['response-a', 'response-b']
    const responses = [
      response({ id: branchIds[0]!, text: 'Prompt', output: 'First', branchIds, branchIndex: 0, displayModelId: 'actual-a' }),
      response({ id: branchIds[1]!, text: 'Prompt', output: 'Second', branchIds, branchIndex: 1, displayModelId: 'actual-b' }),
    ]
    const chat = {
      id: 'chat-1', title: 'Branches', modelId: 'composer-model', pinned: false, folderId: null,
      sortOrder: 0, temporary: false, activeResponseId: 'response-b', activeBranchLeafId: 'response-b',
      createdAt: '2026-08-04T12:00:00.000Z', updatedAt: '2026-08-04T12:00:01.000Z', responses,
    } satisfies ServerChat

    const assistant = projectChat(chat, {}).find((message) => message.role === 'assistant')

    expect(assistant?.modelId).toBe('actual-b')
    expect(assistant?.branch.variants.map((branch) => branch.modelId)).toEqual(['actual-a', 'actual-b'])
  })
})
