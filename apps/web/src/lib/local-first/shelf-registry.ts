import type { ShelfSync } from '@pulpo/client-core'

export const webShelves = new Map<string, ShelfSync>()
export function clearWebShelves(): void {
  for (const shelf of webShelves.values()) shelf.dispose()
  webShelves.clear()
}
