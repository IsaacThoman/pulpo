import { describe, expect, it } from 'vitest'
import type { PrototypeModel } from '../../mockup5/src/domain'
import { chatGenerationSelections, enterDraftPresets, generationDefaultsWithChoice, generationSummary, resolveGenerationSelections, settlePendingStart, type PendingStart } from './generationOptions'

const model = {
  id: 'model-1',
  presets: [
    {
      id: 'reasoning', name: 'Reasoning', icon: 'brain', selectedId: 'medium',
      choices: [
        { id: 'low', label: 'Low', icon: 'brain' },
        { id: 'medium', label: 'Medium', icon: 'brain' },
        { id: 'high', label: 'High', icon: 'brain' },
      ],
    },
    {
      id: 'speed', name: 'Speed', icon: 'timer', selectedId: 'fast',
      choices: [
        { id: 'fast', label: 'Fast', icon: 'timer' },
        { id: 'quality', label: 'Quality', icon: 'timer' },
      ],
    },
  ],
} as PrototypeModel

describe('generation options', () => {
  it('uses valid saved choices and falls back independently per preset', () => {
    expect(resolveGenerationSelections(model, { reasoning: 'high', speed: 'removed' })).toEqual({
      reasoning: 'high',
      speed: 'fast',
    })
  })

  it('summarizes every active preset like the web composer', () => {
    expect(generationSummary(model, { reasoning: 'low', speed: 'quality' })).toBe('Low · Quality')
  })

  it('starts a chat from each model\'s newest assistant turn', () => {
    expect(chatGenerationSelections([
      { role: 'assistant', modelId: 'model-1', presetSelections: { reasoning: 'low' } },
      { role: 'user', modelId: 'model-1', presetSelections: { reasoning: 'medium' } },
      { role: 'assistant', modelId: 'model-2', presetSelections: { speed: 'quality' } },
      { role: 'assistant', modelId: 'model-1', presetSelections: { reasoning: 'high' } },
      { role: 'assistant', modelId: 'model-2' },
    ])).toEqual({ 'model-1': { reasoning: 'high' }, 'model-2': { speed: 'quality' } })
    expect(chatGenerationSelections([])).toEqual({})
  })

  describe('new-chat starts', () => {
    const history = [{ role: 'assistant', modelId: 'model-1', presetSelections: { reasoning: 'high' } }]
    const draft = { scope: 'local\u0000temporary:new', draftId: 'temporary:new' }
    const chat = { scope: 'local\u0000temporary:chat', draftId: 'temporary:chat' }
    const other = { scope: 'local\u0000other', draftId: 'other' }
    const sent = { presets: { 'model-1': { reasoning: 'low' } }, settled: true }
    const defaults = { presets: {}, settled: false }
    const begun = (): PendingStart => ({ token: 1, scope: draft.scope, state: sent })
    const exists = (ids: string[]) => (draftId: string) => ids.includes(draftId)
    /** Enter the chat the send opened, with its optimistic turn. */
    const opened = () => enterDraftPresets(begun(), chat, history, exists(['temporary:chat']))

    it('starts drafts from history and records the chat a send opened', () => {
      expect(opened()).toEqual({ presets: { presets: { 'model-1': { reasoning: 'high' } }, settled: true }, pending: { ...begun(), started: chat } })
      // History that has not loaded leaves the draft open to late seeding.
      expect(enterDraftPresets(null, other, [], exists([]))).toEqual({ presets: defaults, pending: null })
    })

    it('restores a rejected start once, whether the rejection or the return happens first', () => {
      const rejected = settlePendingStart(opened().pending, 1, false, { activeScope: chat.scope, chatExists: exists([]) })
      expect(rejected).toMatchObject({ rejected: true })
      expect(enterDraftPresets(rejected, draft, [], exists([]))).toEqual({ presets: sent, pending: null })
      // The return rendered first: the chat is already discarded.
      expect(enterDraftPresets(opened().pending, draft, [], exists([]))).toEqual({ presets: sent, pending: null })
    })

    it('does not restore while pending, after acceptance, or when the user moved on', () => {
      // Opening a new chat while the first send is still pending.
      expect(enterDraftPresets(opened().pending, draft, [], exists(['temporary:chat']))).toMatchObject({ presets: defaults })
      expect(settlePendingStart(opened().pending, 1, true, { activeScope: chat.scope, chatExists: exists(['temporary:chat']) })).toBeNull()
      // Rejected after the user switched chats, or after the server created the chat.
      expect(settlePendingStart(opened().pending, 1, false, { activeScope: other.scope, chatExists: exists([]) })).toBeNull()
      expect(settlePendingStart(opened().pending, 1, false, { activeScope: chat.scope, chatExists: exists(['temporary:chat']) })).toBeNull()
      // A rejected start that is not followed by its return is dropped.
      const rejected = settlePendingStart(opened().pending, 1, false, { activeScope: chat.scope, chatExists: exists([]) })
      expect(enterDraftPresets(rejected, other, [], exists([]))).toEqual({ presets: defaults, pending: null })
      // A newer start owns the slot.
      expect(settlePendingStart(opened().pending, 2, true, { activeScope: chat.scope, chatExists: exists([]) })).toEqual(opened().pending)
    })
  })

  it('saves one explicit choice without discarding other saved defaults', () => {
    const saved = { 'model-1': { reasoning: 'low', speed: 'quality' }, 'model-2': { speed: 'fast' } }
    expect(generationDefaultsWithChoice(saved, 'model-1', 'reasoning', 'high')).toEqual({
      'model-1': { reasoning: 'high', speed: 'quality' },
      'model-2': { speed: 'fast' },
    })
    expect(generationDefaultsWithChoice({}, 'model-3', 'speed', 'fast')).toEqual({ 'model-3': { speed: 'fast' } })
  })
})
