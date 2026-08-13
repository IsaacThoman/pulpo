import { describe, expect, it, vi } from 'vitest'
import type { MobileModel } from '../../types'
import { findDisplayModel, mapModel, reconcileComposerModelId, redirectTargetModelIds, resolveDisplayModel } from './modelIdentity'

describe('mobile model identity', () => {
  it('adopts a late account default while a new composer still follows defaults', () => {
    const models = [{ id: 'catalog-first' }, { id: 'account-default' }]

    expect(reconcileComposerModelId(models, 'catalog-first', 'account-default', true)).toBe('account-default')
  })

  it('preserves an explicit model choice when the account default arrives', () => {
    const models = [{ id: 'catalog-first' }, { id: 'account-default' }, { id: 'chosen' }]

    expect(reconcileComposerModelId(models, 'chosen', 'account-default', false)).toBe('chosen')
  })

  it('falls back to the account default when an explicit choice becomes unavailable', () => {
    const models = [{ id: 'catalog-first' }, { id: 'account-default' }]

    expect(reconcileComposerModelId(models, 'removed', 'account-default', false)).toBe('account-default')
  })

  it('maps a hidden redirect target back to its visible parent', () => {
    const parent = { id: 'gpt-5.6-luna', redirectTargetModelIds: ['gpt-5.6-luna-fast'], name: 'GPT-5.6 Luna' }

    expect(findDisplayModel([parent], 'gpt-5.6-luna-fast')).toBe(parent)
  })

  it('prefers a direct model match over a redirect owner', () => {
    const parent = { id: 'gpt-5.6-luna', redirectTargetModelIds: ['gpt-5.6-luna-fast'] }
    const direct = { id: 'gpt-5.6-luna-fast' }

    expect(findDisplayModel([parent, direct], direct.id)).toBe(direct)
  })

  it('uses the unavailable-model factory for an unknown model', () => {
    const unavailable = vi.fn((id: string) => ({ id, name: id }))

    expect(resolveDisplayModel([], 'removed-model', unavailable)).toEqual({ id: 'removed-model', name: 'removed-model' })
    expect(unavailable).toHaveBeenCalledWith('removed-model')
  })

  it('extracts and deduplicates redirect targets from server presets', () => {
    const presets = [{ choices: [
      { action: { type: 'none' } },
      { action: { type: 'redirect', modelId: 'fast-model' } },
    ] }, { choices: [
      { action: { type: 'redirect', modelId: 'fast-model' } },
      { action: { type: 'redirect', modelId: 'cheap-model' } },
    ] }]

    expect(redirectTargetModelIds(presets)).toEqual(['fast-model', 'cheap-model'])
  })

  it('preserves server preset redirect targets in the mobile catalog model', () => {
    const model: MobileModel = {
      id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', description: 'Visible model', executionMode: 'stream',
      maxOutputTokens: 16_384, agentEnabled: true, tags: [], logo: null, iconLight: null, iconDark: null,
      provider: { id: 'openai', name: 'OpenAI' }, lab: null,
      presets: [{
        id: 'speed', name: 'Speed', icon: 'zap', defaultChoiceId: 'standard',
        choices: [
          { id: 'standard', displayName: 'Standard', action: { type: 'none' } },
          { id: 'fast', displayName: 'Fast', action: { type: 'redirect', modelId: 'gpt-5.6-luna-fast' } },
        ],
      }],
    }

    expect(mapModel(model, []).redirectTargetModelIds).toEqual(['gpt-5.6-luna-fast'])
  })

  it('prefers a custom model icon and retains the custom lab icon', () => {
    const labIcon = { id: '00000000-0000-7000-8000-000000000010', mode: 'monochrome' as const, lightUrl: '/lab-light.png', darkUrl: '/lab-dark.png' }
    const modelIcon = { id: '00000000-0000-7000-8000-000000000011', mode: 'original' as const, lightUrl: '/model.png', darkUrl: '/model.png' }
    const model: MobileModel = {
      id: 'custom', name: 'Custom', description: '', executionMode: 'stream', maxOutputTokens: 1,
      agentEnabled: false, tags: [], logo: null, customIcon: modelIcon, iconLight: null, iconDark: null,
      provider: { id: 'provider', name: 'Provider' },
      lab: { id: 'lab', name: 'Lab', logo: 'pulpo', customIcon: labIcon }, presets: [],
    }

    expect(mapModel(model, [])).toMatchObject({ modelCustomIcon: modelIcon, labCustomIcon: labIcon })
    expect(mapModel({ ...model, logo: 'openai', customIcon: null }, [])).toMatchObject({ modelCustomIcon: null, labCustomIcon: labIcon })
  })
})
