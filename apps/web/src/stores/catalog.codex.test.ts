// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Model } from '@/lib/types'
import { CODEX_LAB_ID } from '@/lib/catalog-model'
import { filterCodexModels, useCatalog } from './catalog'
import { resolveDefaultModelId } from '@/lib/default-model'

const ordinary = { id: 'ordinary', providerGroupId: 'ordinary', enabled: true } as Model
const codex = { id: 'codex:test', providerGroupId: CODEX_LAB_ID, enabled: true } as Model
const serverModel = (model: Model) => ({ ...model, name: model.id, lab: { id: model.providerGroupId, name: model.providerGroupId, logo: 'codex' }, provider: { id: 'provider', name: 'provider' }, tags: [], presets: [], inputPriceMicros: 0, outputPriceMicros: 0, perRequestPriceMicros: 0 })

beforeEach(() => {
  useCatalog.setState({ models: [], loaded: false, codexEnabled: false })
  localStorage.clear()
})
afterEach(() => vi.unstubAllGlobals())

describe('Codex catalog availability', () => {
  it('filters cached choices without mutating their source or saved default', () => {
    const cached = [codex, ordinary]
    const available = filterCodexModels(cached, false)
    expect(available).toEqual([ordinary])
    expect(cached).toEqual([codex, ordinary])
    expect(resolveDefaultModelId(available, codex.id)).toBe(ordinary.id)
    expect(resolveDefaultModelId(filterCodexModels([codex], false), codex.id)).toBe('')
  })

  it('never restores cached Codex models before verifying instance availability', async () => {
    localStorage.setItem('pulpo-model-catalog', JSON.stringify({ state: { models: [codex, ordinary] }, version: 0 }))
    await useCatalog.persist.rehydrate()
    expect(useCatalog.getState().models).toEqual([ordinary])
    expect(useCatalog.getState().codexEnabled).toBe(false)
  })

  it.each([undefined, false, true])('uses explicit server availability (%s) and can restore retained connections', async (enabled) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ codexEnabled: enabled, data: [codex, ordinary].map(serverModel) }), { headers: { 'content-type': 'application/json' } })))
    await useCatalog.getState().load()
    expect(useCatalog.getState().models.map((model) => model.id)).toEqual(enabled ? [codex.id, ordinary.id] : [ordinary.id])
    expect(useCatalog.getState().codexEnabled).toBe(enabled === true)
  })

  it('ignores an older catalog response arriving after disablement', async () => {
    let finish!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finish = resolve })))
    const pending = useCatalog.getState().load()
    useCatalog.getState().setCodexEnabled(false)
    finish(new Response(JSON.stringify({ codexEnabled: true, data: [codex].map(serverModel) }), { headers: { 'content-type': 'application/json' } }))
    await pending
    expect(useCatalog.getState().codexEnabled).toBe(false)
    expect(useCatalog.getState().models).toEqual([])
  })

  it('removes Codex immediately when disabled, including while catalog refresh is offline', async () => {
    useCatalog.setState({ models: [codex, ordinary], codexEnabled: true })
    useCatalog.getState().setCodexEnabled(false)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Offline')))
    await useCatalog.getState().load()
    expect(useCatalog.getState().models).toEqual([ordinary])
  })
})
