import { describe, expect, it } from 'vitest'
import { sanitizeContextForStorage, sanitizeOutputForClient } from './public-output.js'

describe('response public output sanitization', () => {
  it('removes agent image bytes without mutating the source', () => {
    const data = 'a'.repeat(2_000_000)
    const source = [{ role: 'toolResult', content: [
      { type: 'text', text: 'Viewed /workspace/photo.png' },
      { type: 'image', data, mimeType: 'image/png' },
    ] }]

    const sanitized = sanitizeContextForStorage(source)

    expect(JSON.stringify(sanitized)).not.toContain(data)
    expect(JSON.stringify(sanitized)).toContain('Image data omitted')
    expect(source[0]!.content[1]).toMatchObject({ type: 'image', data })
  })

  it('removes embedded image data urls from recognized image input parts', () => {
    const output = sanitizeContextForStorage([{ type: 'input_image', image_url: 'data:image/jpeg;base64,AAAA' }])
    expect(output).toEqual([{ type: 'input_text', text: '[Image data omitted from persisted context]' }])
  })

  it('keeps display-safe compaction fields but withholds raw retained context', () => {
    const source = [{
      id: 'compact-1', type: 'pulpo_compaction', phase: 'agent_mid_run', status: 'completed',
      model_id: 'model-1', estimated_tokens: 100, threshold_tokens: 50,
      retained_turns: [{ role: 'tool', content: 'web_search: result' }],
      retained_context: [{ role: 'toolResult', content: [{ type: 'image', data: 'secret', mimeType: 'image/png' }] }],
      retained_context_turns: [[{ role: 'assistant', content: 'hidden' }]],
      summary: 'Useful summary', started_at: new Date(0).toISOString(), duration_ms: 12,
    }]

    const sanitized = sanitizeOutputForClient(source) as Array<Record<string, unknown>>

    expect(sanitized[0]).toMatchObject({
      summary: 'Useful summary',
      retained_turns: [{ role: 'tool', content: 'web_search: result' }],
      retained_context: [],
      retained_context_turns: [],
    })
    expect(JSON.stringify(sanitized)).not.toContain('secret')
    expect(source[0]!.retained_context).toHaveLength(1)
  })

  it('handles circular diagnostic values defensively', () => {
    const circular: Record<string, unknown> = { type: 'diagnostic' }
    circular.self = circular
    expect(sanitizeContextForStorage(circular)).toEqual({ type: 'diagnostic', self: '[Circular context omitted]' })
  })
})
