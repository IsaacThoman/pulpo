import { useSyncExternalStore } from 'react'
import { Directory, File, Paths } from 'expo-file-system'
import { apiUrl } from '../../../api/client'
import type { MobileCatalogIcon, MobileModel } from '../../../types'

const listeners = new Set<() => void>()
const activeDownloads = new Map<string, Promise<boolean>>()
const validatedFiles = new Set<string>()
let revision = 0

function urlHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function catalogIconCacheFilename(iconId: string, variant: 'light' | 'dark', absoluteUrl: string): string {
  return `${iconId}-${variant}-${urlHash(absoluteUrl)}.png`
}

function cacheDirectory(): Directory {
  return new Directory(Paths.cache, 'catalog-icons')
}

function cacheFile(icon: MobileCatalogIcon, variant: 'light' | 'dark'): { file: File; url: string } {
  const url = apiUrl(variant === 'dark' ? icon.darkUrl : icon.lightUrl)
  return {
    file: new File(cacheDirectory(), catalogIconCacheFilename(icon.id, variant, url)),
    url,
  }
}

export function cachedCatalogIconUri(icon: MobileCatalogIcon, variant: 'light' | 'dark'): string | null {
  try {
    const { file } = cacheFile(icon, variant)
    return file.exists && validatedFiles.has(file.uri) ? file.uri : null
  } catch {
    return null
  }
}

async function isPng(file: File): Promise<boolean> {
  if (!file.exists || file.size === null || file.size < 8) return false
  const bytes = await file.bytes()
  return bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
}

function announceCachedIcon(): void {
  revision += 1
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Re-render image consumers as background icon downloads become locally available. */
export function useCatalogIconCacheRevision(): number {
  return useSyncExternalStore(subscribe, () => revision, () => revision)
}

async function warmVariant(icon: MobileCatalogIcon, variant: 'light' | 'dark'): Promise<boolean> {
  const { file, url } = cacheFile(icon, variant)
  if (file.exists && validatedFiles.has(file.uri)) return false
  const existing = activeDownloads.get(file.uri)
  if (existing) return existing
  const pending = (async () => {
    try {
      if (await isPng(file)) {
        validatedFiles.add(file.uri)
        announceCachedIcon()
        return false
      }
      if (file.exists) file.delete()
      const directory = cacheDirectory()
      directory.create({ idempotent: true, intermediates: true })
      const downloaded = await File.downloadFileAsync(url, file, { idempotent: true })
      if (!(await isPng(downloaded))) throw new Error('Downloaded catalog icon is invalid')
      validatedFiles.add(downloaded.uri)
      announceCachedIcon()
      return true
    } catch {
      validatedFiles.delete(file.uri)
      try {
        if (file.exists) file.delete()
      } catch {
        // The cache directory is disposable and a missing partial file is harmless.
      }
      return false
    } finally {
      activeDownloads.delete(file.uri)
    }
  })()
  activeDownloads.set(file.uri, pending)
  return pending
}

/** Warm every custom model and lab mark without blocking catalog publication. */
export async function warmModelCatalogIcons(models: readonly MobileModel[]): Promise<void> {
  const icons = new Map<string, MobileCatalogIcon>()
  for (const model of models) {
    for (const icon of [model.customIcon, model.lab?.customIcon]) {
      if (icon) icons.set(icon.id, icon)
    }
  }
  await Promise.all([...icons.values()].flatMap((icon) => [
    warmVariant(icon, 'light'),
    warmVariant(icon, 'dark'),
  ]))
}
