import { describe, expect, it } from 'vitest'
import { attachmentWorkspacePath, buildAgentSystemPrompt } from './policy.js'

describe('agent policy', () => {
  it('keeps the Pulpo harness first and appends configured instructions', () => {
    const prompt = buildAgentSystemPrompt('Model policy', 'Agent policy')
    expect(prompt).toContain('/workspace')
    expect(prompt.indexOf('Model policy')).toBeLessThan(prompt.indexOf('Agent policy'))
  })

  it('creates deterministic workspace paths without traversal', () => {
    expect(attachmentWorkspacePath('../../ secret?.txt', '12345678-abcd')).toBe('/workspace/12345678-_.._secret_.txt')
    expect(attachmentWorkspacePath('...', 'abcdefgh-1234')).toBe('/workspace/abcdefgh-attachment')
  })
})
