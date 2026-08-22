import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileCatalogIcon, MobileModel } from '../../../types'

const mocks = vi.hoisted(() => {
  const files = new Map<string, number>()
  class Directory {
    uri: string
    create = vi.fn()

    constructor(...parts: Array<string | { uri: string }>) {
      this.uri = parts.map((part) => typeof part === 'string' ? part : part.uri).join('/')
    }
  }
  class File {
    static downloadFileAsync = vi.fn(async (_url: string, destination: File) => {
      files.set(destination.uri, 128)
      return destination
    })

    uri: string

    constructor(directory: Directory, name: string) {
      this.uri = `${directory.uri}/${name}`
    }

    get exists() { return files.has(this.uri) }
    get size() { return files.get(this.uri) ?? 0 }
    async bytes() {
      return this.size > 0
        ? new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        : new Uint8Array()
    }
    delete() { files.delete(this.uri) }
  }
  return { Directory, File, files }
})

vi.mock('expo-file-system', () => ({
  Directory: mocks.Directory,
  File: mocks.File,
  Paths: { cache: 'file:///cache' },
}))

const icon: MobileCatalogIcon = {
  id: 'icon-1', mode: 'monochrome',
  lightUrl: '/api/catalog-icons/icon-1/monochrome-light.png',
  darkUrl: '/api/catalog-icons/icon-1/monochrome-dark.png',
}

function model(): MobileModel {
  return {
    id: 'model-1', name: 'Model', description: 'Description', executionMode: 'stream',
    maxOutputTokens: 8_000, agentEnabled: true, tags: [], logo: null, customIcon: icon,
    iconLight: null, iconDark: null, provider: { id: 'provider-1', name: 'Provider' },
    lab: { id: 'lab-1', name: 'Lab', logo: 'pulpo', customIcon: icon }, presets: [],
  }
}

beforeEach(() => {
  mocks.files.clear()
  mocks.File.downloadFileAsync.mockClear()
})

describe('catalog icon cache', () => {
  it('uses origin-scoped filenames and exposes only complete local files', async () => {
    const { cachedCatalogIconUri, catalogIconCacheFilename, warmModelCatalogIcons } = await import('./catalogIconCache')
    expect(catalogIconCacheFilename('icon-1', 'light', 'https://one.example/icon.png'))
      .not.toBe(catalogIconCacheFilename('icon-1', 'light', 'https://two.example/icon.png'))
    expect(cachedCatalogIconUri(icon, 'light')).toBeNull()

    await warmModelCatalogIcons([model()])

    expect(cachedCatalogIconUri(icon, 'light')).toMatch(/^file:\/\/\/cache\/catalog-icons\/icon-1-light-/)
    expect(cachedCatalogIconUri(icon, 'dark')).toMatch(/^file:\/\/\/cache\/catalog-icons\/icon-1-dark-/)
  })

  it('deduplicates repeated model and lab icon downloads across concurrent warmups', async () => {
    const { warmModelCatalogIcons } = await import('./catalogIconCache')

    await Promise.all([warmModelCatalogIcons([model()]), warmModelCatalogIcons([model()])])

    expect(mocks.File.downloadFileAsync).toHaveBeenCalledTimes(2)
  })

  it('caches both theme destinations when an original icon uses the same URL', async () => {
    const original = { ...icon, mode: 'original' as const, darkUrl: icon.lightUrl }
    const { cachedCatalogIconUri, warmModelCatalogIcons } = await import('./catalogIconCache')

    await warmModelCatalogIcons([{ ...model(), customIcon: original, lab: null }])

    expect(cachedCatalogIconUri(original, 'light')).not.toBeNull()
    expect(cachedCatalogIconUri(original, 'dark')).not.toBeNull()
    expect(mocks.File.downloadFileAsync).toHaveBeenCalledTimes(2)
  })

  it('removes corrupt downloads so callers keep using a bundled fallback', async () => {
    mocks.File.downloadFileAsync.mockImplementationOnce(async (_url, destination) => {
      mocks.files.set(destination.uri, 128)
      destination.bytes = async () => new Uint8Array([0x62, 0x61, 0x64])
      return destination
    })
    const { cachedCatalogIconUri, warmModelCatalogIcons } = await import('./catalogIconCache')

    await warmModelCatalogIcons([{ ...model(), lab: null }])

    expect(cachedCatalogIconUri(icon, 'light')).toBeNull()
    expect(cachedCatalogIconUri(icon, 'dark')).not.toBeNull()
  })
})
