import { describe, expect, it } from 'vitest'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { messagesForPersistence } from './context.js'

describe('persisted agent context', () => {
  it('removes image bytes while preserving the useful tool summary', () => {
    const messages: AgentMessage[] = [{
      role: 'toolResult',
      toolCallId: 'view-1',
      toolName: 'view_image',
      content: [
        { type: 'text', text: 'Viewed /tmp/chart.png (image/png, 128 bytes)' },
        { type: 'image', mimeType: 'image/png', data: 'sensitive-base64-data' },
      ],
      isError: false,
      timestamp: Date.now(),
    }]

    const persisted = messagesForPersistence(messages)

    expect(JSON.stringify(persisted)).not.toContain('sensitive-base64-data')
    expect(JSON.stringify(persisted)).toContain('Viewed /tmp/chart.png')
    expect(messages[0]).toHaveProperty('content.1.data', 'sensitive-base64-data')
  })

  it('removes directly attached image bytes and internal attachment metadata', () => {
    const messages: AgentMessage[] = [{
      role: 'user',
      content: [
        { type: 'text', text: 'Describe this.' },
        {
          type: 'image',
          mimeType: 'image/png',
          data: 'attached-base64-data',
          label: 'photo.png',
          attachmentId: 'attachment-1',
          sourceChecksum: 'checksum-1',
        },
      ],
      timestamp: Date.now(),
    } as AgentMessage]

    const persisted = messagesForPersistence(messages)

    expect(JSON.stringify(persisted)).not.toContain('attached-base64-data')
    expect(JSON.stringify(persisted)).not.toContain('attachment-1')
    expect(JSON.stringify(persisted)).not.toContain('checksum-1')
    expect(JSON.stringify(persisted)).toContain('[Image data omitted from persisted context]')
  })
})
