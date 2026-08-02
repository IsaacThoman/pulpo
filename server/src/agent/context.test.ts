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
})
