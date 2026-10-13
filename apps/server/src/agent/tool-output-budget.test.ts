import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { describe, expect, it } from 'vitest'
import { boundToolOutputContent, boundToolResultMessages, TOOL_OUTPUT_MAX_BYTES, truncateMiddleUtf8 } from './tool-output-budget.js'

const text = (value: string) => ({ type: 'text' as const, text: value })
const image = { type: 'image' as const, data: 'AAAA', mimeType: 'image/png' }
const largeOutput = (bytes: number) => Array.from({ length: Math.ceil(bytes / 10) }, (_, index) => `line ${String(index).padStart(4, '0')}`).join('\n').slice(0, bytes)
const bytesOf = (value: string) => Buffer.byteLength(value, 'utf8')
const toolResult = (toolName: string, output: string, details: unknown = {}): AgentMessage => ({
  role: 'toolResult',
  toolCallId: `call-${toolName}`,
  toolName,
  content: [text(output)],
  details,
  isError: false,
  timestamp: 1,
} as AgentMessage)

describe('tool output budget', () => {
  it('leaves output within the budget unchanged', () => {
    expect(boundToolOutputContent('bash', [text('hello')])).toBeUndefined()
    expect(boundToolOutputContent('bash', [text('x'.repeat(TOOL_OUTPUT_MAX_BYTES))])).toBeUndefined()
  })

  it('keeps the beginning and end of oversized output within the byte budget', () => {
    const output = `FIRST LINE\n${largeOutput(1_000_000)}\nLAST LINE`
    const [bounded] = boundToolOutputContent('bash', [text(output)])! as [{ type: 'text'; text: string }]

    expect(bytesOf(bounded.text)).toBeLessThanOrEqual(TOOL_OUTPUT_MAX_BYTES)
    expect(bounded.text).toMatch(/^Warning: truncated output \(original token count: 250,006, total output lines: 91,821\)/)
    expect(bounded.text).toContain('FIRST LINE')
    expect(bounded.text.endsWith('LAST LINE')).toBe(true)
    expect(bounded.text).toMatch(/…[\d,]+ tokens truncated…/)
  })

  it('points the model at the saved full output when the workspace provides one', () => {
    const [bounded] = boundToolOutputContent('bash', [text(largeOutput(200_000))], {
      exitCode: 0,
      fullOutputPath: '/tmp/pulpo-tool-output/abc.txt',
      fullOutputBytes: 200_000,
      fullOutputComplete: true,
    })! as [{ type: 'text'; text: string }]

    expect(bounded.text).toContain('Full output saved to /tmp/pulpo-tool-output/abc.txt; inspect it with read (offset/limit) or grep')
    expect(bounded.text).not.toContain('capture limit')
  })

  it('notes when the saved file stopped at the capture limit', () => {
    const [bounded] = boundToolOutputContent('bash', [text(largeOutput(200_000))], {
      fullOutputPath: '/tmp/pulpo-tool-output/abc.txt',
      fullOutputComplete: false,
    })! as [{ type: 'text'; text: string }]

    expect(bounded.text).toContain('The saved file stops at the workspace capture limit.')
  })

  it('suggests redirecting to a file when an older workspace saved nothing', () => {
    const [bounded] = boundToolOutputContent('grep', [text(largeOutput(200_000))])! as [{ type: 'text'; text: string }]
    expect(bounded.text).toContain('rerun the command with output redirected to a file')

    const [web] = boundToolOutputContent('web_fetch', [text(largeOutput(200_000))])! as [{ type: 'text'; text: string }]
    expect(web.text).not.toContain('rerun the command')
  })

  it('does not truncate read, which pages its own output', () => {
    expect(boundToolOutputContent('read', [text(largeOutput(51_200))])).toBeUndefined()
  })

  it('combines text parts and keeps images in place', () => {
    const content = [text(largeOutput(30_000)), image, text(largeOutput(30_000))]
    const bounded = boundToolOutputContent('view_image', content)!

    expect(bounded).toHaveLength(2)
    expect(bounded[0]!.type).toBe('text')
    expect(bounded[1]).toBe(image)
  })

  it('never splits multi-byte characters', () => {
    const truncated = truncateMiddleUtf8('🙂'.repeat(10_000), 1_001)
    expect(bytesOf(truncated)).toBeLessThanOrEqual(1_001)
    expect(truncated).not.toContain('�')
    expect(truncated.startsWith('🙂')).toBe(true)
    expect(truncated.endsWith('🙂')).toBe(true)
  })

  it('bounds saved tool results without changing the message count', () => {
    const user: AgentMessage = { role: 'user', content: largeOutput(200_000), timestamp: 1 } as AgentMessage
    const small = toolResult('ls', 'a.txt')
    const large = toolResult('bash', largeOutput(1_000_000), { exitCode: 0 })
    const read = toolResult('read', largeOutput(51_200))

    const bounded = boundToolResultMessages([user, small, large, read])

    expect(bounded).toHaveLength(4)
    expect(bounded[0]).toBe(user)
    expect(bounded[1]).toBe(small)
    expect(bounded[3]).toBe(read)
    const [boundedText] = (bounded[2] as Extract<AgentMessage, { role: 'toolResult' }>).content as [{ type: 'text'; text: string }]
    expect(bytesOf(boundedText.text)).toBeLessThanOrEqual(TOOL_OUTPUT_MAX_BYTES)
    expect(boundToolResultMessages(bounded)[2]).toBe(bounded[2])
  })
})
