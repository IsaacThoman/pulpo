// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { MemoryLiveAssetStore } from '../../assets.js'
import { AssetUrls } from './assets.js'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

describe('asset URLs', () => {
  it('makes no object URL for a fetch that finishes after the editor closed', async () => {
    const store = new MemoryLiveAssetStore()
    const { hash } = await store.put(PNG, 'image/png')
    let created = 0
    URL.createObjectURL = () => `blob:${++created}`
    URL.revokeObjectURL = () => {}
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const slow = { put: store.put.bind(store), get: async (key: string) => { await gate; return store.get(key) } }
    const urls = new AssetUrls(slow as unknown as MemoryLiveAssetStore)
    const pending = urls.url(hash)
    urls.destroy()
    release()
    expect(await pending).toBeNull()
    expect(await urls.url(hash)).toBeNull()
    expect(created).toBe(0)
  })
})
