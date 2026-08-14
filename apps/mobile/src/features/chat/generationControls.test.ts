import { describe, expect, it } from 'vitest'
import { composerGenerationAction, selectedAssistantStatus, selectedInFlightResponseId } from './generationControls'

describe('generation controls', () => {
  it('submits a message edit while the selected branch is generating', () => {
    expect(composerGenerationAction('thinking', true)).toBe('submit')
    expect(composerGenerationAction('streaming', true)).toBe('submit')
  })

  it('keeps stop behavior for a normal composer during generation', () => {
    expect(composerGenerationAction('thinking', false)).toBe('stop')
    expect(composerGenerationAction('streaming', false)).toBe('stop')
    expect(composerGenerationAction('idle', false)).toBe('submit')
  })

  it('targets and reports the selected in-flight response', () => {
    const messages = [
      { id: 'complete', role: 'assistant' as const, status: 'complete' as const },
      { id: 'running', role: 'assistant' as const, status: 'streaming' as const },
    ]
    expect(selectedInFlightResponseId(messages)).toBe('running')
    expect(selectedAssistantStatus(messages)).toBe('streaming')
  })

  it('stops targeting a hidden running sibling after switching to a completed branch', () => {
    const selectedBranch = [
      { id: 'selected-complete', role: 'assistant' as const, status: 'complete' as const },
    ]
    expect(selectedInFlightResponseId(selectedBranch)).toBeUndefined()
    expect(selectedAssistantStatus(selectedBranch)).toBe('idle')
  })
})
