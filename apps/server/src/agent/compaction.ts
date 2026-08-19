import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { CompactionItem } from '@pulpo/contracts'
import { COMPACTION_PROMPT } from '../responses/compaction.js'

export function agentCycles(messages: AgentMessage[]): AgentMessage[][] {
  const cycles: AgentMessage[][] = []
  let current: AgentMessage[] = []
  for (const message of messages) {
    if (message.role === 'assistant' && current.length) {
      cycles.push(current)
      current = []
    }
    current.push(message)
  }
  if (current.length) cycles.push(current)
  return cycles
}

export function shouldCompactAgentContext(options: {
  enabled: boolean
  force?: boolean
  estimatedTokens: number
  thresholdTokens: number
  cycleCount: number
  retainedTurns: number
}): boolean {
  if (!options.enabled) return false
  if (!options.force && options.estimatedTokens <= options.thresholdTokens) return false
  return options.cycleCount > options.retainedTurns
}

export function shouldCompactAgentStream(modelTurns: number): boolean {
  return modelTurns > 1
}

export function splitAgentContext(messages: AgentMessage[], retainedTurns: number): {
  cycles: AgentMessage[][]
  retained: AgentMessage[]
  older: AgentMessage[]
  retainedCycles: AgentMessage[][]
} {
  const cycles = agentCycles(messages)
  const retainedCycles = cycles.slice(-retainedTurns)
  return {
    cycles,
    retained: retainedCycles.flat(),
    older: cycles.slice(0, -retainedTurns).flat(),
    retainedCycles,
  }
}

export function agentCompactionPrompt(phase: CompactionItem['phase']): string {
  if (phase !== 'agent_mid_run') return COMPACTION_PROMPT
  return `${COMPACTION_PROMPT}

This is a mid-run handoff for the same in-progress task. Preserve active work, partial tool results, files being edited, unresolved errors, and the immediate next action so the agent can continue without restarting.`
}

export function compactedAgentHandoffMessage(
  summary: string,
  phase: CompactionItem['phase'],
  timestamp = Date.now(),
): AgentMessage {
  const text = phase === 'agent_mid_run'
    ? `[Compacted context]\nContinue the in-progress work from this handoff. Do not restart the task.\n${summary}`
    : `[Compacted context]\n${summary}`
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp,
  } as AgentMessage
}

export function agentCompactionItemId(
  responseId: string,
  phase: CompactionItem['phase'],
  beforeAgentTurn?: number,
): string {
  return `${responseId}:compaction:${phase}:${beforeAgentTurn ?? 0}`
}
