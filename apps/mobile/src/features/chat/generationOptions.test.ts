import { describe, expect, it } from 'vitest'
import type { PrototypeModel } from '../../mockup5/src/domain'
import { generationSummary, resolveGenerationSelections } from './generationOptions'

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
})
