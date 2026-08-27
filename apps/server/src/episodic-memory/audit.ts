import type { EpisodicMemorySettings } from '@pulpo/contracts'

export const EPISODIC_MEMORY_AUDIT_ACTIONS = {
  enable: 'episodic_memory.enable',
  disable: 'episodic_memory.disable',
  modelSelect: 'episodic_memory.model.select',
  recallModeUpdate: 'episodic_memory.recall_mode.update',
  modelInstall: 'episodic_memory.model.install',
  modelActivate: 'episodic_memory.model.activate',
  rebuild: 'episodic_memory.rebuild',
  cancel: 'episodic_memory.cancel',
  failure: 'episodic_memory.failure',
} as const

export interface EpisodicMemoryAuditEvent {
  action: typeof EPISODIC_MEMORY_AUDIT_ACTIONS[keyof typeof EPISODIC_MEMORY_AUDIT_ACTIONS]
  metadata: Record<string, unknown>
}

export function settingsAuditEvents(
  previous: EpisodicMemorySettings,
  next: EpisodicMemorySettings,
): EpisodicMemoryAuditEvent[] {
  const events: EpisodicMemoryAuditEvent[] = []
  if (previous.enabled !== next.enabled) events.push({
    action: next.enabled ? EPISODIC_MEMORY_AUDIT_ACTIONS.enable : EPISODIC_MEMORY_AUDIT_ACTIONS.disable,
    metadata: { profile: next.profile, recallMode: next.recallMode },
  })
  if (previous.profile !== next.profile) events.push({
    action: EPISODIC_MEMORY_AUDIT_ACTIONS.modelSelect,
    metadata: { previous: previous.profile, profile: next.profile },
  })
  if (previous.recallMode !== next.recallMode) events.push({
    action: EPISODIC_MEMORY_AUDIT_ACTIONS.recallModeUpdate,
    metadata: { previous: previous.recallMode, recallMode: next.recallMode },
  })
  return events
}
