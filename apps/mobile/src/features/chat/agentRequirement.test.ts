import { describe, expect, it } from 'vitest'
import { agentModeRestriction } from './agentRequirement'

const ready = { attachmentsNeedAgent: false, hasFileReferences: false, agentEnabled: true, agentAvailable: true, modelAgentCapable: true }

describe('agentModeRestriction', () => {
  it('allows drafts that need nothing from the agent, whatever Agent mode is', () => {
    expect(agentModeRestriction({ ...ready, agentEnabled: false, agentAvailable: false, modelAgentCapable: false })).toBeNull()
  })

  it('allows attachments and Files items once Agent mode is on', () => {
    expect(agentModeRestriction({ ...ready, attachmentsNeedAgent: true, hasFileReferences: true })).toBeNull()
  })

  it('asks for Agent mode when a draft mentions Files items with it off', () => {
    expect(agentModeRestriction({ ...ready, hasFileReferences: true, agentEnabled: false }))
      .toEqual({ state: 'enable_agent', message: 'Files items require Agent mode.' })
  })

  it('says to switch models or remove Files items when the model has no Agent mode', () => {
    expect(agentModeRestriction({ ...ready, hasFileReferences: true, modelAgentCapable: false }))
      .toEqual({ state: 'model_not_capable', message: 'Switch to an Agent-capable model or remove the Files items.' })
  })

  it('says to remove Files items when the instance has no Agent mode', () => {
    expect(agentModeRestriction({ ...ready, hasFileReferences: true, agentAvailable: false, modelAgentCapable: false }))
      .toEqual({ state: 'agent_unavailable', message: 'Agent mode is unavailable. Remove the Files items to send.' })
  })

  it('keeps the attachment copy when attachments need the agent too', () => {
    expect(agentModeRestriction({ ...ready, attachmentsNeedAgent: true, hasFileReferences: true, agentEnabled: false }))
      .toEqual({ state: 'enable_agent', message: 'Turn on Agent mode to use these attachments (file type, image count, or image size).' })
    expect(agentModeRestriction({ ...ready, attachmentsNeedAgent: true, modelAgentCapable: false }))
      .toEqual({ state: 'model_not_capable', message: 'Choose an Agent-capable model or reduce these attachments.' })
    expect(agentModeRestriction({ ...ready, attachmentsNeedAgent: true, agentAvailable: false }))
      .toEqual({ state: 'agent_unavailable', message: 'Choose an Agent-capable model or reduce these attachments.' })
  })
})
