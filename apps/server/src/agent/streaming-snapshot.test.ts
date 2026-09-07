import type { ResponseSnapshot } from '@pulpo/contracts'
import { buildAgentOutput, type ToolTimelineItem } from './timeline.js'
import { describe, expect, it } from 'vitest'
import { projectNextAgentResponseEvent, selectAgentResponseCheckpoint } from './streaming-snapshot.js'

const responseId = '00000000-0000-4000-8000-000000000001'

function snapshot(overrides: Partial<ResponseSnapshot> = {}): ResponseSnapshot {
  return {
    responseId,
    status: 'in_progress',
    sequence: 0,
    output: [],
    usage: null,
    error: null,
    updatedAt: '2026-08-14T12:00:00.000Z',
    ...overrides,
  }
}

function outputText(output: unknown[]): string | undefined {
  const message = output.find((item) => (item as { type?: unknown })?.type === 'message') as {
    content?: Array<{ type?: string; text?: string }>
  } | undefined
  return message?.content?.find((part) => part.type === 'output_text')?.text
}

describe('agent streaming snapshots', () => {
  it('preserves nested image previews through completion, reload, and terminal reconstruction', () => {
    const imagePreview = { attachmentId: responseId, name: 'chart.webp', mimeType: 'image/webp', sizeBytes: 80 }
    const queued = projectNextAgentResponseEvent(snapshot(), {
      type: 'pulpo.agent.tool.queued', emittedAt: '2026-08-14T12:00:01.000Z',
      payload: { id: 'tool-1', type: 'pulpo_tool', tool: 'view_image', arguments: { path: '/tmp/chart.png' }, output: '', status: 'queued' },
    })
    const completed = projectNextAgentResponseEvent(queued.projection, {
      type: 'pulpo.agent.tool.completed', emittedAt: '2026-08-14T12:00:02.000Z',
      payload: { id: 'tool-1', output: 'Viewed chart.png', isError: false, imagePreview },
    })
    const restored = JSON.parse(JSON.stringify(completed.projection)) as ResponseSnapshot
    expect(restored.output).toEqual([expect.objectContaining({ type: 'pulpo_tool', imagePreview, status: 'completed' })])
    const item = restored.output[0] as ToolTimelineItem
    const terminal = buildAgentOutput({
      messages: [{ role: 'assistant', content: [{ type: 'toolCall', id: item.id, name: 'view_image', arguments: item.arguments }] } as never],
      skipMessageCount: 0, toolItems: new Map([[item.id, item]]), terminal: true,
    })
    expect(selectAgentResponseCheckpoint(restored, { terminal: true, output: terminal }).output).toEqual(restored.output)
    expect(terminal).toHaveLength(1)
  })

  it('checkpoints only text represented by its event sequence', () => {
    const mutableUpstreamMessage = { text: 'Sp' }
    const first = projectNextAgentResponseEvent(snapshot(), {
      type: 'response.output_text.delta',
      payload: { delta: 'Sp', item_id: 'agent:1:0:message', content_index: 0 },
      emittedAt: '2026-08-14T12:00:01.000Z',
    })

    mutableUpstreamMessage.text = 'Spaghetti'
    const firstCheckpoint = selectAgentResponseCheckpoint(first.projection)
    expect(firstCheckpoint.sequence).toBe(1)
    expect(outputText(firstCheckpoint.output)).toBe('Sp')

    const second = projectNextAgentResponseEvent(first.projection, {
      type: 'response.output_text.delta',
      payload: { delta: 'aghetti', item_id: 'agent:1:0:message', content_index: 0 },
      emittedAt: '2026-08-14T12:00:02.000Z',
    })
    const secondCheckpoint = selectAgentResponseCheckpoint(second.projection)
    expect(secondCheckpoint.sequence).toBe(2)
    expect(outputText(secondCheckpoint.output)).toBe('Spaghetti')
    expect(outputText(secondCheckpoint.output)).not.toBe('Spaghettiaghetti')
  })

  it('continues a resumed projection from its persisted sequence and output', () => {
    const resumed = snapshot({
      sequence: 7,
      output: [{
        id: 'agent:1:0:message',
        type: 'message',
        role: 'assistant',
        status: 'in_progress',
        content: [{ type: 'output_text', text: 'Spa' }],
      }],
    })
    const next = projectNextAgentResponseEvent(resumed, {
      type: 'response.output_text.delta',
      payload: { delta: 'ghetti', item_id: 'agent:1:0:message', content_index: 0 },
      emittedAt: '2026-08-14T12:00:08.000Z',
    })

    expect(next.event.sequence).toBe(8)
    expect(next.projection.sequence).toBe(8)
    expect(outputText(next.projection.output)).toBe('Spaghetti')
  })

  it('uses stable terminal output without changing the emitted sequence', () => {
    const partial = projectNextAgentResponseEvent(snapshot(), {
      type: 'response.output_text.delta',
      payload: { delta: 'Spag', item_id: 'agent:1:0:message', content_index: 0 },
      emittedAt: '2026-08-14T12:00:01.000Z',
    }).projection
    const terminalOutput = [{
      id: 'agent:1:0:message',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: 'Spaghetti' }],
    }]

    const checkpoint = selectAgentResponseCheckpoint(partial, { terminal: true, output: terminalOutput })
    expect(checkpoint.sequence).toBe(1)
    expect(checkpoint.output).toBe(terminalOutput)
    expect(outputText(checkpoint.output)).toBe('Spaghetti')
  })

  it('isolates projected event payloads from later runtime mutation', () => {
    const tool = { id: 'tool-1', type: 'pulpo_tool', status: 'queued', output: '' }
    const projected = projectNextAgentResponseEvent(snapshot(), {
      type: 'pulpo.agent.tool.queued',
      payload: tool,
      emittedAt: '2026-08-14T12:00:01.000Z',
    }).projection

    tool.status = 'running'
    tool.output = 'future output'

    expect(projected.output).toEqual([{ id: 'tool-1', type: 'pulpo_tool', status: 'queued', output: '' }])
  })
})
