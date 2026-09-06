import type { ShelfSync } from '@pulpo/client-core'

export const mobileShelves = new Map<string, ShelfSync>()
export function clearMobileShelf(namespace: string): void {
  mobileShelves.get(namespace)?.dispose()
  mobileShelves.delete(namespace)
}
