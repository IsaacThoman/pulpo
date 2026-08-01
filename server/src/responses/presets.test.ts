import { describe, expect, it } from 'vitest'
import type { ChatPreset } from '@pulpo/contracts'
import { PresetResolutionError, resolvePresetActions, type PresetResolutionModel } from './presets.js'

function model(id: string, presets: ChatPreset[] = [], allowedParameters: string[] = []): PresetResolutionModel {
  return { id, enabled: true, presets, allowedParameters }
}

function loader(...models: PresetResolutionModel[]) {
  const byId = new Map(models.map((value) => [value.id, value]))
  return async (id: string) => byId.get(id)
}

const reasoning: ChatPreset = {
  id: 'reasoning', name: 'Reasoning', icon: 'brain', defaultChoiceId: 'medium',
  choices: [
    { id: 'off', displayName: 'Off', action: { type: 'none' } },
    { id: 'medium', displayName: 'Medium', action: { type: 'params', params: { reasoning_effort: 'medium' } } },
    { id: 'high', displayName: 'High', action: { type: 'params', params: { reasoning_effort: 'high' } } },
  ],
}

describe('preset action resolution', () => {
  it('applies defaults and no-op selections without redirecting', async () => {
    const resolved = await resolvePresetActions('base', {}, loader(model('base', [reasoning], ['reasoning_effort'])))
    expect(resolved).toEqual({
      effectiveModelId: 'base',
      parameters: { reasoning_effort: 'medium' },
      selections: { reasoning: 'medium' },
    })
    const off = await resolvePresetActions('base', { reasoning: 'off' }, loader(model('base', [reasoning], ['reasoning_effort'])))
    expect(off.parameters).toEqual({})
  })

  it('falls back from a stale selection and lets later presets win', async () => {
    const style: ChatPreset = {
      id: 'style', name: 'Style', icon: 'sparkles', defaultChoiceId: 'brief',
      choices: [{ id: 'brief', displayName: 'Brief', action: { type: 'params', params: { verbosity: 'low', shared: 'later' } } }],
    }
    const first: ChatPreset = {
      id: 'first', name: 'First', icon: 'circle',
      choices: [{ id: 'default', displayName: 'Default', action: { type: 'params', params: { shared: 'earlier' } } }],
    }
    const resolved = await resolvePresetActions('base', { style: 'removed' }, loader(model('base', [first, style], ['verbosity', 'shared'])))
    expect(resolved.parameters).toEqual({ verbosity: 'low', shared: 'later' })
    expect(resolved.selections.style).toBe('brief')
  })

  it('preserves selected parameters across a model redirect and filters them for the target', async () => {
    const speed: ChatPreset = {
      id: 'speed', name: 'Speed', icon: 'gauge', defaultChoiceId: 'standard',
      choices: [
        { id: 'standard', displayName: 'Standard', action: { type: 'none' } },
        { id: 'fast', displayName: 'Fast', icon: 'zap', action: { type: 'redirect', modelId: 'fast-model' } },
      ],
    }
    const resolved = await resolvePresetActions(
      'base',
      { reasoning: 'high', speed: 'fast' },
      loader(model('base', [reasoning, speed], ['reasoning_effort']), model('fast-model', [], ['reasoning_effort'])),
    )
    expect(resolved.effectiveModelId).toBe('fast-model')
    expect(resolved.parameters).toEqual({ reasoning_effort: 'high' })
  })

  it('rejects conflicting redirects', async () => {
    const redirects: ChatPreset[] = ['fast-a', 'fast-b'].map((target, index) => ({
      id: `route-${index}`, name: `Route ${index}`, icon: 'rocket',
      choices: [{ id: 'on', displayName: 'On', action: { type: 'redirect', modelId: target } }],
    }))
    await expect(resolvePresetActions('base', {}, loader(model('base', redirects)))).rejects.toMatchObject({ code: 'conflicting_redirects' } satisfies Partial<PresetResolutionError>)
  })

  it('rejects redirect cycles and unavailable targets', async () => {
    const toB: ChatPreset = { id: 'route-a', name: 'Route', icon: 'rocket', choices: [{ id: 'on', displayName: 'On', action: { type: 'redirect', modelId: 'b' } }] }
    const toA: ChatPreset = { id: 'route-b', name: 'Route', icon: 'rocket', choices: [{ id: 'on', displayName: 'On', action: { type: 'redirect', modelId: 'a' } }] }
    await expect(resolvePresetActions('a', { 'route-b': 'on' }, loader(model('a', [toB]), model('b', [toA])))).rejects.toMatchObject({ code: 'redirect_cycle' } satisfies Partial<PresetResolutionError>)
    await expect(resolvePresetActions('a', {}, loader(model('a', [toB])))).rejects.toMatchObject({ code: 'model_unavailable' } satisfies Partial<PresetResolutionError>)
  })
})
