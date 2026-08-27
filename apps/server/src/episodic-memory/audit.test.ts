import { describe, expect, it } from 'vitest'
import { EPISODIC_MEMORY_AUDIT_ACTIONS, settingsAuditEvents } from './audit.js'

const defaults = {
  enabled: false,
  profile: 'embeddinggemma' as const,
  recallMode: 'balanced' as const,
}

describe('episodic-memory audit events', () => {
  it('defines every lifecycle event required for operational auditing', () => {
    expect(Object.values(EPISODIC_MEMORY_AUDIT_ACTIONS)).toEqual([
      'episodic_memory.enable',
      'episodic_memory.disable',
      'episodic_memory.model.select',
      'episodic_memory.recall_mode.update',
      'episodic_memory.model.install',
      'episodic_memory.model.activate',
      'episodic_memory.rebuild',
      'episodic_memory.cancel',
      'episodic_memory.failure',
    ])
  })

  it('records enablement, model selection, and recall-mode changes independently', () => {
    expect(settingsAuditEvents(defaults, {
      enabled: true,
      profile: 'qwen3-embedding',
      recallMode: 'eager',
    })).toEqual([
      {
        action: 'episodic_memory.enable',
        metadata: { profile: 'qwen3-embedding', recallMode: 'eager' },
      },
      {
        action: 'episodic_memory.model.select',
        metadata: { previous: 'embeddinggemma', profile: 'qwen3-embedding' },
      },
      {
        action: 'episodic_memory.recall_mode.update',
        metadata: { previous: 'balanced', recallMode: 'eager' },
      },
    ])
  })

  it('records disablement without emitting unchanged settings', () => {
    const enabled = { ...defaults, enabled: true }
    expect(settingsAuditEvents(enabled, defaults)).toEqual([{
      action: 'episodic_memory.disable',
      metadata: { profile: 'embeddinggemma', recallMode: 'balanced' },
    }])
    expect(settingsAuditEvents(defaults, defaults)).toEqual([])
  })
})
