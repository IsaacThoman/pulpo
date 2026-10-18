import { describe, expect, it } from 'vitest'
import type { PrototypeModel } from '../../mockup5/src/domain'
import { chatGenerationSelections, enterDraftPresets, generationDefaultsWithChoice, generationSummary, resolveGenerationSelections } from './generationOptions'

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

  it('starts chats from history and returns new-chat drafts to their earlier choices', () => {
    const memory = new Map()
    const started = [{ role: 'assistant', modelId: 'model-1', presetSelections: { reasoning: 'high' } }]
    const newDraft = { scope: 'local\u0000temporary:new', newChat: true }
    const startedChat = { scope: 'local\u0000temporary:chat', newChat: false }
    // Opening a chat never carries the previous draft's choices.
    expect(enterDraftPresets(memory, { ...newDraft, state: { presets: { 'model-1': { reasoning: 'low' } }, settled: true } }, startedChat, started))
      .toEqual({ presets: { 'model-1': { reasoning: 'high' } }, settled: true })
    // A rejected first send returns to the unstarted draft with its choices intact.
    expect(enterDraftPresets(memory, { ...startedChat, state: { presets: { 'model-1': { reasoning: 'high' } }, settled: true } }, newDraft, []))
      .toEqual({ presets: { 'model-1': { reasoning: 'low' } }, settled: true })
    // Chats without loaded history stay open to late seeding; unvisited new-chat drafts use defaults.
    expect(enterDraftPresets(memory, null, startedChat, [])).toEqual({ presets: {}, settled: false })
    expect(enterDraftPresets(memory, null, { scope: 'local\u0000new', newChat: true }, [])).toEqual({ presets: {}, settled: false })
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
