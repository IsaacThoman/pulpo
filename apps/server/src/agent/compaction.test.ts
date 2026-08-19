import { describe, expect, it } from 'vitest'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import {
  agentCompactionItemId,
  agentCompactionPrompt,
  agentCycles,
  compactedAgentHandoffMessage,
  shouldCompactAgentContext,
  shouldCompactAgentStream,
  splitAgentContext,
} from './compaction.js'
import { COMPACTION_PROMPT } from '../responses/compaction.js'

function message(role: AgentMessage['role'], text: string): AgentMessage {
  return { role, content: [{ type: 'text', text }], timestamp: 1 } as AgentMessage
}

describe('agent compaction', () => {
  it('starts a new cycle on each assistant message', () => {
    expect(agentCycles([
      message('user', 'one'),
      message('assistant', 'a1'),
      message('user', 'two'),
      message('assistant', 'a2'),
      message('user', 'three'),
    ])).toEqual([
      [message('user', 'one')],
      [message('assistant', 'a1'), message('user', 'two')],
      [message('assistant', 'a2'), message('user', 'three')],
    ])
  })

  it('keeps the latest cycles verbatim and summarizes the rest', () => {
    const messages = [
      message('user', 'old'),
      message('assistant', 'old answer'),
      message('user', 'recent'),
      message('assistant', 'recent answer'),
      message('user', 'current'),
    ]
    const split = splitAgentContext(messages, 2)
    expect(split.older).toEqual([message('user', 'old')])
    expect(split.retained).toEqual([
      message('assistant', 'old answer'),
      message('user', 'recent'),
      message('assistant', 'recent answer'),
      message('user', 'current'),
    ])
  })

  it('uses the shared threshold and does not compact the first model stream', () => {
    expect(shouldCompactAgentContext({
      enabled: true, estimatedTokens: 120_000, thresholdTokens: 100_000, cycleCount: 6, retainedTurns: 4,
    })).toBe(true)
    expect(shouldCompactAgentContext({
      enabled: true, estimatedTokens: 80_000, thresholdTokens: 100_000, cycleCount: 6, retainedTurns: 4,
    })).toBe(false)
    expect(shouldCompactAgentContext({
      enabled: true, force: true, estimatedTokens: 80_000, thresholdTokens: 100_000, cycleCount: 6, retainedTurns: 4,
    })).toBe(true)
    expect(shouldCompactAgentStream(0)).toBe(false)
    expect(shouldCompactAgentStream(1)).toBe(false)
    expect(shouldCompactAgentStream(2)).toBe(true)
  })

  it('asks mid-run summaries to preserve the active task', () => {
    expect(agentCompactionPrompt('pre_response')).toBe(COMPACTION_PROMPT)
    expect(agentCompactionPrompt('agent_mid_run')).toContain('mid-run handoff')
    expect(agentCompactionPrompt('agent_mid_run')).toContain('without restarting')
    const handoff = compactedAgentHandoffMessage('Keep editing src/app.ts', 'agent_mid_run', 42)
    expect(handoff.role).toBe('user')
    expect(JSON.stringify(handoff)).toContain('Do not restart the task')
    expect(JSON.stringify(handoff)).toContain('Keep editing src/app.ts')
    expect(agentCompactionItemId('resp', 'pre_response')).toBe('resp:compaction:pre_response:0')
    expect(agentCompactionItemId('resp', 'agent_mid_run', 3)).toBe('resp:compaction:agent_mid_run:3')
  })
})
