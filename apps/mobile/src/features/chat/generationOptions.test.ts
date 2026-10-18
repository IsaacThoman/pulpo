import { describe, expect, it } from 'vitest'
import type { PrototypeModel } from '../../mockup5/src/domain'
import { chatGenerationSelections, generationDefaultsWithChoice, generationSummary, resolveGenerationSelections } from './generationOptions'

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

  it('saves one explicit choice without discarding other saved defaults', () => {
    const saved = { 'model-1': { reasoning: 'low', speed: 'quality' }, 'model-2': { speed: 'fast' } }
    expect(generationDefaultsWithChoice(saved, 'model-1', 'reasoning', 'high')).toEqual({
      'model-1': { reasoning: 'high', speed: 'quality' },
      'model-2': { speed: 'fast' },
    })
    expect(generationDefaultsWithChoice({}, 'model-3', 'speed', 'fast')).toEqual({ 'model-3': { speed: 'fast' } })
  })
})
