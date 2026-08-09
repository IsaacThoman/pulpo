import { describe, expect, it } from 'vitest'
import { authorizedModelIds, modelPermissionAllows, type PermissionModel } from './model-permissions.js'

function model(id: string, options: Partial<PermissionModel> = {}): PermissionModel {
  return { id, enabled: true, visible: false, fallbackModelId: null, ...options }
}

describe('API-key model-family permissions', () => {
  it('keeps unrestricted and exact permissions working', () => {
    const catalog = [model('visible', { visible: true }), model('hidden')]
    expect(modelPermissionAllows('hidden', [], catalog, [])).toBe(true)
    expect(modelPermissionAllows('hidden', ['hidden'], catalog, [])).toBe(true)
  })

  it('authorizes enabled hidden redirect and fallback variants of a visible parent', () => {
    const catalog = [
      model('visible', { visible: true, fallbackModelId: 'standard' }),
      model('flex', { fallbackModelId: 'flex-backup' }),
      model('standard'),
      model('flex-backup'),
    ]
    const redirects = [{ modelId: 'visible', targetModelId: 'flex' }]
    expect(modelPermissionAllows('standard', ['visible'], catalog, redirects)).toBe(true)
    expect(modelPermissionAllows('flex', ['visible'], catalog, redirects)).toBe(true)
    expect(modelPermissionAllows('flex-backup', ['visible'], catalog, redirects)).toBe(true)
  })

  it('does not authorize unrelated or disabled hidden models', () => {
    const catalog = [
      model('visible', { visible: true, fallbackModelId: 'disabled' }),
      model('disabled', { enabled: false }),
      model('unrelated'),
    ]
    expect(modelPermissionAllows('disabled', ['visible'], catalog, [])).toBe(false)
    expect(modelPermissionAllows('unrelated', ['visible'], catalog, [])).toBe(false)
  })

  it('does not expand families from a hidden exact permission', () => {
    const catalog = [model('hidden', { fallbackModelId: 'other-hidden' }), model('other-hidden')]
    expect(modelPermissionAllows('other-hidden', ['hidden'], catalog, [])).toBe(false)
  })

  it('traverses cycles safely and enforces the shared eight-model chain limit', () => {
    const ids = Array.from({ length: 10 }, (_, index) => `model-${index}`)
    const catalog = ids.map((id, index) => model(id, {
      visible: index === 0,
      fallbackModelId: index + 1 < ids.length ? ids[index + 1]! : null,
    }))
    const redirects = [{ modelId: 'model-3', targetModelId: 'model-1' }]
    const authorized = authorizedModelIds(['model-0'], catalog, redirects)
    expect([...authorized]).toHaveLength(8)
    expect(authorized.has('model-7')).toBe(true)
    expect(authorized.has('model-8')).toBe(false)
  })
})
